import { nowIso, parseJson, randomId, slug } from "../shared/util.js";

export const LATEST_DOCK_FIRMWARE = "0.10.15";

const MODES = ["AUTO", "IR_BLASTER", "IR_EMITTER_MONO_PLUG", "IR_EMITTER_STEREO_PLUG", "TRIGGER_5V", "RS232"];

function defaultPorts() {
  return Array.from({ length: 2 }, (_, index) => ({
    port: index + 1,
    mode: "AUTO",
    active_mode: index < 2 ? "IR_BLASTER" : "NONE",
    supported_modes: MODES,
    uart: { baud_rate: 9600, data_bits: 8, stop_bits: "1", parity: "none" }
  }));
}

function virtualDock(input = {}, firmwareVersion = LATEST_DOCK_FIRMWARE) {
  const id = String(input.dock_id || input.id || "virtual-dock-3");
  const isVirtual = input.virtual !== false && String(input.model || "UCD3-VIRTUAL") === "UCD3-VIRTUAL";
  const ports = (Array.isArray(input.ports) ? input.ports : defaultPorts())
    .slice(0, 2)
    .map((port, index) => ({ ...defaultPorts()[index], ...port, port: index + 1 }));
  return {
    dock_id: id,
    id,
    name: input.name || "Virtual Dock 3",
    model: input.model || "UCD3-VIRTUAL",
    serial: input.serial || "UCVR-D3-0001",
    state: input.state || "ACTIVE",
    active: input.active !== false,
    address: input.address || "virtual://dock-3",
    custom_ws_url: input.custom_ws_url || "",
    resolved_ws_url: input.resolved_ws_url || "virtual://dock-3",
    led_brightness: Number(input.led_brightness ?? 50),
    capabilities: ["IR", "RS232", "TRIGGER", "FIRMWARE_UPDATE", "LEARN_IR"],
    virtual: true,
    ...input,
    version: isVirtual ? firmwareVersion : (input.version || firmwareVersion),
    ports,
    dock_id: id,
    id
  };
}

export class DockService {
  constructor(platform) {
    this.platform = platform;
    this.db = platform.db.db;
    this.discoveryActive = false;
    this.updateTimers = new Map();
    this.#seed();
    this.#migrateVirtualDocks();
  }

  #seed() {
    if (this.db.prepare("SELECT COUNT(*) AS count FROM docks").get().count) return;
    this.save(virtualDock());
    const timestamp = nowIso();
    const builtins = [
      { id: "virtual-tv-basic", manufacturer_id: "virtual", name: "Virtual TV", codes: { POWER: "0000 006D 0022 0002", INPUT: "0000 006D 0022 0002", VOLUME_UP: "0000 006D 0022 0002", VOLUME_DOWN: "0000 006D 0022 0002" } },
      { id: "virtual-avr-basic", manufacturer_id: "virtual", name: "Virtual AVR", codes: { POWER: "0000 006D 0022 0002", MUTE: "0000 006D 0022 0002" } }
    ];
    for (const set of builtins) this.db.prepare("INSERT OR IGNORE INTO ir_code_sets (id,kind,manufacturer_id,name,metadata_json,codes_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(set.id, "BUILTIN", set.manufacturer_id, set.name, JSON.stringify({ device_type: "virtual" }), JSON.stringify(set.codes), timestamp, timestamp);
  }

  #migrateVirtualDocks() {
    const firmwareVersion = this.platform.version || LATEST_DOCK_FIRMWARE;
    this.platform.db.setSetting("dock.latest_firmware", firmwareVersion);
    for (const dock of this.list()) {
      if (dock.model !== "UCD3-VIRTUAL" && dock.virtual !== true) continue;
      const next = virtualDock(dock, firmwareVersion);
      if (String(dock.version || "") === firmwareVersion && JSON.stringify(dock.ports || []) === JSON.stringify(next.ports)) continue;
      this.db.prepare("UPDATE docks SET config_json=?,updated_at=? WHERE id=?")
        .run(JSON.stringify(next), nowIso(), dock.dock_id);
    }
  }

  list(active = undefined) {
    let rows = this.db.prepare("SELECT * FROM docks ORDER BY id").all();
    if (typeof active === "boolean") rows = rows.filter((row) => Boolean(row.active) === active);
    return rows.map((row) => ({ ...parseJson(row.config_json, {}), active: Boolean(row.active) }));
  }
  get(id) { return this.list().find((item) => item.dock_id === id || item.id === id) || null; }
  save(input) {
    const value = virtualDock(input, this.platform.version || LATEST_DOCK_FIRMWARE);
    const existing = this.get(value.dock_id);
    const timestamp = nowIso();
    this.db.prepare(`INSERT INTO docks (id,active,config_json,created_at,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET active=excluded.active,config_json=excluded.config_json,updated_at=excluded.updated_at`)
      .run(value.dock_id, value.active ? 1 : 0, JSON.stringify(value), existing?.created_at || timestamp, timestamp);
    const result = this.get(value.dock_id);
    this.platform.events.publish("dock.change", { event_type: existing ? "CHANGE" : "NEW", dock_id: result.dock_id, new_state: result });
    return result;
  }
  update(id, patch) {
    const current = this.get(id);
    if (!current) return null;
    return this.save({ ...current, ...patch, dock_id: id });
  }
  remove(id) {
    const changed = this.db.prepare("DELETE FROM docks WHERE id=?").run(id).changes > 0;
    if (changed) this.platform.events.publish("dock.change", { event_type: "DELETE", dock_id: id });
    return changed;
  }
  removeAll() {
    const ids = this.list().map((item) => item.dock_id);
    for (const id of ids) this.remove(id);
    return { code: "OK" };
  }
  connectionCommand(id, command) {
    const dock = this.get(id);
    if (!dock) return null;
    const cmd = String(command || "").toUpperCase();
    if (!["CONNECT", "DISCONNECT"].includes(cmd)) throw Object.assign(new Error(`Unsupported Dock connection command ${cmd}`), { status: 400 });
    dock.state = cmd === "CONNECT" ? "ACTIVE" : "DISCONNECTED";
    const result = this.save(dock);
    this.platform.events.publish("dock.state", { dock_id: id, state: result.state });
    return { code: "OK" };
  }
  connectionCommandAll(command) {
    for (const dock of this.list(true)) this.connectionCommand(dock.dock_id, command);
    return { code: "OK" };
  }
  updatePort(id, portId, patch) {
    const dock = this.get(id);
    if (!dock) return null;
    const port = dock.ports.find((item) => Number(item.port) === Number(portId));
    if (!port) return null;
    Object.assign(port, patch, { port: Number(portId) });
    if (patch.mode && patch.mode !== "AUTO") port.active_mode = patch.mode;
    if (patch.mode === "AUTO") port.active_mode = port.active_mode === "NONE" ? "IR_BLASTER" : port.active_mode;
    this.save(dock);
    this.platform.events.publish("dock.port", { dock_id: id, port });
    return port;
  }
  command(id, input = {}) {
    const dock = this.get(id);
    if (!dock) return null;
    const command = String(input.command || input.cmd_id || "").toUpperCase();
    if (command === "SET_LED_BRIGHTNESS") dock.led_brightness = Math.max(0, Math.min(100, Number(input.value || 0)));
    if (command === "RESET") Object.assign(dock, virtualDock({ dock_id: id, name: dock.name }, this.platform.version || LATEST_DOCK_FIRMWARE));
    if (command === "REBOOT") dock.state = "ACTIVE";
    this.save(dock);
    this.logOutput(id, null, "COMMAND", { ...input, command });
    this.platform.events.publish("dock.state", { dock_id: id, state: dock.state, command });
    return { code: "OK" };
  }
  output(id, portId, mode, payload) {
    const dock = this.get(id);
    if (!dock) return null;
    const port = dock.ports.find((item) => Number(item.port) === Number(portId));
    if (!port) return null;
    const normalizedMode = String(mode || port.active_mode || port.mode).toUpperCase();
    const value = this.logOutput(id, String(portId), normalizedMode, payload || {});
    this.platform.events.publish("dock.output", value);
    return value;
  }
  logOutput(dockId, portId, mode, payload) {
    const timestamp = nowIso();
    const result = this.db.prepare("INSERT INTO dock_output_log (dock_id,port_id,mode,payload_json,created_at) VALUES (?,?,?,?,?)")
      .run(dockId, portId, mode, JSON.stringify(payload || {}), timestamp);
    return { id: Number(result.lastInsertRowid), dock_id: dockId, port_id: portId, mode, payload, created_at: timestamp };
  }
  outputLog(id, limit = 100) {
    return this.db.prepare("SELECT * FROM dock_output_log WHERE dock_id=? ORDER BY id DESC LIMIT ?").all(id, Number(limit))
      .map((row) => ({ ...row, payload: parseJson(row.payload_json, {}), payload_json: undefined }));
  }

  discovery() {
    return { active: this.discoveryActive, docks: this.discoveryActive ? this.list().map((dock) => ({ id: dock.dock_id, friendly_name: dock.name, model: dock.model, version: dock.version, address: dock.address, discovery_type: "NET", configured: true, timestamp: nowIso() })) : [] };
  }
  discoveryDevice(id) { return this.discovery().docks.find((dock) => dock.id === id) || null; }
  discoveryCommand(id, command) {
    const dock = this.get(id);
    if (!dock) return null;
    const cmd = String(command || "CONNECTION_TEST").toUpperCase();
    if (!["CONNECTION_TEST", "IDENTIFY"].includes(cmd)) throw Object.assign(new Error(`Unsupported discovery command ${cmd}`), { status: 400 });
    if (cmd === "IDENTIFY") this.command(id, { command: "IDENTIFY" });
    return { ...this.discoveryDevice(id), id, dock_id: id, driver_url: dock.resolved_ws_url, connected: dock.state === "ACTIVE" };
  }
  startDiscovery() { this.discoveryActive = true; this.platform.events.publish("dock.discovery", { event_type: "START", ...this.discovery() }); return { code: "OK" }; }
  stopDiscovery() { this.discoveryActive = false; this.platform.events.publish("dock.discovery", { event_type: "STOP", ...this.discovery() }); return { code: "OK" }; }
  startSetup(input = {}) {
    const source = input.discovery || input.manually || {};
    const id = String(source.id || source.dock_id || randomId("dock-setup-"));
    const timestamp = nowIso();
    this.db.prepare("INSERT OR REPLACE INTO dock_setups (id,state,data_json,error,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run(id, "CONFIGURING", JSON.stringify(source), null, timestamp, timestamp);
    this.platform.events.publish("dock.setup", { event_type: "START", id, dock_id: id, state: "CONFIGURING" });
    const dock = this.save(virtualDock({ ...source, dock_id: id, name: source.name || source.friendly_name || `Virtual Dock ${id}` }, this.platform.version || LATEST_DOCK_FIRMWARE));
    this.db.prepare("UPDATE dock_setups SET state='OK',updated_at=? WHERE id=?").run(nowIso(), id);
    this.platform.events.publish("dock.setup", { event_type: "STOP", id, dock_id: dock.dock_id, state: "OK" });
    return this.setupInfo(id);
  }
  setupInfo(id) {
    const row = this.db.prepare("SELECT * FROM dock_setups WHERE id=?").get(id);
    return row ? { id: row.id, dock_id: row.id, state: row.state, error: row.error || undefined, ...parseJson(row.data_json, {}) } : null;
  }
  setupSessions() { return this.db.prepare("SELECT id FROM dock_setups WHERE state NOT IN ('OK','ERROR')").all().map((row) => row.id); }
  stopSetup(id) { this.db.prepare("DELETE FROM dock_setups WHERE id=?").run(id); this.platform.events.publish("dock.setup", { event_type: "STOP", id, dock_id: id, state: "ERROR", error: "OTHER" }); return { code: "OK" }; }

  updateCheck(id) {
    const dock = this.get(id);
    if (!dock) return null;
    const latest = this.platform.db.getSetting("dock.latest_firmware", LATEST_DOCK_FIRMWARE);
    const progress = this.db.prepare("SELECT * FROM dock_updates WHERE dock_id=?").get(id);
    return {
      dock_id: id,
      update_check_enabled: true,
      update_available: latest !== dock.version,
      ...(progress && progress.state === "IN_PROGRESS" ? { update_id: id } : {}),
      firmware_update: latest !== dock.version ? { version: latest, title: { en: `Virtual Dock firmware ${latest}` }, release_notes: { en: "Virtual firmware update simulation." }, download: "DOWNLOADED" } : undefined
    };
  }
  startUpdate(id) {
    const dock = this.get(id);
    const check = this.updateCheck(id);
    if (!dock || !check) return null;
    if (this.updateTimers.has(id)) return { id };
    const version = check.firmware_update?.version || dock.version;
    this.db.prepare("INSERT OR REPLACE INTO dock_updates (dock_id,state,progress,version,error,updated_at) VALUES (?,?,?,?,?,?)")
      .run(id, "IN_PROGRESS", 0, version, null, nowIso());
    let progress = 0;
    this.platform.events.publish("dock.update", { event_type: "START", id, dock_id: id, state: "NEW", progress, version });
    const timer = setInterval(() => {
      progress += 25;
      if (progress >= 100) {
        clearInterval(timer); this.updateTimers.delete(id);
        this.update(id, { version });
        this.db.prepare("UPDATE dock_updates SET state='SUCCESS',progress=100,updated_at=? WHERE dock_id=?").run(nowIso(), id);
        this.platform.events.publish("dock.update", { event_type: "STOP", id, dock_id: id, state: "OK", progress: 100, version });
      } else {
        this.db.prepare("UPDATE dock_updates SET progress=?,updated_at=? WHERE dock_id=?").run(progress, nowIso(), id);
        this.platform.events.publish("dock.update", { event_type: "UPDATE", id, dock_id: id, state: "UPLOADING", progress, version });
      }
    }, 75);
    timer.unref?.();
    this.updateTimers.set(id, timer);
    return { id };
  }
  updateProgress(id, updateId = id) {
    if (String(updateId) !== String(id)) return null;
    const row = this.db.prepare("SELECT * FROM dock_updates WHERE dock_id=?").get(id);
    if (!row) return null;
    return { id, dock_id: id, state: row.state, progress: Number(row.progress || 0), version: row.version, error: row.error || undefined, updated_at: row.updated_at };
  }
  abortUpdate(id) {
    const timer = this.updateTimers.get(id); if (timer) clearInterval(timer); this.updateTimers.delete(id);
    this.db.prepare("DELETE FROM dock_updates WHERE dock_id=?").run(id);
    this.platform.events.publish("dock.update", { event_type: "STOP", id, dock_id: id, state: "ERROR", progress: 0, error: "ABORTED" });
    return { code: "OK" };
  }

  emitters() {
    return this.list(true).flatMap((dock) => dock.ports.filter((port) => String(port.active_mode).startsWith("IR") || port.mode === "AUTO")
      .map((port) => ({ emitter_id: `${dock.dock_id}:${port.port}`, device_id: dock.dock_id, dock_id: dock.dock_id, port_id: String(port.port), name: `${dock.name} port ${port.port}`, state: dock.state, formats: ["PRONTO", "RAW", "HEX"] })));
  }
  emitter(id) { return this.emitters().find((item) => item.emitter_id === id) || null; }
  stopIr(emitterId, input = {}) {
    const emitter = this.emitter(emitterId);
    if (!emitter) return null;
    this.logOutput(emitter.dock_id, input.port_id || emitter.port_id, "IR_STOP", input);
    return { code: "OK" };
  }
  manufacturers(query = "") {
    const q = String(query).toLowerCase();
    const rows = this.db.prepare("SELECT manufacturer_id,COUNT(*) AS code_set_count FROM ir_code_sets WHERE kind='BUILTIN' GROUP BY manufacturer_id").all();
    return rows.map((row) => ({ manufacturer_id: row.manufacturer_id, name: row.manufacturer_id === "virtual" ? "Virtual" : row.manufacturer_id, code_set_count: row.code_set_count }))
      .filter((item) => !q || item.name.toLowerCase().includes(q));
  }
  codeSets(manufacturerId, query = "") {
    const q = String(query).toLowerCase();
    return this.db.prepare("SELECT * FROM ir_code_sets WHERE manufacturer_id=? ORDER BY name").all(manufacturerId)
      .map((row) => ({ code_set_id: row.id, manufacturer_id: row.manufacturer_id, name: row.name, ...parseJson(row.metadata_json, {}) }))
      .filter((item) => !q || item.name.toLowerCase().includes(q));
  }
  codeSet(id) {
    const row = this.db.prepare("SELECT * FROM ir_code_sets WHERE id=?").get(id);
    return row ? { code_set_id: row.id, kind: row.kind, manufacturer_id: row.manufacturer_id, name: row.name, metadata: parseJson(row.metadata_json, {}), codes: parseJson(row.codes_json, {}) } : null;
  }
  customCodeSets() { return this.db.prepare("SELECT * FROM ir_code_sets WHERE kind='CUSTOM' ORDER BY name").all().map((row) => this.codeSet(row.id)); }
  saveCodeSet(id, input = {}, overwrite = false) {
    const codeSetId = slug(id || input.code_set_id || input.name || randomId("codeset-"), "codeset");
    const current = this.codeSet(codeSetId);
    if (current && !overwrite) throw Object.assign(new Error(`IR code set ${codeSetId} already exists`), { status: 409 });
    const timestamp = nowIso();
    this.db.prepare(`INSERT INTO ir_code_sets (id,kind,manufacturer_id,name,metadata_json,codes_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,metadata_json=excluded.metadata_json,codes_json=excluded.codes_json,updated_at=excluded.updated_at`)
      .run(codeSetId, "CUSTOM", null, input.name || current?.name || codeSetId, JSON.stringify(input.metadata || {}), JSON.stringify(input.codes || current?.codes || {}), current?.created_at || timestamp, timestamp);
    return this.codeSet(codeSetId);
  }
  deleteCodeSet(id) { return this.db.prepare("DELETE FROM ir_code_sets WHERE id=? AND kind='CUSTOM'").run(id).changes > 0; }
  deleteAllCustomCodeSets() { this.db.prepare("DELETE FROM ir_code_sets WHERE kind='CUSTOM'").run(); return { code: "OK" }; }
  saveCode(id, key, value) { const set = this.codeSet(id); if (!set) return null; set.codes[key] = value; return this.saveCodeSet(id, set, true); }
  deleteCode(id, key) { const set = this.codeSet(id); if (!set) return false; delete set.codes[key]; this.saveCodeSet(id, set, true); return true; }
  sendIr(emitterId, input = {}) {
    const [dockId, defaultPort] = String(emitterId).split(":");
    const port = input.port_id || defaultPort || "1";
    let code = input.code;
    if (!code && input.codeset_id && input.cmd_id) code = this.codeSet(input.codeset_id)?.codes?.[input.cmd_id];
    if (!code) throw Object.assign(new Error("IR code not found"), { status: 404 });
    this.output(dockId, port, "IR", { code, format: input.format || "PRONTO", codeset_id: input.codeset_id, cmd_id: input.cmd_id });
    return { code: "OK" };
  }
  learnStatus(emitterId) {
    const row = this.db.prepare("SELECT * FROM ir_learn_sessions WHERE emitter_id=?").get(emitterId);
    if (!row) return { emitter_id: emitterId, active: false, state: "IDLE", codes: [] };
    const expired = row.timeout_at && row.timeout_at < Date.now();
    if (expired && row.active) this.db.prepare("UPDATE ir_learn_sessions SET active=0,updated_at=? WHERE emitter_id=?").run(nowIso(), emitterId);
    const code = parseJson(row.code_json, null);
    return { emitter_id: emitterId, active: !expired && Boolean(row.active), state: code ? "OK" : (!expired && row.active ? "LEARNING" : "IDLE"), codes: code ? [code] : [] };
  }
  startLearn(emitterId, timeout = 60) {
    this.db.prepare("INSERT OR REPLACE INTO ir_learn_sessions (emitter_id,active,timeout_at,code_json,updated_at) VALUES (?,?,?,?,?)")
      .run(emitterId, 1, Date.now() + Number(timeout) * 1000, null, nowIso());
    this.platform.events.publish("ir.learn", this.learnStatus(emitterId));
    return { code: "OK" };
  }
  stopLearn(emitterId) { this.db.prepare("UPDATE ir_learn_sessions SET active=0,updated_at=? WHERE emitter_id=?").run(nowIso(), emitterId); return this.learnStatus(emitterId); }
  injectLearned(emitterId, code) {
    this.db.prepare("INSERT OR REPLACE INTO ir_learn_sessions (emitter_id,active,timeout_at,code_json,updated_at) VALUES (?,?,?,?,?)")
      .run(emitterId, 0, null, JSON.stringify(code), nowIso());
    const status = this.learnStatus(emitterId); this.platform.events.publish("ir.learn", status); return status;
  }
}
