import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../shared/logger.js";
import { runProcess } from "../shared/process.js";

const log = logger("host-hardware");
const SETTING_KEY = "native_hardware";
const ZERO_MAC = "00:00:00:00:00:00";
const SYSTEM_DBUS_ENV = { LC_ALL: "C", DBUS_SYSTEM_BUS_ADDRESS: "unix:path=/run/dbus/system_bus_socket" };

function parseColonLine(line) {
  const fields = [];
  let value = "";
  let escaped = false;
  for (const character of String(line)) {
    if (escaped) {
      value += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === ":") {
      fields.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  if (escaped) value += "\\";
  fields.push(value.trim());
  return fields;
}

function defaultSysRoot() {
  return fs.existsSync("/host/sys") ? "/host/sys" : "/sys";
}

function readText(filename) {
  try { return fs.readFileSync(filename, "utf8").trim(); }
  catch { return ""; }
}

function normalizedMac(value) {
  const match = String(value || "").trim().toUpperCase().match(/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/);
  return match ? match[0] : null;
}

function busctlString(value) {
  const text = String(value || "").trim();
  const quoted = text.match(/^s\s+"([^"]+)"$/);
  return quoted ? quoted[1] : text.replace(/^s\s+/, "").replace(/^"|"$/g, "");
}

function normalizeHexId(value) {
  const match = String(value || "").trim().replace(/^0x/i, "").match(/^[0-9a-f]{4}$/i);
  return match ? match[0].toLowerCase() : null;
}

function classTarget(root, subsystem, device) {
  try {
    const resolved = fs.realpathSync(path.join(root, "class", subsystem, device));
    if (root !== "/sys" && resolved.startsWith("/sys/")) {
      const mapped = path.join(root, resolved.slice("/sys/".length));
      if (fs.existsSync(mapped)) return mapped;
    }
    return resolved;
  } catch {
    return null;
  }
}

function genericHardwareName(value, platformHostname = "") {
  const cleaned = String(value || "")
    .replace(/\s+\[default\]\s*$/i, "")
    .replace(/[_\s]+/g, " ")
    .trim();
  if (!cleaned) return null;
  const base = cleaned.replace(/\s+#\d+\s*$/i, "").trim().toLowerCase();
  const hostname = String(platformHostname || "").trim().toLowerCase();
  if (base === hostname || [
    "debian", "ubuntu", "localhost", "linux", "bluez", "unknown", "n/a", "none"
  ].includes(base)) return null;
  if (/^linux foundation .*root hub$/i.test(cleaned)) return null;
  return cleaned;
}

function parseModalias(value) {
  const text = String(value || "").trim();
  const usb = text.match(/^usb:v([0-9a-f]{4})p([0-9a-f]{4})/i);
  if (usb) return { kind: "usb", vendorId: usb[1].toLowerCase(), productId: usb[2].toLowerCase(), modalias: text };
  if (/^(pci|platform|acpi|serdev|of):/i.test(text)) return { kind: "built-in", vendorId: null, productId: null, modalias: text };
  return { kind: null, vendorId: null, productId: null, modalias: text || null };
}

function physicalDeviceIdentity(root, subsystem, device, platformHostname = "") {
  let current = classTarget(root, subsystem, device);
  if (!current) return { name: null, kind: "unknown", vendorId: null, productId: null, modalias: null };
  const target = current;
  let fallbackName = null;
  let fallbackModalias = null;
  let fallbackKind = target.includes(`${path.sep}usb`) ? "usb" : "built-in";

  for (let depth = 0; depth < 16; depth += 1) {
    const manufacturer = genericHardwareName(readText(path.join(current, "manufacturer")), platformHostname);
    const product = genericHardwareName(readText(path.join(current, "product")), platformHostname);
    const candidates = [];
    for (const candidate of [manufacturer, product]) {
      if (!candidate || candidates.some((item) => item.toLowerCase() === candidate.toLowerCase())) continue;
      candidates.push(candidate);
    }
    if (!fallbackName && candidates.length) fallbackName = candidates.join(" ");

    const modalias = readText(path.join(current, "modalias"));
    const parsed = parseModalias(modalias);
    if (!fallbackModalias && parsed.modalias) fallbackModalias = parsed.modalias;
    if (parsed.kind) fallbackKind = parsed.kind;

    const vendorId = normalizeHexId(readText(path.join(current, "idVendor"))) || parsed.vendorId;
    const productId = normalizeHexId(readText(path.join(current, "idProduct"))) || parsed.productId;
    if (vendorId && productId) {
      return {
        name: candidates.join(" ") || fallbackName,
        kind: "usb",
        vendorId,
        productId,
        modalias: parsed.modalias || fallbackModalias
      };
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return { name: fallbackName, kind: fallbackKind, vendorId: null, productId: null, modalias: fallbackModalias };
}

function physicalDeviceName(root, subsystem, device, platformHostname = "") {
  return physicalDeviceIdentity(root, subsystem, device, platformHostname).name;
}

function adapterKind(root, device, subsystem) {
  return physicalDeviceIdentity(root, subsystem, device).kind;
}

function bluetoothInterfaces(root) {
  try {
    return fs.readdirSync(path.join(root, "class", "bluetooth"))
      .filter((item) => /^hci\d+$/i.test(item))
      .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
  } catch {
    return [];
  }
}

function bluetoothInterface(root, address) {
  const wanted = normalizedMac(address);
  if (!wanted) return null;
  const directory = path.join(root, "class", "bluetooth");
  try {
    for (const device of bluetoothInterfaces(root)) {
      if (normalizedMac(readText(path.join(directory, device, "address"))) === wanted) return device;
    }
  } catch {}
  return null;
}

function bluetoothctlProperties(output) {
  const result = {};
  for (const raw of String(output || "").split(/\r?\n/)) {
    const match = raw.trim().match(/^([A-Za-z][A-Za-z ]+):\s*(.*)$/);
    if (match) result[match[1].trim().toLowerCase().replace(/\s+/g, "_")] = match[2].trim();
  }
  return result;
}

function regexEscape(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bluetoothctlControllerProperties(output, adapterId) {
  const result = {};
  const address = String(adapterId || "").trim();
  if (!address) return result;
  const pattern = new RegExp(String.raw`Controller\s+${regexEscape(address)}\s+(Pairable|Discoverable):\s*(yes|no)`, "gi");
  for (const match of String(output || "").matchAll(pattern)) {
    result[match[1].toLowerCase()] = match[2].toLowerCase();
  }
  return result;
}

function bluetoothctlDeviceList(output) {
  const devices = new Map();
  for (const raw of String(output || "").split(/\r?\n/)) {
    const match = raw.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").trim()
      .match(/(?:^|\s)Device\s+([0-9A-F]{2}(?::[0-9A-F]{2}){5})\s+(.+)$/i);
    if (!match) continue;
    const address = match[1].toUpperCase();
    const name = match[2].trim();
    if (!devices.has(address)) devices.set(address, { address, name });
  }
  return [...devices.values()];
}

function hciIndex(value) {
  const match = String(value || "").trim().match(/^hci(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function bluetoothctlCommandFailed(result) {
  return Number(result?.code || 0) !== 0
    || /(?:^|\n)\s*(?:Failed to|Invalid command|No default controller|Controller .* not available)/i.test(`${result?.stdout || ""}\n${result?.stderr || ""}`);
}

function combinedProcessOutput(result, fallback = "") {
  return [result?.stderr, result?.stdout].map((value) => String(value || "").trim()).filter(Boolean).join("\n") || fallback;
}

function lsusbDeviceName(output, vendorId, productId, platformHostname = "") {
  const wanted = `${vendorId}:${productId}`.toLowerCase();
  for (const raw of String(output || "").split(/\r?\n/)) {
    const match = raw.match(/\bID\s+([0-9a-f]{4}:[0-9a-f]{4})\s*(.*)$/i);
    if (!match || match[1].toLowerCase() !== wanted) continue;
    const name = genericHardwareName(match[2], platformHostname);
    if (name) return name;
  }
  return null;
}

function displayAdapterName(name, device) {
  const base = name || "Bluetooth adapter";
  return device && !base.includes(`(${device})`) ? `${base} (${device})` : base;
}

function selectedOrFirst(selected, values) {
  return values.find((item) => item.id === selected)?.id || values[0]?.id || null;
}

function networkRecord(input, adapter) {
  const signal = Math.max(0, Math.min(100, Number(input.signal || 0)));
  const rawSignalLevel = Number(input.signal_level ?? input.signalLevel);
  const signalLevel = Number.isFinite(rawSignalLevel) ? Math.round(rawSignalLevel) : Math.round(signal / 2 - 100);
  const frequency = Number(input.frequency || input.freq || 0);
  const security = String(input.security || input.auth || "OPEN").trim() || "OPEN";
  const bssid = normalizedMac(input.bssid) || ZERO_MAC;
  const ssid = String(input.ssid || "").trim();
  return {
    id: bssid !== ZERO_MAC ? bssid : ssid,
    ssid,
    ssid_hex: Buffer.from(ssid, "utf8").toString("hex").toLowerCase(),
    signal,
    signal_strength: signal,
    signal_level: signalLevel,
    security,
    auth: security,
    active: Boolean(input.active),
    bssid,
    frequency: String(frequency || ""),
    freq: frequency,
    adapter
  };
}

function uniqueNetworks(values) {
  const strongest = new Map();
  for (const value of values) {
    if (!value.ssid) continue;
    const current = strongest.get(value.ssid);
    if (!current || value.signal > current.signal) strongest.set(value.ssid, value);
  }
  return [...strongest.values()].sort((a, b) => b.signal - a.signal || a.ssid.localeCompare(b.ssid));
}

function parseNmcliNetworks(output, adapter) {
  return uniqueNetworks(String(output || "").split(/\r?\n/).filter(Boolean).map((line) => {
    const [ssid, signal, security, active, bssid, frequency] = parseColonLine(line);
    return networkRecord({ ssid, signal, security, active: active === "*", bssid, frequency }, adapter);
  }));
}

function parseIwNetworks(output, adapter) {
  const results = [];
  let current = null;
  const finish = () => {
    if (!current?.ssid) return;
    let security = "OPEN";
    if (current.sae) security = "WPA3";
    else if (current.rsn) security = "WPA2";
    else if (current.wpa) security = "WPA";
    else if (current.privacy) security = "WEP";
    results.push(networkRecord({ ...current, security }, adapter));
  };
  for (const raw of String(output || "").split(/\r?\n/)) {
    const line = raw.trim();
    const bss = line.match(/^BSS\s+([0-9a-f:]{17})/i);
    if (bss) {
      finish();
      current = { bssid: bss[1], ssid: "", signal: 0, frequency: 0, active: false, privacy: false, rsn: false, wpa: false, sae: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("SSID:")) current.ssid = line.slice(5).trim();
    else if (line.startsWith("freq:")) current.frequency = Number(line.slice(5).trim()) || 0;
    else if (line.startsWith("signal:")) {
      const dbm = Number.parseFloat(line.slice(7));
      current.signalLevel = Number.isFinite(dbm) ? dbm : undefined;
      current.signal = Number.isFinite(dbm) ? Math.max(0, Math.min(100, Math.round((dbm + 100) * 2))) : 0;
    } else if (line.startsWith("capability:") && /\bPrivacy\b/i.test(line)) current.privacy = true;
    else if (/^RSN:/i.test(line)) current.rsn = true;
    else if (/^WPA:/i.test(line)) current.wpa = true;
    else if (/Authentication suites:.*\bSAE\b/i.test(line)) current.sae = true;
  }
  finish();
  return uniqueNetworks(results);
}

function processError(result, fallback) {
  return String(result?.stderr || result?.stdout || fallback || "Command failed").trim();
}

function busyScanError(value) {
  return /device or resource busy|resource busy|\(-16\)|\berrno\s*-?16\b/i.test(String(value || ""));
}

function nmcliListArgs(adapter, rescan = "no", fields = "SSID,SIGNAL,SECURITY,IN-USE,BSSID,FREQ") {
  return [
    "-t", "--escape", "yes", "-f", fields,
    "device", "wifi", "list", "--rescan", rescan, "ifname", adapter
  ];
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function limitedLines(value, limit = 1000) {
  const lines = String(value || "").replace(/\r/g, "").split("\n");
  return lines.slice(-Math.max(1, Math.min(10000, Number(limit || 1000)))).join("\n").trim();
}

function diagnosticSection(title, command, result) {
  const output = [String(result?.stdout || "").trim(), String(result?.stderr || "").trim()].filter(Boolean).join("\n");
  return [`## ${title}`, `$ ${command}`, output || "(no output)"].join("\n");
}

export class HardwareService {
  constructor(platform, options = {}) {
    this.platform = platform;
    this.runner = options.runner || runProcess;
    this.spawnProcess = options.spawnProcess || spawn;
    this.hostDbusAvailable = options.hostDbusAvailable;
    this.sysRoot = options.sysRoot || defaultSysRoot();
    this.cached = { bluetooth: [], wifi: [], selection: { bluetooth_adapter: null, wifi_adapter: null }, capabilities: {} };
    this.wifiScan = { active: false, scan: [], updated_at: null, error: null };
    this.wifiScanPromise = null;
    this.hciLogger = null;
    this.bluetoothPairingSession = null;
    this.lastBluetoothPairingStatus = null;
    this.bluetoothPairingQueue = Promise.resolve();
  }

  async refresh() {
    const selection = this.platform.db.getSetting(SETTING_KEY, {});
    const [bluetooth, wifi] = await Promise.all([this.#bluetoothAdapters(), this.#wifiAdapters()]);
    this.cached = {
      bluetooth,
      wifi,
      selection: {
        bluetooth_adapter: selectedOrFirst(selection.bluetooth_adapter, bluetooth),
        wifi_adapter: selectedOrFirst(selection.wifi_adapter, wifi)
      },
      capabilities: {
        bluetoothctl: await this.#available("bluetoothctl"),
        btmgmt: await this.#available("btmgmt"),
        busctl: await this.#available("busctl"),
        network_manager: await this.#available("nmcli"),
        iw: await this.#available("iw"),
        rfkill: await this.#available("rfkill"),
        btmon: await this.#available("btmon"),
        host_dbus: this.hostDbusAvailable ?? fs.existsSync("/run/dbus/system_bus_socket")
      }
    };
    log.info(`Hardware scan: bluetooth=${bluetooth.length}, wifi=${wifi.length}, selected_bt=${this.cached.selection.bluetooth_adapter || "none"}, selected_wifi=${this.cached.selection.wifi_adapter || "none"}`);
    return this.cached;
  }

  async status(force = false) {
    if (force || (!this.cached.bluetooth.length && !this.cached.wifi.length)) await this.refresh();
    return structuredClone(this.cached);
  }

  bluetoothAddress() {
    const selected = selectedOrFirst(this.cached.selection?.bluetooth_adapter, this.cached.bluetooth || []);
    return normalizedMac(selected) || ZERO_MAC;
  }


  async pairedBluetoothDevices() {
    const status = await this.status(false);
    const adapterId = selectedOrFirst(status.selection?.bluetooth_adapter, status.bluetooth || []);
    const adapter = status.bluetooth.find((item) => item.id === adapterId);
    if (!adapterId || !status.capabilities?.bluetoothctl || !status.capabilities?.host_dbus) {
      return { adapter: adapter?.interface || null, address: adapterId || null, devices: [] };
    }

    const runList = async (command) => this.runner("bluetoothctl", [], {
      timeoutMs: 10_000,
      rejectOnError: false,
      env: SYSTEM_DBUS_ENV,
      input: [`select ${adapterId}`, command, "quit", ""].join("\n")
    });
    let result = await runList("devices Paired");
    let output = `${result.stdout || ""}\n${result.stderr || ""}`;
    let devices = bluetoothctlDeviceList(output);
    if (!devices.length && /invalid command|unknown command/i.test(output)) {
      result = await runList("paired-devices");
      output = `${result.stdout || ""}\n${result.stderr || ""}`;
      devices = bluetoothctlDeviceList(output);
    }

    const detailed = [];
    for (const device of devices) {
      const info = await this.runner("bluetoothctl", [], {
        timeoutMs: 8000,
        rejectOnError: false,
        env: SYSTEM_DBUS_ENV,
        input: [`select ${adapterId}`, `info ${device.address}`, "quit", ""].join("\n")
      }).catch(() => ({ stdout: "", stderr: "" }));
      const properties = bluetoothctlProperties(`${info.stdout || ""}\n${info.stderr || ""}`);
      if (properties.paired && properties.paired !== "yes" && properties.bonded !== "yes") continue;
      detailed.push({
        address: device.address,
        name: properties.name || properties.alias || device.name || device.address,
        paired: properties.paired === "yes" || properties.bonded === "yes" || !properties.paired,
        bonded: properties.bonded === "yes",
        connected: properties.connected === "yes",
        trusted: properties.trusted === "yes"
      });
    }
    return { adapter: adapter?.interface || adapterId, address: adapterId, devices: detailed };
  }

  wifiScanStatus() {
    return structuredClone(this.wifiScan);
  }

  wifiNetworks() {
    return structuredClone(this.wifiScan.scan || []);
  }

  bluetoothPairingStatus() {
    const value = this.bluetoothPairingSession?.status || this.lastBluetoothPairingStatus;
    return value ? structuredClone(value) : null;
  }

  async setSelection(input = {}) {
    const status = await this.status(true);
    const bluetoothAdapter = String(input.bluetooth_adapter || "").trim() || null;
    const wifiAdapter = String(input.wifi_adapter || "").trim() || null;
    if (bluetoothAdapter && !status.bluetooth.some((item) => item.id === bluetoothAdapter)) throw Object.assign(new Error(`Bluetooth adapter ${bluetoothAdapter} was not found`), { status: 422 });
    if (wifiAdapter && !status.wifi.some((item) => item.id === wifiAdapter)) throw Object.assign(new Error(`Wi-Fi adapter ${wifiAdapter} was not found`), { status: 422 });
    const value = { bluetooth_adapter: bluetoothAdapter, wifi_adapter: wifiAdapter };
    this.platform.db.setSetting(SETTING_KEY, value);
    this.cached.selection = {
      bluetooth_adapter: selectedOrFirst(bluetoothAdapter, status.bluetooth),
      wifi_adapter: selectedOrFirst(wifiAdapter, status.wifi)
    };
    log.info(`Hardware selection updated: bluetooth=${bluetoothAdapter || "automatic"}, wifi=${wifiAdapter || "automatic"}`);
    return this.status();
  }

  async setBluetoothPower(enabled) {
    const status = await this.status(true);
    const adapter = selectedOrFirst(status.selection.bluetooth_adapter, status.bluetooth);
    if (!adapter) throw Object.assign(new Error("No Bluetooth adapter is available"), { status: 409 });
    if (!status.capabilities.bluetoothctl || !status.capabilities.host_dbus) throw Object.assign(new Error("Bluetooth control requires BlueZ and the host system D-Bus socket"), { status: 501 });
    const result = await this.#runBluetoothctlTransaction(adapter, [["power", enabled ? "on" : "off"]]);
    if (result.code !== 0) throw Object.assign(new Error(processError(result, "Unable to change Bluetooth power state")), { status: 502 });
    log.info(`Bluetooth adapter ${adapter} power ${enabled ? "enabled" : "disabled"}`);
    return { adapter, powered: Boolean(enabled) };
  }

  async setBluetoothPairing(enabled, advertisementName = "UC Virtual Remote") {
    const operation = () => this.#setBluetoothPairing(Boolean(enabled), advertisementName);
    const pending = this.bluetoothPairingQueue.then(operation, operation);
    this.bluetoothPairingQueue = pending.catch(() => {});
    return pending;
  }

  async #setBluetoothPairing(enabled, advertisementName = "UC Virtual Remote") {
    const status = await this.status(true);
    const adapterId = selectedOrFirst(status.selection.bluetooth_adapter, status.bluetooth);
    const adapter = status.bluetooth.find((item) => item.id === adapterId);
    if (!adapterId) throw Object.assign(new Error("No Bluetooth adapter is available"), { status: 409 });
    if (!status.capabilities.bluetoothctl || !status.capabilities.host_dbus) {
      throw Object.assign(new Error("Bluetooth pairing requires BlueZ and the host system D-Bus socket"), { status: 501 });
    }
    const name = String(advertisementName || "UC Virtual Remote").replace(/[\r\n]+/g, " ").trim() || "UC Virtual Remote";
    const initialValue = {
      enabled: Boolean(enabled), paired: false, state: enabled ? "PAIRING" : "IDLE",
      advertisement_name: name,
      adapter: adapter?.interface || adapterId, address: adapter?.address || adapterId, peer: null
    };
    this.lastBluetoothPairingStatus = initialValue;
    await this.#stopBluetoothPairingSession();

    if (enabled) {
      let lastError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await this.#resetBluetoothPairingState(adapterId, adapter?.interface, status.capabilities);
          await delay(attempt ? 900 : 250);
          await this.#startBluetoothPairingSession(adapterId, adapter?.interface, name, status.capabilities);
          await this.#waitForBluetoothPairingState(adapterId, adapter?.interface, status.capabilities, true);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          await this.#stopBluetoothPairingSession();
          await this.#resetBluetoothPairingState(adapterId, adapter?.interface, status.capabilities).catch(() => {});
          if (attempt === 0 && /busy|in progress|org\.bluez\.error\.busy/i.test(String(error?.message || error))) continue;
          break;
        }
      }
      if (lastError) {
        throw Object.assign(new Error(`Unable to enable Bluetooth pairing: ${lastError.message || lastError}`), { status: 502, code: "BLUETOOTH_PAIRING_FAILED" });
      }
    } else {
      await this.#resetBluetoothPairingState(adapterId, adapter?.interface, status.capabilities);
      await this.#waitForBluetoothPairingState(adapterId, adapter?.interface, status.capabilities, false);
    }
    const value = this.bluetoothPairingSession?.status || initialValue;
    this.lastBluetoothPairingStatus = value;
    this.platform.events?.publish("bluetooth.pairing", { msg: enabled ? "bt_pairing_started" : "bt_pairing_stopped", ...value });
    return structuredClone(value);
  }

  async #bluetoothAdapterProperties(adapterId) {
    const result = await this.runner("bluetoothctl", ["show", adapterId], {
      timeoutMs: 8000,
      rejectOnError: false,
      env: SYSTEM_DBUS_ENV
    });
    if (result.code !== 0) throw new Error(processError(result, `Unable to read Bluetooth adapter ${adapterId}`));
    return bluetoothctlProperties(result.stdout);
  }

  async #bluetoothMgmtProperties(adapterInterface) {
    const index = hciIndex(adapterInterface);
    if (index === null) return {};
    const result = await this.runner("btmgmt", ["--index", String(index), "info"], {
      timeoutMs: 8000,
      rejectOnError: false,
      env: SYSTEM_DBUS_ENV
    });
    if (Number(result.code || 0) !== 0) return {};
    const output = [result.stdout, result.stderr].map((value) => String(value || "")).join("\n");
    const settings = output.match(/current settings:\s*([^\r\n]+)/i)?.[1]?.toLowerCase().split(/\s+/).filter(Boolean) || [];
    return {
      pairable: settings.includes("bondable") ? "yes" : "no",
      discoverable: settings.includes("discoverable") ? "yes" : "no"
    };
  }

  async #waitForBluetoothPairingState(adapterId, adapterInterface, capabilities, enabled) {
    let last = {};
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const bluez = await this.#bluetoothAdapterProperties(adapterId).catch(() => ({}));
      const mgmt = capabilities.btmgmt && adapterInterface
        ? await this.#bluetoothMgmtProperties(adapterInterface).catch(() => ({}))
        : {};
      const session = enabled
        ? bluetoothctlControllerProperties(this.bluetoothPairingSession?.output, adapterId)
        : {};
      last = { bluez, mgmt, session };
      const hasMgmtState = mgmt.pairable !== undefined || mgmt.discoverable !== undefined;
      const pairable = enabled
        ? [session.pairable, mgmt.pairable, bluez.pairable].some((value) => value === "yes")
        : (hasMgmtState ? mgmt.pairable === "yes" : bluez.pairable === "yes");
      const discoverable = enabled
        ? [session.discoverable, mgmt.discoverable, bluez.discoverable].some((value) => value === "yes")
        : (hasMgmtState ? mgmt.discoverable === "yes" : bluez.discoverable === "yes");
      if (enabled ? (pairable && discoverable) : (!pairable && !discoverable)) return last;
      await delay(attempt < 4 ? 250 : 500);
    }
    const output = this.bluetoothPairingSession?.output?.trim();
    const expected = enabled ? "enter" : "leave";
    throw new Error(output || `Bluetooth adapter did not ${expected} pairable/discoverable mode (${JSON.stringify(last)})`);
  }

  async #resetBluetoothPairingState(adapterId, adapterInterface = null, capabilities = {}) {
    if (capabilities.btmgmt && adapterInterface) {
      await this.#setBluetoothMgmtState(adapterInterface, false).catch((error) => log.warn(`Unable to clear ${adapterInterface} pairing state through btmgmt:`, error.message));
    }
    const commands = [["scan", "off"], ["discoverable", "off"], ["pairable", "off"]];
    let result = await this.#runBluetoothctlTransaction(adapterId, commands).catch((error) => ({ code: 1, stderr: error.message }));
    if (bluetoothctlCommandFailed(result) && /busy|in progress/i.test(processError(result))) {
      await delay(350);
      result = await this.#runBluetoothctlTransaction(adapterId, [["discoverable", "off"], ["pairable", "off"]]).catch((error) => ({ code: 1, stderr: error.message }));
    }
    if (bluetoothctlCommandFailed(result) && !/not available|not ready|no default controller|busy|in progress/i.test(processError(result))) {
      throw new Error(processError(result, "Unable to reset Bluetooth pairing state"));
    }
  }

  async #runBluetoothctlTransaction(adapterId, commands) {
    const input = [
      `select ${adapterId}`,
      ...commands.map((args) => args.join(" ")),
      "quit",
      ""
    ].join("\n");
    return this.runner("bluetoothctl", [], {
      timeoutMs: 15_000,
      rejectOnError: false,
      env: SYSTEM_DBUS_ENV,
      input
    });
  }

  async #startBluetoothPairingSession(adapterId, adapterInterface, advertisementName, capabilities = {}) {
    // Use Just Works pairing. The virtual remote has no physical display on
    // which a numeric-comparison code can be confirmed. The peer advertises
    // that MITM protection is not required, so NoInputNoOutput is the correct
    // capability and lets BlueZ accept the confirmation automatically.
    const child = this.spawnProcess("bluetoothctl", ["--agent", "NoInputNoOutput"], {
      env: { ...process.env, ...SYSTEM_DBUS_ENV },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const session = {
      process: child,
      adapterId,
      output: "",
      lineBuffer: "",
      exited: false,
      completed: false,
      answeredPrompts: new Set(),
      peers: new Map(),
      status: {
        enabled: true,
        paired: false,
        state: "PAIRING",
        advertisement_name: advertisementName,
        adapter: adapterInterface || adapterId,
        address: adapterId,
        peer: null
      }
    };
    this.lastBluetoothPairingStatus = session.status;
    this.bluetoothPairingSession = session;
    const publishCompletion = (success, reason = null) => {
      if (session.completed) return;
      session.completed = true;
      session.status = {
        ...session.status,
        paired: Boolean(success),
        state: success ? "PAIRED" : "ERROR",
        ...(reason ? { reason: String(reason) } : {})
      };
      this.lastBluetoothPairingStatus = session.status;
      this.platform.events?.publish("bluetooth.pairing", {
        msg: "bt_pairing_complete",
        success: Boolean(success),
        ...session.status
      });
    };
    const processLine = (line) => {
      const text = String(line || "").trim();
      if (!text) return;
      const device = text.match(/(?:\[(?:NEW|CHG)\]\s+)?Device\s+([0-9A-F]{2}(?::[0-9A-F]{2}){5})\s+(.+)/i);
      if (device) {
        const address = device[1].toUpperCase();
        const detail = device[2].trim();
        const existing = session.peers.get(address) || { address, name: null };
        if (!/^(?:Connected|Paired|Bonded|Trusted|Blocked|ServicesResolved|RSSI):/i.test(detail)) existing.name = detail;
        session.peers.set(address, existing);
        session.status = { ...session.status, peer: { address, ...(existing.name ? { name: existing.name } : {}) } };
        this.lastBluetoothPairingStatus = session.status;
        if (/^(?:Paired|Bonded):\s*yes\b/i.test(detail)) publishCompletion(true);
        if (/^Connected:\s*no\b/i.test(detail) && !session.completed) session.status = { ...session.status, state: "PAIRING" };
      }
      if (/Pairing successful/i.test(text)) publishCompletion(true);
      const failure = text.match(/(?:Failed to pair|AuthenticationFailed|AuthenticationCanceled|AuthenticationRejected|AuthenticationTimeout)[^\r\n]*/i);
      if (failure) publishCompletion(false, failure[0]);
    };
    const capture = (chunk) => {
      const raw = String(chunk || "");
      session.output = `${session.output}${raw}`.slice(-16_384);
      const normalized = session.output.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
      const cleanChunk = raw.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
      session.lineBuffer += cleanChunk.replace(/\r/g, "\n");
      const lines = session.lineBuffer.split("\n");
      session.lineBuffer = lines.pop() || "";
      for (const line of lines) processLine(line);
      const prompts = [
        /Confirm passkey[^\r\n]*(?:\(yes\/no\)|yes\/no)/ig,
        /Request confirmation[^\r\n]*(?:\(yes\/no\)|yes\/no)/ig,
        /Authorize service[^\r\n]*(?:\(yes\/no\)|yes\/no)/ig,
        /Accept pairing[^\r\n]*(?:\(yes\/no\)|yes\/no)/ig
      ];
      for (const pattern of prompts) {
        for (const match of normalized.matchAll(pattern)) {
          const key = match[0].replace(/\s+/g, " ").trim().toLowerCase();
          if (session.answeredPrompts.has(key)) continue;
          session.answeredPrompts.add(key);
          if (child.stdin?.writable) child.stdin.write("yes\n");
          log.info(`Accepted Bluetooth pairing prompt for ${adapterId}: ${match[0].replace(/\s+/g, " ").trim()}`);
        }
      }
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.once("exit", () => {
      session.exited = true;
      if (this.bluetoothPairingSession === session) this.bluetoothPairingSession = null;
    });
    const startupError = new Promise((_, reject) => child.once("error", reject));
    const waitForOutput = (pattern, timeoutMs = 5000) => new Promise((resolve, reject) => {
      if (pattern.test(session.output)) return resolve();
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(session.output.trim() || "Timed out waiting for bluetoothctl pairing agent"));
      }, timeoutMs);
      const check = () => {
        if (!pattern.test(session.output)) return;
        cleanup();
        resolve();
      };
      const exited = () => {
        cleanup();
        reject(new Error(session.output.trim() || "bluetoothctl pairing agent exited unexpectedly"));
      };
      const cleanup = () => {
        clearTimeout(timer);
        child.stdout?.off("data", check);
        child.stderr?.off("data", check);
        child.off("exit", exited);
      };
      child.stdout?.on("data", check);
      child.stderr?.on("data", check);
      child.once("exit", exited);
    });
    try {
      await Promise.race([waitForOutput(/Agent registered/i), startupError]);
      if (session.exited || child.killed || !child.stdin?.writable) throw new Error(session.output.trim() || "bluetoothctl pairing agent exited unexpectedly");
      child.stdin.write(`select ${adapterId}\n`);
      await Promise.race([delay(150), startupError]);
      child.stdin.write("default-agent\n");
      await Promise.race([waitForOutput(/Default agent request successful/i, 4000), startupError]);

      const setup = await this.#runBluetoothctlTransaction(adapterId, [
        ["power", "on"],
        ["system-alias", advertisementName],
        ["discoverable-timeout", "0"]
      ]);
      if (bluetoothctlCommandFailed(setup)) throw new Error(processError(setup, "Unable to prepare Bluetooth adapter for pairing"));

      if (capabilities.btmgmt && adapterInterface) {
        // btmgmt is the authoritative controller path. bluetoothctl may return
        // exit code 0 while BlueZ silently keeps Pairable/Discoverable disabled.
        await this.#setBluetoothMgmtState(adapterInterface, true);
      } else {
        const enable = await this.#runBluetoothctlTransaction(adapterId, [["pairable", "on"], ["discoverable", "on"]]);
        if (bluetoothctlCommandFailed(enable)) throw new Error(combinedProcessOutput(enable, "Unable to enable Bluetooth pairing"));
      }
    } catch (error) {
      await this.#stopBluetoothPairingSession();
      throw error;
    }
  }

  async #setBluetoothMgmtState(adapterInterface, enabled) {
    const index = hciIndex(adapterInterface);
    if (index === null) throw new Error(`Invalid Bluetooth HCI interface ${adapterInterface}`);
    const run = async (command, state, { ignore = false } = {}) => {
      const result = await this.runner("btmgmt", ["--index", String(index), command, state], {
        timeoutMs: 10_000,
        rejectOnError: false,
        env: SYSTEM_DBUS_ENV
      });
      if (!ignore && Number(result.code || 0) !== 0) throw new Error(processError(result, `btmgmt ${command} ${state} failed`));
      return result;
    };
    if (!enabled) {
      await run("discov", "no", { ignore: true });
      await run("bondable", "off", { ignore: true });
      return;
    }
    await run("power", "off", { ignore: true });
    await delay(250);
    await run("power", "on");
    await delay(500);
    await run("bredr", "on", { ignore: true });
    await run("le", "on", { ignore: true });
    await run("ssp", "on", { ignore: true });
    await run("io-cap", "3", { ignore: true });
    await run("bondable", "on");
    await run("connectable", "on");
    await run("discov", "yes");
  }

  async #stopBluetoothPairingSession() {
    const session = this.bluetoothPairingSession;
    this.bluetoothPairingSession = null;
    const child = session?.process;
    if (!child || child.killed) return;
    try {
      if (child.stdin?.writable) {
        child.stdin.write("discoverable off\npairable off\nagent off\nquit\n");
        child.stdin.end();
      }
    } catch {}
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(600)
    ]);
    if (!child.killed && !session.exited) {
      try { child.kill("SIGTERM"); } catch {}
    }
  }

  async clearBluetoothPairing(peerAddress = null) {
    const status = await this.status(true);
    const adapterId = selectedOrFirst(status.selection.bluetooth_adapter, status.bluetooth);
    const options = { timeoutMs: 12_000, rejectOnError: false, env: SYSTEM_DBUS_ENV };
    if (adapterId) await this.runner("bluetoothctl", ["select", adapterId], options).catch(() => {});
    if (peerAddress) await this.runner("bluetoothctl", ["remove", String(peerAddress)], options).catch(() => {});
    return this.setBluetoothPairing(false);
  }

  async setHciLogging(enabled) {
    if (!enabled) {
      this.stopHciLogging();
      return { enabled: false, path: null };
    }
    if (this.hciLogger?.process && !this.hciLogger.process.killed) {
      return { enabled: true, path: this.hciLogger.path, adapter: this.hciLogger.adapter };
    }
    const status = await this.status(true);
    const selected = selectedOrFirst(status.selection.bluetooth_adapter, status.bluetooth);
    const adapter = status.bluetooth.find((item) => item.id === selected);
    if (!adapter?.interface) throw Object.assign(new Error("No Bluetooth HCI interface is available"), { status: 409 });
    if (!status.capabilities.btmon) throw Object.assign(new Error("HCI logging requires the BlueZ btmon utility"), { status: 501 });
    const directory = path.join(this.platform.dataDir, "logs");
    const filename = path.join(directory, "bluetooth-hci.btsnoop");
    fs.mkdirSync(directory, { recursive: true });
    const child = this.spawnProcess("btmon", ["-i", adapter.interface, "-w", filename], {
      stdio: ["ignore", "ignore", "pipe"]
    });
    this.hciLogger = { process: child, path: filename, adapter: adapter.interface };
    child.stderr.on("data", (chunk) => log.warn(`btmon: ${String(chunk).trim()}`));
    child.once("error", (error) => {
      log.warn(`Unable to start HCI logging: ${error.message}`);
      if (this.hciLogger?.process === child) this.hciLogger = null;
    });
    child.once("exit", (code, signal) => {
      if (this.hciLogger?.process === child) this.hciLogger = null;
      if (code && code !== 0) log.warn(`HCI logger exited: code=${code}, signal=${signal || "none"}`);
    });
    log.info(`HCI logging enabled: adapter=${adapter.interface}, file=${filename}`);
    return { enabled: true, path: filename, adapter: adapter.interface };
  }

  stopHciLogging() {
    const loggerProcess = this.hciLogger?.process;
    const previous = this.hciLogger;
    this.hciLogger = null;
    if (loggerProcess && !loggerProcess.killed) {
      try { loggerProcess.kill("SIGTERM"); } catch {}
    }
    if (previous) log.info(`HCI logging disabled: adapter=${previous.adapter}`);
    return { enabled: false, path: previous?.path || null };
  }

  async hciLogStatus() {
    const status = await this.status(false);
    const configuredPath = this.hciLogger?.path || path.join(this.platform.dataDir, "logs", "bluetooth-hci.btsnoop");
    const exists = fs.existsSync(configuredPath);
    const stat = exists ? fs.statSync(configuredPath) : null;
    return {
      available: Boolean(status.capabilities?.btmon),
      enabled: Boolean(this.hciLogger?.process && !this.hciLogger.process.killed),
      adapter: this.hciLogger?.adapter || status.bluetooth.find((item) => item.id === status.selection?.bluetooth_adapter)?.interface || null,
      path: exists ? configuredPath : null,
      size: stat?.size || 0,
      updated_at: stat?.mtime?.toISOString?.() || null
    };
  }

  async hciLogText(options = {}) {
    const limit = Math.max(1, Math.min(10000, Number(options.limit || 1000)));
    const status = await this.hciLogStatus();
    if (!status.path) {
      return status.available
        ? "Bluetooth HCI capture is not active and no previous capture is available. Start HCI capture to collect packets."
        : "Bluetooth HCI capture is unavailable because the BlueZ btmon utility is not installed.";
    }
    const result = await this.runner("btmon", ["-r", status.path], { timeoutMs: 30_000, rejectOnError: false });
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    if (!output) return `Bluetooth HCI capture exists at ${status.path}, but btmon returned no decoded packets.`;
    return limitedLines(output, limit);
  }

  async wifiLogText(options = {}) {
    const limit = Math.max(50, Math.min(10000, Number(options.limit || 1000)));
    const status = await this.status(false);
    const adapter = selectedOrFirst(status.selection?.wifi_adapter, status.wifi || []);
    if (!adapter) return "No Wi-Fi adapter is currently available.";

    const sections = [
      `# Wi-Fi adapter diagnostics`,
      `Generated: ${new Date().toISOString()}`,
      `Adapter: ${adapter}`
    ];
    const run = async (title, command, args, extra = {}) => {
      try {
        const result = await this.runner(command, args, { timeoutMs: 20_000, rejectOnError: false, ...extra });
        sections.push(diagnosticSection(title, result.command || [command, ...args].join(" "), result));
      } catch (error) {
        sections.push([`## ${title}`, `$ ${[command, ...args].join(" ")}`, `ERROR: ${error.message}`].join("\n"));
      }
    };

    if (status.capabilities?.network_manager && status.capabilities?.host_dbus) {
      await run("NetworkManager device", "nmcli", [
        "-f", "GENERAL.STATE,GENERAL.CONNECTION,GENERAL.HWADDR,GENERAL.MTU,IP4.ADDRESS,IP4.GATEWAY,IP4.DNS,IP6.ADDRESS",
        "device", "show", adapter
      ], { env: SYSTEM_DBUS_ENV });
      await run("Visible networks", "nmcli", [
        "-f", "IN-USE,SSID,BSSID,CHAN,FREQ,RATE,SIGNAL,SECURITY",
        "device", "wifi", "list", "--rescan", "no", "ifname", adapter
      ], { env: SYSTEM_DBUS_ENV });
    } else {
      sections.push("## NetworkManager\nHost NetworkManager or the system D-Bus socket is unavailable.");
    }
    if (status.capabilities?.iw) {
      await run("Current wireless link", "iw", ["dev", adapter, "link"]);
      await run("Station information", "iw", ["dev", adapter, "station", "dump"]);
    }
    if (status.capabilities?.rfkill) await run("Radio block state", "rfkill", ["list", "wifi"]);
    else sections.push("## Radio block state\nThe rfkill utility is not installed in the application environment; NetworkManager still reports the selected adapter as connected.");
    return limitedLines(sections.join("\n\n"), limit);
  }

  async setWifiPower(enabled) {
    const status = await this.status(true);
    if (!status.capabilities.network_manager || !status.capabilities.host_dbus) {
      throw Object.assign(new Error("Wi-Fi control requires NetworkManager and the host system D-Bus socket"), { status: 501 });
    }
    const result = await this.runner("nmcli", ["radio", "wifi", enabled ? "on" : "off"], {
      timeoutMs: 15_000,
      rejectOnError: false,
      env: SYSTEM_DBUS_ENV
    });
    if (result.code !== 0) throw Object.assign(new Error(processError(result, "Unable to change Wi-Fi radio state")), { status: 502 });
    if (enabled) {
      const adapter = selectedOrFirst(status.selection.wifi_adapter, status.wifi);
      if (adapter) await this.#prepareWifiAdapter(adapter);
    }
    await this.refresh();
    this.platform.events?.publish("wifi.change", { event: enabled ? "ENABLED" : "DISABLED" });
    return this.wifiStatus();
  }

  async stop() {
    await this.#stopBluetoothPairingSession();
    this.stopHciLogging();
  }

  async wifiStatus() {
    const status = await this.status(true);
    const adapter = selectedOrFirst(status.selection.wifi_adapter, status.wifi);
    if (!adapter) return { wpa_state: "DISCONNECTED", ssid: null, address: null, ip_address: null, adapter: null, freq: 0 };
    if (!status.capabilities.network_manager || !status.capabilities.host_dbus) return { wpa_state: "UNKNOWN", ssid: null, address: null, ip_address: null, adapter, freq: 0 };
    const result = await this.runner("nmcli", ["-t", "--escape", "yes", "-f", "GENERAL.STATE,GENERAL.CONNECTION,GENERAL.HWADDR,IP4.ADDRESS", "device", "show", adapter], { timeoutMs: 8000, rejectOnError: false });
    const values = {};
    for (const line of String(result.stdout || "").split(/\r?\n/)) {
      const [key, ...parts] = parseColonLine(line);
      if (key) values[key] = parts.join(":");
    }
    const connected = String(values["GENERAL.STATE"] || "").startsWith("100");
    return {
      wpa_state: connected ? "COMPLETED" : "DISCONNECTED",
      ssid: connected ? values["GENERAL.CONNECTION"] || null : null,
      address: normalizedMac(values["GENERAL.HWADDR"]) || values["GENERAL.HWADDR"] || null,
      ip_address: String(values["IP4.ADDRESS[1]"] || "").split("/")[0] || null,
      adapter,
      freq: 0
    };
  }

  async #prepareWifiAdapter(adapter) {
    const options = { timeoutMs: 12_000, rejectOnError: false, env: SYSTEM_DBUS_ENV };
    await this.runner("rfkill", ["unblock", "wifi"], options).catch(() => {});
    await this.runner("nmcli", ["networking", "on"], options).catch(() => {});
    await this.runner("nmcli", ["radio", "wifi", "on"], options).catch(() => {});
    await this.runner("nmcli", ["device", "set", adapter, "managed", "yes"], options).catch(() => {});
    await this.runner("ip", ["link", "set", "dev", adapter, "up"], options).catch(() => {});
  }

  async #nmcliWifiList(adapter, rescan = "no") {
    const fieldSets = [
      "SSID,SIGNAL,SECURITY,IN-USE,BSSID,FREQ",
      "SSID,SIGNAL,SECURITY,IN-USE,BSSID",
      "SSID,SIGNAL,SECURITY,IN-USE"
    ];
    let last = { code: 1, stdout: "", stderr: "nmcli Wi-Fi list failed" };
    for (const fields of fieldSets) {
      const result = await this.runner("nmcli", nmcliListArgs(adapter, rescan, fields), {
        timeoutMs: rescan === "yes" ? 30_000 : 15_000,
        rejectOnError: false,
        env: SYSTEM_DBUS_ENV
      });
      last = result;
      if (result.code === 0) return { result, networks: parseNmcliNetworks(result.stdout, adapter) };
      if (!/invalid field|unknown field|not a valid field/i.test(processError(result))) break;
    }
    return { result: last, networks: [] };
  }

  async scanWifi() {
    if (this.wifiScanPromise) return this.wifiScanPromise;
    this.wifiScan.active = true;
    this.wifiScan.error = null;
    this.platform.events?.publish("wifi.change", { event: "SCAN_STARTED" });
    this.wifiScanPromise = this.#scanWifi().then((networks) => {
      this.wifiScan.scan = networks;
      this.wifiScan.updated_at = new Date().toISOString();
      this.platform.events?.publish("wifi.change", { event: "SCAN_COMPLETED" });
      log.info(`Wi-Fi scan completed: adapter=${networks[0]?.adapter || this.cached.selection?.wifi_adapter || "unknown"}, networks=${networks.length}`);
      return structuredClone(networks);
    }).catch((error) => {
      this.wifiScan.error = error.message;
      this.platform.events?.publish("wifi.change", { event: "SCAN_FAILED" });
      log.warn("Wi-Fi scan failed:", error.message);
      throw error;
    }).finally(() => {
      this.wifiScan.active = false;
      this.wifiScanPromise = null;
    });
    return this.wifiScanPromise;
  }

  async #scanWifi() {
    const status = await this.status(true);
    const adapter = selectedOrFirst(status.selection.wifi_adapter, status.wifi);
    if (!adapter) throw Object.assign(new Error("No Wi-Fi adapter is available"), { status: 409 });

    const previous = this.wifiNetworks().filter((item) => item.adapter === adapter);
    const errors = [];
    let sawBusy = false;
    const rememberError = (result, fallback) => {
      const message = processError(result, fallback);
      if (busyScanError(message)) sawBusy = true;
      else if (message) errors.push(message);
    };

    if (status.capabilities.network_manager && status.capabilities.host_dbus) {
      await this.#prepareWifiAdapter(adapter);

      // Read the host NetworkManager cache first. Try progressively smaller
      // field sets because the container nmcli client can be newer than the
      // NetworkManager daemon running on the host.
      let listed = await this.#nmcliWifiList(adapter, "no");
      if (listed.networks.length) return listed.networks;
      if (listed.result.code !== 0) rememberError(listed.result, "nmcli Wi-Fi list failed");

      // Trigger a scan through NetworkManager. EBUSY means the host already has
      // a scan in progress, so keep polling rather than failing the request.
      const rescan = await this.runner("nmcli", ["device", "wifi", "rescan", "ifname", adapter], {
        timeoutMs: 15_000,
        rejectOnError: false,
        env: SYSTEM_DBUS_ENV
      });
      if (rescan.code !== 0) rememberError(rescan, "nmcli Wi-Fi rescan failed");
      for (const wait of [500, 1000, 1500, 2500, 4000]) {
        await delay(wait);
        listed = await this.#nmcliWifiList(adapter, "no");
        if (listed.networks.length) return listed.networks;
        if (listed.result.code !== 0) rememberError(listed.result, "nmcli Wi-Fi list failed");
      }

      // Some NetworkManager versions only return the completed BSS list from a
      // list call that requested the rescan itself.
      listed = await this.#nmcliWifiList(adapter, "yes");
      if (listed.networks.length) return listed.networks;
      if (listed.result.code !== 0) rememberError(listed.result, "nmcli Wi-Fi scan failed");
    }

    if (status.capabilities.iw) {
      // `scan dump` reads the kernel cache without starting another scan and
      // therefore works while NetworkManager owns the interface.
      let result = await this.runner("iw", ["dev", adapter, "scan", "dump"], { timeoutMs: 15_000, rejectOnError: false });
      let networks = result.code === 0 ? parseIwNetworks(result.stdout, adapter) : [];
      if (networks.length) return networks;
      if (result.code !== 0) rememberError(result, "iw Wi-Fi scan cache failed");

      // A synchronous nl80211 scan is the most reliable fallback on hosts
      // where NetworkManager does not expose its BSS cache to the container.
      // It can still return EBUSY while another scan is active, in which case
      // the trigger/dump polling path below takes over.
      const direct = await this.runner("iw", ["dev", adapter, "scan"], { timeoutMs: 35_000, rejectOnError: false });
      networks = direct.code === 0 ? parseIwNetworks(direct.stdout, adapter) : [];
      if (networks.length) return networks;
      if (direct.code !== 0) rememberError(direct, "iw Wi-Fi scan failed");

      // Ask nl80211 to start a scan as a final fallback. When NetworkManager
      // already owns an in-flight scan this may return -EBUSY; that is not a
      // failure. Poll the kernel BSS cache either way until results arrive.
      const trigger = await this.runner("iw", ["dev", adapter, "scan", "trigger"], { timeoutMs: 15_000, rejectOnError: false });
      if (trigger.code !== 0) rememberError(trigger, "iw Wi-Fi scan trigger failed");
      for (const wait of [400, 800, 1200, 2000, 3000]) {
        await delay(wait);
        result = await this.runner("iw", ["dev", adapter, "scan", "dump"], { timeoutMs: 15_000, rejectOnError: false });
        networks = result.code === 0 ? parseIwNetworks(result.stdout, adapter) : [];
        if (networks.length) return networks;
        if (result.code !== 0) rememberError(result, "iw Wi-Fi scan cache failed");
      }
    }

    if (previous.length) {
      log.warn(`Wi-Fi scan returned no fresh results for ${adapter}; keeping ${previous.length} cached network(s)`);
      return previous;
    }
    if (!status.capabilities.network_manager && !status.capabilities.iw) throw Object.assign(new Error("Wi-Fi scanning requires NetworkManager or iw"), { status: 501 });
    if (errors.length) throw Object.assign(new Error([...new Set(errors)].join("; ")), { status: 502 });
    if (sawBusy) {
      log.warn(`Wi-Fi scan for ${adapter} is already in progress on the host; returning an empty cached result instead of failing`);
      return [];
    }
    return [];
  }

  async connectWifi(input = {}) {
    const status = await this.status(true);
    const adapter = selectedOrFirst(status.selection.wifi_adapter, status.wifi);
    const ssid = String(input.ssid || (input.ssid_hex ? Buffer.from(String(input.ssid_hex), "hex").toString("utf8") : "")).trim();
    if (!adapter) throw Object.assign(new Error("No Wi-Fi adapter is available"), { status: 409 });
    if (!ssid) throw Object.assign(new Error("SSID is required"), { status: 422 });
    if (!status.capabilities.network_manager || !status.capabilities.host_dbus) throw Object.assign(new Error("Wi-Fi configuration requires NetworkManager and the host system D-Bus socket"), { status: 501 });
    await this.#prepareWifiAdapter(adapter);

    const visible = (this.wifiScan.scan || []).some((item) => item.adapter === adapter && item.ssid === ssid);
    const hidden = input.hidden === true || input.ssid_override === true || !visible;
    const networks = this.savedWifiNetworks();
    let stored = networks.find((item) => item.ssid === ssid);
    if (!stored) {
      const id = networks.reduce((maximum, item) => Math.max(maximum, Number(item.id) || 0), 0) + 1;
      stored = {
        id, ssid, ssid_hex: Buffer.from(ssid, "utf8").toString("hex"),
        password: input.password ? String(input.password) : null,
        enabled: true, selected: false, hidden,
        connection_id: String(input.connection_id || `UCVR ${ssid}`),
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
      networks.push(stored);
    } else {
      if (input.password !== undefined) stored.password = String(input.password || "") || null;
      stored.hidden = hidden;
      stored.enabled = true;
    }

    const profile = await this.#ensureNetworkManagerProfile(stored, adapter);
    let result = await this.runner("nmcli", ["--wait", "60", "connection", "up", profile, "ifname", adapter], {
      timeoutMs: 70_000, rejectOnError: false,
      redacted: stored.password ? [String(stored.password)] : [], env: SYSTEM_DBUS_ENV
    });
    // Visible networks can still use NetworkManager's direct-connect helper as
    // a compatibility fallback for unusual host profiles.
    if (result.code !== 0 && !hidden) {
      const args = ["--wait", "60", "device", "wifi", "connect", ssid, "ifname", adapter];
      if (stored.password) args.push("password", String(stored.password));
      result = await this.runner("nmcli", args, { timeoutMs: 70_000, rejectOnError: false, redacted: stored.password ? [String(stored.password)] : [], env: SYSTEM_DBUS_ENV });
    }
    if (result.code !== 0) throw Object.assign(new Error(processError(result, `Unable to connect ${adapter} to ${ssid}`)), { status: 502 });

    for (const item of networks) item.selected = item === stored;
    stored.enabled = true;
    stored.updated_at = new Date().toISOString();
    this.#storeWifiNetworks(networks, "CONNECTED");
    log.info(`Wi-Fi adapter ${adapter} connected to ${ssid}${hidden ? " (hidden/override profile)" : ""}`);
    return this.wifiStatus();
  }

  async #ensureNetworkManagerProfile(item, adapter) {
    const name = String(item.connection_id || item.ssid || `ucvr-wifi-${item.id}`);
    const options = {
      timeoutMs: 20_000,
      rejectOnError: false,
      env: SYSTEM_DBUS_ENV,
      redacted: item.password ? [String(item.password)] : []
    };
    const listed = await this.runner("nmcli", ["-t", "-f", "NAME", "connection", "show"], options);
    const names = String(listed.stdout || "").split(/\r?\n/).map((value) => value.replace(/\:/g, ":").trim()).filter(Boolean);
    if (!names.includes(name)) {
      const created = await this.runner("nmcli", [
        "connection", "add", "type", "wifi", "ifname", adapter,
        "con-name", name, "ssid", String(item.ssid)
      ], options);
      if (created.code !== 0) throw Object.assign(new Error(processError(created, `Unable to create Wi-Fi profile ${name}`)), { status: 502 });
    }
    const base = await this.runner("nmcli", [
      "connection", "modify", name,
      "connection.autoconnect", item.enabled === false ? "no" : "yes",
      "802-11-wireless.ssid", String(item.ssid),
      "802-11-wireless.mode", "infrastructure",
      "802-11-wireless.hidden", item.hidden ? "yes" : "no",
      "ipv4.method", "auto",
      "ipv6.method", "auto"
    ], options);
    if (base.code !== 0) throw Object.assign(new Error(processError(base, `Unable to update Wi-Fi profile ${name}`)), { status: 502 });
    const securityArgs = item.password
      ? ["connection", "modify", name, "wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.psk", String(item.password)]
      : ["connection", "modify", name, "wifi-sec.key-mgmt", "none", "wifi-sec.psk", ""];
    const secured = await this.runner("nmcli", securityArgs, options);
    if (secured.code !== 0) throw Object.assign(new Error(processError(secured, `Unable to set Wi-Fi security for ${name}`)), { status: 502 });
    item.connection_id = name;
    return name;
  }

  savedWifiNetworks() {
    return structuredClone(this.platform.db.getSetting("wifi_networks", []));
  }

  #storeWifiNetworks(values, eventName = "NETWORK_ADDED") {
    const stored = values.map((item) => ({ ...item, id: Number(item.id) }));
    this.platform.db.setSetting("wifi_networks", stored);
    this.platform.events?.publish("wifi.change", { event: eventName });
    return stored;
  }

  #publicWifiNetwork(item) {
    if (!item) return null;
    const { password: _password, enabled: _enabled, selected: _selected, created_at: _createdAt, updated_at: _updatedAt, ...publicItem } = item;
    return {
      ...publicItem,
      id: Number(item.id),
      ssid: String(item.ssid || ""),
      ssid_hex: String(item.ssid_hex || Buffer.from(String(item.ssid || ""), "utf8").toString("hex")).toLowerCase(),
      secured: Boolean(item.password),
      state: item.selected ? "CONNECTED" : item.enabled === false ? "DISABLED" : "OUT_OF_RANGE"
    };
  }

  async addWifiNetwork(input = {}) {
    const values = this.savedWifiNetworks();
    const ssid = String(input.ssid || (input.ssid_hex ? Buffer.from(String(input.ssid_hex), "hex").toString("utf8") : "")).trim();
    if (!ssid) throw Object.assign(new Error("SSID or ssid_hex is required"), { status: 400 });
    const existing = values.find((item) => item.ssid === ssid || (input.ssid_hex && item.ssid_hex === String(input.ssid_hex).toLowerCase()));
    if (existing) throw Object.assign(new Error(`Wi-Fi network ${ssid} already exists`), { status: 409 });
    const status = await this.status(true);
    const adapter = selectedOrFirst(status.selection.wifi_adapter, status.wifi);
    if (!adapter) throw Object.assign(new Error("No Wi-Fi adapter is available"), { status: 409 });
    const id = values.reduce((maximum, item) => Math.max(maximum, Number(item.id) || 0), 0) + 1;
    const item = {
      id,
      ssid,
      ssid_hex: String(input.ssid_hex || Buffer.from(ssid, "utf8").toString("hex")).toLowerCase(),
      password: input.password ? String(input.password) : null,
      enabled: true,
      selected: false,
      connection_id: String(input.connection_id || `UCVR ${ssid}`),
      hidden: input.hidden === true || input.ssid_override === true || !(this.wifiScan.scan || []).some((network) => network.adapter === adapter && network.ssid === ssid),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (status.capabilities.network_manager && status.capabilities.host_dbus) {
      await this.#prepareWifiAdapter(adapter);
      await this.#ensureNetworkManagerProfile(item, adapter);
    }
    values.push(item);
    this.#storeWifiNetworks(values, "NETWORK_ADDED");
    return this.#publicWifiNetwork(item);
  }

  getWifiNetwork(id) {
    return this.#publicWifiNetwork(this.savedWifiNetworks().find((item) => Number(item.id) === Number(id)));
  }

  async updateWifiNetwork(id, patch = {}) {
    const values = this.savedWifiNetworks();
    const index = values.findIndex((item) => Number(item.id) === Number(id));
    if (index < 0) return null;
    values[index] = {
      ...values[index],
      ...(patch.password !== undefined ? { password: String(patch.password || "") || null } : {}),
      ...(patch.hidden !== undefined ? { hidden: Boolean(patch.hidden) } : {}),
      updated_at: new Date().toISOString()
    };
    const status = await this.status(true);
    const adapter = selectedOrFirst(status.selection.wifi_adapter, status.wifi);
    if (adapter && status.capabilities.network_manager && status.capabilities.host_dbus) {
      await this.#ensureNetworkManagerProfile(values[index], adapter);
    }
    this.#storeWifiNetworks(values, "NETWORK_UPDATED");
    return this.#publicWifiNetwork(values[index]);
  }

  async deleteWifiNetwork(id) {
    const values = this.savedWifiNetworks();
    const item = values.find((entry) => Number(entry.id) === Number(id));
    if (!item) return false;
    const status = await this.status(true);
    if (status.capabilities.network_manager && status.capabilities.host_dbus) {
      await this.runner("nmcli", ["connection", "delete", String(item.connection_id || item.ssid)], {
        timeoutMs: 20_000,
        rejectOnError: false,
        env: SYSTEM_DBUS_ENV
      }).catch(() => {});
    }
    this.#storeWifiNetworks(values.filter((entry) => entry !== item), "NETWORK_REMOVED");
    return true;
  }

  async deleteAllWifiNetworks() {
    const values = this.savedWifiNetworks();
    for (const item of values) await this.deleteWifiNetwork(item.id);
    return values.length;
  }

  stopWifiScan() {
    this.wifiScan.active = false;
    return this.wifiScanStatus();
  }

  async wifiCommand(command) {
    const value = String(command || "").toUpperCase();
    const status = await this.status(true);
    const adapter = selectedOrFirst(status.selection.wifi_adapter, status.wifi);
    if (!adapter) throw Object.assign(new Error("No Wi-Fi adapter is available"), { status: 503 });
    if (!["DISCONNECT", "RECONNECT", "REASSOCIATE", "ENABLE_ALL_NETWORKS", "DISABLE_ALL_NETWORKS"].includes(value)) {
      throw Object.assign(new Error(`Unsupported Wi-Fi command ${value}`), { status: 400 });
    }
    if (status.capabilities.network_manager && status.capabilities.host_dbus) {
      await this.#prepareWifiAdapter(adapter);
      if (value === "DISCONNECT") await this.runner("nmcli", ["device", "disconnect", adapter], { timeoutMs: 20_000, env: SYSTEM_DBUS_ENV });
      else if (["RECONNECT", "REASSOCIATE"].includes(value)) await this.runner("nmcli", ["device", "connect", adapter], { timeoutMs: 30_000, env: SYSTEM_DBUS_ENV });
      else {
        const enabled = value === "ENABLE_ALL_NETWORKS";
        const values = this.savedWifiNetworks();
        for (const item of values) {
          item.enabled = enabled;
          await this.runner("nmcli", [
            "connection", "modify", String(item.connection_id || item.ssid),
            "connection.autoconnect", enabled ? "yes" : "no"
          ], { timeoutMs: 15_000, rejectOnError: false, env: SYSTEM_DBUS_ENV });
        }
        if (!enabled) await this.runner("nmcli", ["device", "disconnect", adapter], { timeoutMs: 20_000, rejectOnError: false, env: SYSTEM_DBUS_ENV });
        this.#storeWifiNetworks(values, enabled ? "NETWORKS_ENABLED" : "NETWORKS_DISABLED");
      }
    } else if (!["ENABLE_ALL_NETWORKS", "DISABLE_ALL_NETWORKS"].includes(value)) {
      throw Object.assign(new Error("Wi-Fi commands require NetworkManager and host D-Bus access"), { status: 503 });
    }
    const result = await this.wifiStatus();
    this.platform.events?.publish("wifi.change", { event: result.wpa_state === "COMPLETED" ? "CONNECTED" : "DISCONNECTED" });
    return result;
  }

  async wifiNetworkCommand(id, command) {
    const values = this.savedWifiNetworks();
    const index = values.findIndex((item) => Number(item.id) === Number(id));
    if (index < 0) return null;
    const value = String(command || "").toUpperCase();
    if (!["ENABLE", "DISABLE", "SELECT"].includes(value)) throw Object.assign(new Error(`Unsupported Wi-Fi network command ${value}`), { status: 400 });
    const status = await this.status(true);
    const adapter = selectedOrFirst(status.selection.wifi_adapter, status.wifi);
    const item = values[index];
    if (value === "ENABLE") item.enabled = true;
    if (value === "DISABLE") item.enabled = false;
    if (value === "SELECT") {
      for (const candidate of values) candidate.selected = false;
      item.selected = true;
      item.enabled = true;
    }
    if (adapter && status.capabilities.network_manager && status.capabilities.host_dbus) {
      await this.#ensureNetworkManagerProfile(item, adapter);
      const name = String(item.connection_id || item.ssid);
      if (value === "DISABLE") {
        await this.runner("nmcli", ["connection", "modify", name, "connection.autoconnect", "no"], { timeoutMs: 15_000, rejectOnError: false, env: SYSTEM_DBUS_ENV });
        if (item.selected) await this.runner("nmcli", ["connection", "down", name], { timeoutMs: 20_000, rejectOnError: false, env: SYSTEM_DBUS_ENV });
      } else {
        await this.runner("nmcli", ["connection", "modify", name, "connection.autoconnect", "yes"], { timeoutMs: 15_000, rejectOnError: false, env: SYSTEM_DBUS_ENV });
        if (value === "SELECT") {
          for (const candidate of values) {
            if (candidate === item) continue;
            await this.runner("nmcli", ["connection", "modify", String(candidate.connection_id || candidate.ssid), "connection.autoconnect", "no"], { timeoutMs: 15_000, rejectOnError: false, env: SYSTEM_DBUS_ENV });
          }
          const up = await this.runner("nmcli", ["--wait", "60", "connection", "up", name, "ifname", adapter], { timeoutMs: 70_000, rejectOnError: false, env: SYSTEM_DBUS_ENV });
          if (up.code !== 0) throw Object.assign(new Error(processError(up, `Unable to connect to ${item.ssid}`)), { status: 502 });
        }
      }
    } else if (value === "SELECT") {
      await this.connectWifi(item);
    }
    item.updated_at = new Date().toISOString();
    this.#storeWifiNetworks(values, value === "SELECT" ? "CONNECTED" : "NETWORK_UPDATED");
    return this.#publicWifiNetwork(item);
  }

  async #available(command) {
    const result = await this.runner("sh", ["-lc", `command -v ${JSON.stringify(command)} >/dev/null 2>&1`], { timeoutMs: 3000, rejectOnError: false }).catch(() => ({ code: 1 }));
    return result.code === 0;
  }

  async #bluetoothMetadata(address, device, listedName = "") {
    const show = await this.runner("bluetoothctl", ["show", address], { timeoutMs: 5000, rejectOnError: false }).catch(() => ({ stdout: "" }));
    const properties = bluetoothctlProperties(show.stdout);
    const identity = device
      ? physicalDeviceIdentity(this.sysRoot, "bluetooth", device, this.platform.hostname)
      : { name: null, kind: "unknown", vendorId: null, productId: null, modalias: null };
    const modalias = parseModalias(identity.modalias || properties.modalias);
    const vendorId = identity.vendorId || modalias.vendorId;
    const productId = identity.productId || modalias.productId;
    let name = genericHardwareName(identity.name, this.platform.hostname);

    if (!name && vendorId && productId) {
      const result = await this.runner("lsusb", ["-d", `${vendorId}:${productId}`], { timeoutMs: 5000, rejectOnError: false }).catch(() => ({ stdout: "" }));
      name = lsusbDeviceName(result.stdout, vendorId, productId, this.platform.hostname);
    }
    if (!name) {
      for (const candidate of [properties.alias, properties.name, listedName]) {
        name = genericHardwareName(candidate, this.platform.hostname);
        if (name) break;
      }
    }

    const kind = identity.kind !== "unknown" ? identity.kind : (modalias.kind || "built-in");
    return { name: displayAdapterName(name, device), type: kind };
  }

  async #bluetoothAdapters() {
    const values = [];
    const interfaces = bluetoothInterfaces(this.sysRoot);
    const interfaceByAddress = await this.#bluetoothInterfaceAddresses(interfaces);
    const usedInterfaces = new Set();
    const result = await this.runner("bluetoothctl", ["list"], { timeoutMs: 5000, rejectOnError: false }).catch(() => ({ stdout: "" }));
    let controllerIndex = 0;
    for (const line of String(result.stdout || "").split(/\r?\n/)) {
      const match = line.match(/^Controller\s+([0-9A-F:]{17})\s+(.+?)(?:\s+\[default\])?$/i);
      if (!match) continue;
      const address = normalizedMac(match[1]);
      let device = interfaceByAddress.get(address) || bluetoothInterface(this.sysRoot, address);
      if (!device) device = interfaces.find((item) => !usedInterfaces.has(item)) || interfaces[controllerIndex] || null;
      if (device) usedInterfaces.add(device);
      controllerIndex += 1;
      const metadata = await this.#bluetoothMetadata(address || match[1], device, match[2]);
      values.push({
        id: address || match[1],
        address: address || match[1],
        interface: device,
        name: metadata.name,
        type: metadata.type
      });
    }
    if (!values.length) {
      const root = path.join(this.sysRoot, "class", "bluetooth");
      for (const device of interfaces) {
        const address = normalizedMac(readText(path.join(root, device, "address"))) || device;
        const metadata = await this.#bluetoothMetadata(address, device);
        values.push({ id: address, address, interface: device, name: metadata.name, type: metadata.type });
      }
    }
    return values;
  }

  async #bluetoothInterfaceAddresses(interfaces) {
    const values = new Map();
    for (const device of interfaces) {
      let address = normalizedMac(readText(path.join(this.sysRoot, "class", "bluetooth", device, "address")));
      if (!address) {
        const result = await this.runner("busctl", [
          "--system", "get-property", "org.bluez", `/org/bluez/${device}`, "org.bluez.Adapter1", "Address"
        ], { timeoutMs: 5000, rejectOnError: false, env: SYSTEM_DBUS_ENV }).catch(() => ({ code: 1, stdout: "" }));
        if (result.code === 0) address = normalizedMac(busctlString(result.stdout));
      }
      if (address) values.set(address, device);
    }
    return values;
  }

  async #wifiAdapters() {
    const values = [];
    const result = await this.runner("nmcli", ["-t", "--escape", "yes", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status"], { timeoutMs: 5000, rejectOnError: false }).catch(() => ({ stdout: "" }));
    for (const line of String(result.stdout || "").split(/\r?\n/)) {
      const [device, type, state, connection] = parseColonLine(line);
      if (type !== "wifi" || !device) continue;
      values.push({
        id: device,
        name: physicalDeviceName(this.sysRoot, "net", device, this.platform.hostname) || device,
        interface: device,
        type: adapterKind(this.sysRoot, device, "net"),
        state,
        connection: connection && connection !== "--" ? connection : null,
        address: normalizedMac(readText(path.join(this.sysRoot, "class", "net", device, "address")))
      });
    }
    if (!values.length) {
      const root = path.join(this.sysRoot, "class", "net");
      try {
        for (const device of fs.readdirSync(root)) {
          if (!fs.existsSync(path.join(root, device, "wireless"))) continue;
          values.push({
            id: device,
            name: physicalDeviceName(this.sysRoot, "net", device, this.platform.hostname) || device,
            interface: device,
            type: adapterKind(this.sysRoot, device, "net"),
            state: "unknown",
            connection: null,
            address: normalizedMac(readText(path.join(root, device, "address")))
          });
        }
      } catch {}
    }
    return values;
  }
}
