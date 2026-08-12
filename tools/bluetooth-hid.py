#!/usr/bin/env python3
import argparse
import base64
import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from html import escape

HID_UUID = "00001124-0000-1000-8000-00805f9b34fb"
PROFILE_PATH = "/com/unfoldedcircle/virtualremote/hid"
PSM_CONTROL = 0x11
PSM_INTERRUPT = 0x13

# Composite keyboard + 5-button relative mouse + consumer-control descriptor.
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
)


def emit(event_type, **data):
    print(json.dumps({"type": event_type, **data}, separators=(",", ":")), flush=True)


def sdp_record(name):
    descriptor = REPORT_DESCRIPTOR.hex()
    safe_name = escape(name, quote=True)
    return f'''<?xml version="1.0" encoding="UTF-8" ?>
<record>
  <attribute id="0x0001"><sequence><uuid value="0x1124" /></sequence></attribute>
  <attribute id="0x0004"><sequence>
    <sequence><uuid value="0x0100" /><uint16 value="0x0011" /></sequence>
    <sequence><uuid value="0x0011" /></sequence>
  </sequence></attribute>
  <attribute id="0x0005"><sequence><uuid value="0x1002" /></sequence></attribute>
  <attribute id="0x0006"><sequence><uint16 value="0x656e" /><uint16 value="0x006a" /><uint16 value="0x0100" /></sequence></attribute>
  <attribute id="0x0009"><sequence><sequence><uuid value="0x1124" /><uint16 value="0x0101" /></sequence></sequence></attribute>
  <attribute id="0x000d"><sequence><sequence>
    <sequence><uuid value="0x0100" /><uint16 value="0x0013" /></sequence>
    <sequence><uuid value="0x0011" /></sequence>
  </sequence></sequence></attribute>
  <attribute id="0x0100"><text value="{safe_name}" /></attribute>
  <attribute id="0x0101"><text value="UC Virtual Remote Bluetooth HID" /></attribute>
  <attribute id="0x0102"><text value="Unfolded.Tools" /></attribute>
  <attribute id="0x0200"><uint16 value="0x0100" /></attribute>
  <attribute id="0x0201"><uint16 value="0x0111" /></attribute>
  <attribute id="0x0202"><uint8 value="0xc0" /></attribute>
  <attribute id="0x0203"><uint8 value="0x00" /></attribute>
  <attribute id="0x0204"><boolean value="true" /></attribute>
  <attribute id="0x0205"><boolean value="true" /></attribute>
  <attribute id="0x0206"><sequence><sequence><uint8 value="0x22" /><text encoding="hex" value="{descriptor}" /></sequence></sequence></attribute>
  <attribute id="0x0207"><sequence><sequence><uint16 value="0x0409" /><uint16 value="0x0100" /></sequence></sequence></attribute>
  <attribute id="0x0208"><boolean value="false" /></attribute>
  <attribute id="0x0209"><boolean value="false" /></attribute>
  <attribute id="0x020a"><boolean value="true" /></attribute>
  <attribute id="0x020b"><uint16 value="0x0100" /></attribute>
  <attribute id="0x020c"><uint16 value="0x0c80" /></attribute>
  <attribute id="0x020d"><boolean value="true" /></attribute>
  <attribute id="0x020e"><boolean value="true" /></attribute>
</record>'''


class HidPeripheral:
    def __init__(self, address, adapter, name):
        self.address = address
        self.adapter = adapter
        self.name = name
        self.bus = None
        self.manager = None
        self.profile = None
        self.mainloop = None
        self.listeners = {}
        self.connections = {}
        self.connection_lock = threading.Lock()
        self.running = True
        self.registered = False

    def setup(self):
        try:
            import dbus
            import dbus.service
            from dbus.mainloop.glib import DBusGMainLoop
            from gi.repository import GLib
        except Exception as exc:
            raise RuntimeError(f"Bluetooth HID requires python3-dbus and python3-gi: {exc}") from exc

        self.dbus = dbus
        self.dbus_service = dbus.service
        self.GLib = GLib
        DBusGMainLoop(set_as_default=True)
        self.bus = dbus.SystemBus()
        self.mainloop = GLib.MainLoop()

        peripheral = self

        class Profile(dbus.service.Object):
            @dbus.service.method("org.bluez.Profile1", in_signature="", out_signature="")
            def Release(self):
                peripheral.running = False
                if peripheral.mainloop:
                    peripheral.mainloop.quit()

            @dbus.service.method("org.bluez.Profile1", in_signature="oha{sv}", out_signature="")
            def NewConnection(self, device, fd, properties):
                descriptor = fd.take()
                conn = socket.socket(fileno=descriptor)
                peripheral._adopt_connection(conn, str(device), "bluez-profile")

            @dbus.service.method("org.bluez.Profile1", in_signature="o", out_signature="")
            def RequestDisconnection(self, device):
                peripheral._disconnect_peer(str(device))

            @dbus.service.method("org.bluez.Profile1", in_signature="o", out_signature="")
            def Cancel(self, device):
                peripheral._disconnect_peer(str(device))

        self.profile = Profile(self.bus, PROFILE_PATH)
        manager_object = self.bus.get_object("org.bluez", "/org/bluez")
        self.manager = dbus.Interface(manager_object, "org.bluez.ProfileManager1")
        options = {
            "Name": dbus.String(self.name),
            "Role": dbus.String("server"),
            "RequireAuthentication": dbus.Boolean(True),
            "RequireAuthorization": dbus.Boolean(False),
            "AutoConnect": dbus.Boolean(True),
            "ServiceRecord": dbus.String(sdp_record(self.name)),
            "Version": dbus.UInt16(0x0101),
            "Features": dbus.UInt16(0),
        }
        self.manager.RegisterProfile(PROFILE_PATH, HID_UUID, options)
        self.registered = True

        self._set_alias()
        self._set_device_class()
        self._start_raw_listener(PSM_CONTROL)
        self._start_raw_listener(PSM_INTERRUPT)
        GLib.io_add_watch(sys.stdin, GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, self._stdin_ready)
        emit("ready", address=self.address, adapter=self.adapter, registered=True)

    def _set_alias(self):
        if not self.adapter:
            return
        try:
            object_path = f"/org/bluez/{self.adapter}"
            adapter_object = self.bus.get_object("org.bluez", object_path)
            props = self.dbus.Interface(adapter_object, "org.freedesktop.DBus.Properties")
            props.Set("org.bluez.Adapter1", "Alias", self.dbus.String(self.name))
        except Exception as exc:
            emit("warning", message=f"Unable to set Bluetooth alias: {exc}")

    def _set_device_class(self):
        if not self.adapter:
            return
        try:
            subprocess.run(
                ["hciconfig", self.adapter, "class", "0x0025c0"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=3,
                check=False,
            )
        except Exception:
            pass

    def _start_raw_listener(self, psm):
        try:
            listener = socket.socket(socket.AF_BLUETOOTH, socket.SOCK_SEQPACKET, socket.BTPROTO_L2CAP)
            listener.bind((self.address, psm))
            listener.listen(4)
            listener.settimeout(1.0)
            self.listeners[psm] = listener
            thread = threading.Thread(target=self._accept_loop, args=(psm, listener), daemon=True)
            thread.start()
        except OSError as exc:
            # BlueZ may own the PSM after RegisterProfile. In that case
            # Profile1.NewConnection delivers the authorized file descriptor.
            if getattr(exc, "errno", None) not in (98, 48, 10048):
                emit("warning", message=f"Unable to bind HID PSM 0x{psm:02x}: {exc}")

    def _accept_loop(self, psm, listener):
        while self.running:
            try:
                conn, peer = listener.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            self._adopt_connection(conn, peer[0] if isinstance(peer, tuple) else str(peer), "raw-l2cap", psm)

    def _socket_psm(self, conn):
        try:
            local = conn.getsockname()
            if isinstance(local, tuple) and len(local) > 1:
                return int(local[1])
        except OSError:
            pass
        return None

    def _adopt_connection(self, conn, peer, source, psm=None):
        psm = psm or self._socket_psm(conn)
        if psm not in (PSM_CONTROL, PSM_INTERRUPT):
            with self.connection_lock:
                if PSM_CONTROL not in self.connections:
                    psm = PSM_CONTROL
                elif PSM_INTERRUPT not in self.connections:
                    psm = PSM_INTERRUPT
                else:
                    psm = PSM_INTERRUPT
        conn.settimeout(1.0)
        with self.connection_lock:
            previous = self.connections.get(psm)
            if previous:
                try:
                    previous[0].close()
                except OSError:
                    pass
            self.connections[psm] = (conn, peer)
        emit("connected", peer=peer, psm=psm, source=source)
        thread = threading.Thread(target=self._read_loop, args=(psm, conn, peer), daemon=True)
        thread.start()

    def _read_loop(self, psm, conn, peer):
        while self.running:
            try:
                data = conn.recv(1024)
                if not data:
                    break
                if psm == PSM_CONTROL:
                    self._handle_control(conn, data)
            except socket.timeout:
                continue
            except OSError:
                break
        with self.connection_lock:
            current = self.connections.get(psm)
            if current and current[0] is conn:
                self.connections.pop(psm, None)
        try:
            conn.close()
        except OSError:
            pass
        emit("disconnected", peer=peer, psm=psm)

    def _handle_control(self, conn, data):
        if not data:
            return
        message_type = data[0] & 0xF0
        try:
            if message_type in (0x50, 0x70):
                conn.send(b"\x00")  # HID handshake: successful
            elif message_type == 0x60:
                conn.send(b"\xa1\x01")  # DATA / report protocol
            elif message_type == 0x40:
                conn.send(b"\x03")  # HID handshake: unsupported request
        except OSError:
            pass

    def _disconnect_peer(self, peer):
        with self.connection_lock:
            targets = [(psm, value) for psm, value in self.connections.items() if value[1] == peer or peer in str(value[1])]
        for psm, (conn, _) in targets:
            try:
                conn.close()
            except OSError:
                pass
            with self.connection_lock:
                self.connections.pop(psm, None)

    def send_report(self, report):
        with self.connection_lock:
            value = self.connections.get(PSM_INTERRUPT)
        if not value:
            raise RuntimeError("No Bluetooth HID interrupt connection is active")
        conn, peer = value
        conn.send(b"\xa1" + report)
        return peer

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
                peer = None
                for index, report in enumerate(reports):
                    peer = self.send_report(report)
                    if delay and index + 1 < len(reports):
                        time.sleep(delay)
                emit("sent", count=len(reports), peer=peer)
            elif action == "status":
                with self.connection_lock:
                    connected = PSM_INTERRUPT in self.connections
                    peer = self.connections.get(PSM_INTERRUPT, (None, None))[1]
                emit("status", state={"registered": self.registered, "connected": connected, "peer": peer})
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
        for listener in list(self.listeners.values()):
            try:
                listener.close()
            except OSError:
                pass
        with self.connection_lock:
            values = list(self.connections.values())
            self.connections.clear()
        for conn, _peer in values:
            try:
                conn.close()
            except OSError:
                pass
        if self.registered and self.manager:
            try:
                self.manager.UnregisterProfile(PROFILE_PATH)
            except Exception:
                pass
        self.registered = False
        if self.mainloop:
            self.mainloop.quit()

    def run(self):
        self.setup()
        self.mainloop.run()
        self.shutdown()


def main():
    parser = argparse.ArgumentParser(description="UC Virtual Remote Bluetooth HID peripheral")
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
