#!/usr/bin/env python3
import argparse
import base64
import json
import signal
import sys
import time

BLUEZ = "org.bluez"
DBUS_PROPERTIES = "org.freedesktop.DBus.Properties"
DBUS_OBJECT_MANAGER = "org.freedesktop.DBus.ObjectManager"
GATT_MANAGER = "org.bluez.GattManager1"
GATT_SERVICE = "org.bluez.GattService1"
GATT_CHARACTERISTIC = "org.bluez.GattCharacteristic1"
GATT_DESCRIPTOR = "org.bluez.GattDescriptor1"
ADVERTISEMENT_MANAGER = "org.bluez.LEAdvertisingManager1"
ADVERTISEMENT = "org.bluez.LEAdvertisement1"
AGENT_MANAGER = "org.bluez.AgentManager1"
AGENT = "org.bluez.Agent1"
ADAPTER = "org.bluez.Adapter1"

APP_PATH = "/com/unfoldedcircle/virtualremote"
ADVERTISEMENT_PATH = APP_PATH + "/advertisement0"
AGENT_PATH = APP_PATH + "/agent0"

HID_SERVICE_UUID = "00001812-0000-1000-8000-00805f9b34fb"
HID_INFORMATION_UUID = "00002a4a-0000-1000-8000-00805f9b34fb"
REPORT_MAP_UUID = "00002a4b-0000-1000-8000-00805f9b34fb"
HID_CONTROL_POINT_UUID = "00002a4c-0000-1000-8000-00805f9b34fb"
REPORT_UUID = "00002a4d-0000-1000-8000-00805f9b34fb"
PROTOCOL_MODE_UUID = "00002a4e-0000-1000-8000-00805f9b34fb"
REPORT_REFERENCE_UUID = "00002908-0000-1000-8000-00805f9b34fb"

# Bluetooth LE Appearance: Generic HID.
HID_APPEARANCE = 0x03C0

# Composite keyboard + 5-button relative mouse + consumer + system control.
# Report IDs are retained in the map; Report Reference descriptors map each
# GATT Report characteristic to its report ID and type.
REPORT_DESCRIPTOR = bytes.fromhex(
    "05010906a1018501"
    "050719e029e715002501750195088102"
    "950175088101"
    "95067508150025650507190029658100c0"
    "05010902a10185020901a100"
    "05091901290515002501750195058102"
    "750395018101"
    "05010930093109381581257f750895038106c0c0"
    "050c0901a1018503"
    "150026ff0319002aff03751095018100c0"
    "05010980a1018504"
    "150025ff190029ff750895018100c0"
)


def emit(event_type, **data):
    print(json.dumps({"type": event_type, **data}, separators=(",", ":")), flush=True)


def byte_array(dbus, value):
    return dbus.Array([dbus.Byte(item) for item in bytes(value)], signature="y")


class HidPeripheral:
    def __init__(self, address, adapter, name):
        self.address = address.upper()
        self.adapter = adapter
        self.name = name
        self.bus = None
        self.mainloop = None
        self.dbus = None
        self.GLib = None
        self.adapter_path = None
        self.gatt_manager = None
        self.advertisement_manager = None
        self.agent_manager = None
        self.application = None
        self.advertisement = None
        self.agent = None
        self.report_characteristics = {}
        self.registered = False
        self.advertising = False
        self.agent_registered = False
        self.running = True
        self.notify_count = 0
        self.protocol_mode = 1

    def setup(self):
        try:
            import dbus
            import dbus.service
            from dbus.mainloop.glib import DBusGMainLoop
            from gi.repository import GLib
        except Exception as exc:
            raise RuntimeError(f"Bluetooth LE HID requires python3-dbus and python3-gi: {exc}") from exc

        self.dbus = dbus
        self.GLib = GLib
        DBusGMainLoop(set_as_default=True)
        self.bus = dbus.SystemBus()
        self.mainloop = GLib.MainLoop()
        self.adapter_path = self._find_adapter_path()
        if not self.adapter_path:
            raise RuntimeError(f"Bluetooth adapter {self.adapter or self.address} was not found in BlueZ")

        adapter_object = self.bus.get_object(BLUEZ, self.adapter_path)
        self.gatt_manager = dbus.Interface(adapter_object, GATT_MANAGER)
        self.advertisement_manager = dbus.Interface(adapter_object, ADVERTISEMENT_MANAGER)
        self._configure_adapter(adapter_object)

        peripheral = self

        class PropertiesObject(dbus.service.Object):
            @dbus.service.signal(DBUS_PROPERTIES, signature="sa{sv}as")
            def PropertiesChanged(self, interface, changed, invalidated):
                pass

        class Service(PropertiesObject):
            def __init__(self, bus, index, uuid, primary=True):
                self.path = f"{APP_PATH}/service{index}"
                self.uuid = uuid
                self.primary = primary
                self.characteristics = []
                super().__init__(bus, self.path)

            def properties(self):
                return {
                    "UUID": dbus.String(self.uuid),
                    "Primary": dbus.Boolean(self.primary),
                    "Includes": dbus.Array([], signature="o"),
                }

            def managed(self):
                return {GATT_SERVICE: self.properties()}

            @dbus.service.method(DBUS_PROPERTIES, in_signature="s", out_signature="a{sv}")
            def GetAll(self, interface):
                if interface != GATT_SERVICE:
                    raise dbus.exceptions.DBusException("org.freedesktop.DBus.Error.InvalidArgs")
                return self.properties()

        class Characteristic(PropertiesObject):
            def __init__(self, service, index, uuid, flags, value=b"", readable=True, writable=False):
                self.service = service
                self.path = f"{service.path}/char{index}"
                self.uuid = uuid
                self.flags = flags
                self.value = bytes(value)
                self.readable = readable
                self.writable = writable
                self.notifying = False
                self.descriptors = []
                service.characteristics.append(self)
                super().__init__(peripheral.bus, self.path)

            def properties(self):
                return {
                    "Service": dbus.ObjectPath(self.service.path),
                    "UUID": dbus.String(self.uuid),
                    "Flags": dbus.Array([dbus.String(item) for item in self.flags], signature="s"),
                    "Descriptors": dbus.Array([dbus.ObjectPath(item.path) for item in self.descriptors], signature="o"),
                    "Notifying": dbus.Boolean(self.notifying),
                    "Value": byte_array(dbus, self.value),
                }

            def managed(self):
                return {GATT_CHARACTERISTIC: self.properties()}

            @dbus.service.method(DBUS_PROPERTIES, in_signature="s", out_signature="a{sv}")
            def GetAll(self, interface):
                if interface != GATT_CHARACTERISTIC:
                    raise dbus.exceptions.DBusException("org.freedesktop.DBus.Error.InvalidArgs")
                return self.properties()

            @dbus.service.method(GATT_CHARACTERISTIC, in_signature="a{sv}", out_signature="ay")
            def ReadValue(self, options):
                if not self.readable:
                    raise dbus.exceptions.DBusException("org.bluez.Error.NotPermitted")
                return byte_array(dbus, self.value)

            @dbus.service.method(GATT_CHARACTERISTIC, in_signature="aya{sv}", out_signature="")
            def WriteValue(self, value, options):
                if not self.writable:
                    raise dbus.exceptions.DBusException("org.bluez.Error.NotPermitted")
                self.value = bytes(value)
                self.on_write(self.value)

            def on_write(self, value):
                pass

            @dbus.service.method(GATT_CHARACTERISTIC, in_signature="", out_signature="")
            def StartNotify(self):
                if "notify" not in self.flags:
                    raise dbus.exceptions.DBusException("org.bluez.Error.NotSupported")
                if self.notifying:
                    return
                self.notifying = True
                peripheral.notify_count += 1
                self.PropertiesChanged(GATT_CHARACTERISTIC, {"Notifying": dbus.Boolean(True)}, [])
                if peripheral.notify_count == 1:
                    emit("connected", peer=None, transport="ble-hogp")

            @dbus.service.method(GATT_CHARACTERISTIC, in_signature="", out_signature="")
            def StopNotify(self):
                if not self.notifying:
                    return
                self.notifying = False
                peripheral.notify_count = max(0, peripheral.notify_count - 1)
                self.PropertiesChanged(GATT_CHARACTERISTIC, {"Notifying": dbus.Boolean(False)}, [])
                if peripheral.notify_count == 0:
                    emit("disconnected", peer=None, transport="ble-hogp")

            def notify(self, value):
                self.value = bytes(value)
                if not self.notifying:
                    raise RuntimeError(f"HID report characteristic {self.path} has no notification subscriber")
                self.PropertiesChanged(GATT_CHARACTERISTIC, {"Value": byte_array(dbus, self.value)}, [])

        class ProtocolModeCharacteristic(Characteristic):
            def __init__(self, service, index):
                super().__init__(service, index, PROTOCOL_MODE_UUID,
                                 ["read", "write-without-response"], b"\x01", True, True)

            def on_write(self, value):
                if not value or value[0] not in (0, 1):
                    raise dbus.exceptions.DBusException("org.bluez.Error.InvalidValueLength")
                peripheral.protocol_mode = int(value[0])

        class ControlPointCharacteristic(Characteristic):
            def __init__(self, service, index):
                super().__init__(service, index, HID_CONTROL_POINT_UUID,
                                 ["write-without-response"], b"\x01", False, True)

            def on_write(self, value):
                if value and value[0] == 0:
                    emit("suspend")
                elif value and value[0] == 1:
                    emit("resume")

        class ReportCharacteristic(Characteristic):
            def __init__(self, service, index, report_id, size):
                self.report_id = report_id
                super().__init__(service, index, REPORT_UUID, ["read", "notify"], bytes(size), True, False)
                ReportReferenceDescriptor(self, 0, report_id, 1)
                peripheral.report_characteristics[report_id] = self

        class Descriptor(PropertiesObject):
            def __init__(self, characteristic, index, uuid, flags, value):
                self.characteristic = characteristic
                self.path = f"{characteristic.path}/desc{index}"
                self.uuid = uuid
                self.flags = flags
                self.value = bytes(value)
                characteristic.descriptors.append(self)
                super().__init__(peripheral.bus, self.path)

            def properties(self):
                return {
                    "Characteristic": dbus.ObjectPath(self.characteristic.path),
                    "UUID": dbus.String(self.uuid),
                    "Flags": dbus.Array([dbus.String(item) for item in self.flags], signature="s"),
                    "Value": byte_array(dbus, self.value),
                }

            def managed(self):
                return {GATT_DESCRIPTOR: self.properties()}

            @dbus.service.method(DBUS_PROPERTIES, in_signature="s", out_signature="a{sv}")
            def GetAll(self, interface):
                if interface != GATT_DESCRIPTOR:
                    raise dbus.exceptions.DBusException("org.freedesktop.DBus.Error.InvalidArgs")
                return self.properties()

            @dbus.service.method(GATT_DESCRIPTOR, in_signature="a{sv}", out_signature="ay")
            def ReadValue(self, options):
                return byte_array(dbus, self.value)

        class ReportReferenceDescriptor(Descriptor):
            def __init__(self, characteristic, index, report_id, report_type):
                super().__init__(characteristic, index, REPORT_REFERENCE_UUID, ["read"], bytes([report_id, report_type]))

        class Application(dbus.service.Object):
            def __init__(self, bus):
                self.path = APP_PATH
                self.services = []
                super().__init__(bus, self.path)

            @dbus.service.method(DBUS_OBJECT_MANAGER, out_signature="a{oa{sa{sv}}}")
            def GetManagedObjects(self):
                objects = {}
                for service in self.services:
                    objects[dbus.ObjectPath(service.path)] = service.managed()
                    for characteristic in service.characteristics:
                        objects[dbus.ObjectPath(characteristic.path)] = characteristic.managed()
                        for descriptor in characteristic.descriptors:
                            objects[dbus.ObjectPath(descriptor.path)] = descriptor.managed()
                return objects

        class Advertisement(dbus.service.Object):
            def __init__(self, bus):
                self.path = ADVERTISEMENT_PATH
                super().__init__(bus, self.path)

            def properties(self):
                return {
                    "Type": dbus.String("peripheral"),
                    "ServiceUUIDs": dbus.Array([dbus.String(HID_SERVICE_UUID)], signature="s"),
                    "LocalName": dbus.String(peripheral.name),
                    "Appearance": dbus.UInt16(HID_APPEARANCE),
                    "Discoverable": dbus.Boolean(True),
                    "Includes": dbus.Array([dbus.String("tx-power")], signature="s"),
                }

            @dbus.service.method(DBUS_PROPERTIES, in_signature="s", out_signature="a{sv}")
            def GetAll(self, interface):
                if interface != ADVERTISEMENT:
                    raise dbus.exceptions.DBusException("org.freedesktop.DBus.Error.InvalidArgs")
                return self.properties()

            @dbus.service.method(ADVERTISEMENT, in_signature="", out_signature="")
            def Release(self):
                peripheral.advertising = False

        class Agent(dbus.service.Object):
            def __init__(self, bus):
                super().__init__(bus, AGENT_PATH)

            @dbus.service.method(AGENT, in_signature="", out_signature="")
            def Release(self):
                pass

            @dbus.service.method(AGENT, in_signature="o", out_signature="s")
            def RequestPinCode(self, device):
                return "000000"

            @dbus.service.method(AGENT, in_signature="o", out_signature="u")
            def RequestPasskey(self, device):
                return dbus.UInt32(0)

            @dbus.service.method(AGENT, in_signature="ouq", out_signature="")
            def DisplayPasskey(self, device, passkey, entered):
                pass

            @dbus.service.method(AGENT, in_signature="os", out_signature="")
            def DisplayPinCode(self, device, pincode):
                pass

            @dbus.service.method(AGENT, in_signature="ou", out_signature="")
            def RequestConfirmation(self, device, passkey):
                return

            @dbus.service.method(AGENT, in_signature="o", out_signature="")
            def RequestAuthorization(self, device):
                return

            @dbus.service.method(AGENT, in_signature="os", out_signature="")
            def AuthorizeService(self, device, uuid):
                return

            @dbus.service.method(AGENT, in_signature="", out_signature="")
            def Cancel(self):
                pass

        self.application = Application(self.bus)
        hid = Service(self.bus, 0, HID_SERVICE_UUID, True)
        self.application.services.append(hid)
        Characteristic(hid, 0, HID_INFORMATION_UUID, ["read"], b"\x11\x01\x00\x03", True, False)
        Characteristic(hid, 1, REPORT_MAP_UUID, ["read"], REPORT_DESCRIPTOR, True, False)
        ControlPointCharacteristic(hid, 2)
        ProtocolModeCharacteristic(hid, 3)
        # GATT Report values do not include the Report ID; the Report Reference
        # descriptor carries it for HOGP clients.
        ReportCharacteristic(hid, 4, 1, 8)  # keyboard: modifiers,reserved,6 keys
        ReportCharacteristic(hid, 5, 2, 4)  # mouse: buttons,x,y,wheel
        ReportCharacteristic(hid, 6, 3, 2)  # consumer usage
        ReportCharacteristic(hid, 7, 4, 1)  # system usage

        self.advertisement = Advertisement(self.bus)
        self.agent = Agent(self.bus)
        self._register_agent()
        self.gatt_manager.RegisterApplication(self.application.path, {})
        self.registered = True
        self.advertisement_manager.RegisterAdvertisement(self.advertisement.path, {})
        self.advertising = True
        GLib.io_add_watch(sys.stdin, GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, self._stdin_ready)
        emit("ready", address=self.address, adapter=self.adapter, registered=True,
             transport="ble-hogp", service_uuid=HID_SERVICE_UUID)

    def _find_adapter_path(self):
        objects = self.dbus.Interface(self.bus.get_object(BLUEZ, "/"), DBUS_OBJECT_MANAGER).GetManagedObjects()
        requested_adapter = str(self.adapter or "").strip()
        for object_path, interfaces in objects.items():
            props = interfaces.get(ADAPTER)
            if not props:
                continue
            path = str(object_path)
            address = str(props.get("Address", "")).upper()
            if requested_adapter and path.endswith("/" + requested_adapter):
                return path
            if address == self.address:
                return path
        return None

    def _configure_adapter(self, adapter_object):
        props = self.dbus.Interface(adapter_object, DBUS_PROPERTIES)
        for name, value in (
            ("Powered", self.dbus.Boolean(True)),
            ("Pairable", self.dbus.Boolean(True)),
            ("Discoverable", self.dbus.Boolean(True)),
            ("PairableTimeout", self.dbus.UInt32(0)),
            ("DiscoverableTimeout", self.dbus.UInt32(0)),
            ("Alias", self.dbus.String(self.name)),
        ):
            try:
                props.Set(ADAPTER, name, value)
            except Exception as exc:
                emit("warning", message=f"Unable to set adapter {name}: {exc}")

    def _register_agent(self):
        try:
            manager = self.dbus.Interface(self.bus.get_object(BLUEZ, "/org/bluez"), AGENT_MANAGER)
            manager.RegisterAgent(AGENT_PATH, "NoInputNoOutput")
            self.agent_manager = manager
            self.agent_registered = True
            try:
                manager.RequestDefaultAgent(AGENT_PATH)
            except Exception as exc:
                emit("warning", message=f"Unable to make HID pairing agent default: {exc}")
        except Exception as exc:
            emit("warning", message=f"Unable to register HID pairing agent: {exc}")

    def send_report(self, report):
        data = bytes(report)
        if len(data) < 2:
            raise RuntimeError("HID report must include a report ID and payload")
        report_id = int(data[0])
        characteristic = self.report_characteristics.get(report_id)
        if characteristic is None:
            raise RuntimeError(f"Unknown HID report ID {report_id}")
        characteristic.notify(data[1:])
        return None

    def _stdin_ready(self, source, condition):
        if condition & (self.GLib.IO_HUP | self.GLib.IO_ERR):
            self.shutdown()
            return False
        line = source.readline()
        if not line:
            self.shutdown()
            return False
        try:
            command = json.loads(line)
            action = command.get("action")
            if action == "sequence":
                reports = [base64.b64decode(item, validate=True) for item in command.get("reports", [])]
                delay = max(0, min(0.5, float(command.get("delay_ms", 0)) / 1000.0))
                for index, report in enumerate(reports):
                    self.send_report(report)
                    if delay and index + 1 < len(reports):
                        time.sleep(delay)
                emit("sent", count=len(reports), peer=None)
            elif action == "status":
                emit("status", state={
                    "registered": self.registered,
                    "advertising": self.advertising,
                    "connected": self.notify_count > 0,
                    "peer": None,
                    "transport": "ble-hogp",
                })
            elif action == "stop":
                self.shutdown()
                return False
            else:
                emit("error", message=f"Unknown HID helper action: {action}")
        except Exception as exc:
            emit("error", message=str(exc))
        return True

    def shutdown(self):
        if not self.running:
            if self.mainloop:
                self.mainloop.quit()
            return
        self.running = False
        if self.advertising and self.advertisement_manager and self.advertisement:
            try:
                self.advertisement_manager.UnregisterAdvertisement(self.advertisement.path)
            except Exception:
                pass
        self.advertising = False
        if self.registered and self.gatt_manager and self.application:
            try:
                self.gatt_manager.UnregisterApplication(self.application.path)
            except Exception:
                pass
        self.registered = False
        if self.agent_registered and self.agent_manager:
            try:
                self.agent_manager.UnregisterAgent(AGENT_PATH)
            except Exception:
                pass
        self.agent_registered = False
        if self.mainloop:
            self.mainloop.quit()

    def run(self):
        self.setup()
        self.mainloop.run()
        self.shutdown()


def main():
    parser = argparse.ArgumentParser(description="UC Virtual Remote Bluetooth LE HID peripheral")
    parser.add_argument("--address", required=True)
    parser.add_argument("--adapter", default=None)
    parser.add_argument("--name", default="UC Virtual Remote")
    args = parser.parse_args()

    peripheral = HidPeripheral(args.address.upper(), args.adapter, args.name)

    def stop_handler(_signum, _frame):
        peripheral.shutdown()

    signal.signal(signal.SIGTERM, stop_handler)
    signal.signal(signal.SIGINT, stop_handler)
    try:
        peripheral.run()
        return 0
    except Exception as exc:
        emit("error", message=str(exc))
        try:
            peripheral.shutdown()
        except Exception:
            pass
        return 1


if __name__ == "__main__":
    sys.exit(main())
