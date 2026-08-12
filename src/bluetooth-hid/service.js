import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../shared/logger.js";

const log = logger("bluetooth-hid");
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const MODIFIERS = Object.freeze({
  LCTRL: 0x01, KEY_LEFT_CONTROL: 0x01,
  LSHIFT: 0x02, KEY_LEFT_SHIFT: 0x02,
  LALT: 0x04, KEY_LEFT_ALT: 0x04,
  LGUI: 0x08, KEY_LEFT_GUI: 0x08,
  RCTRL: 0x10, KEY_RIGHT_CONTROL: 0x10,
  RSHIFT: 0x20, KEY_RIGHT_SHIFT: 0x20,
  RALT: 0x40, KEY_RIGHT_ALT: 0x40,
  RGUI: 0x80, KEY_RIGHT_GUI: 0x80,
});

const REGULAR_USAGES = Object.freeze({
  KEY_RETURN: 40, KEY_ESC: 41, KEY_BACKSPACE: 42, KEY_TAB: 43, KEY_SPACE: 44,
  KEY_MINUS: 45, KEY_EQUAL: 46, KEY_LEFT_BRACE: 47, KEY_RIGHT_BRACE: 48,
  KEY_BACKSLASH: 49, KEY_HASH_TILDE: 50, KEY_SEMICOLON: 51, KEY_APOSTROPHE: 52,
  KEY_GRAVE: 53, KEY_COMMA: 54, KEY_DOT: 55, KEY_SLASH: 56, KEY_CAPSLOCK: 57,
  KEY_SYSRQ: 70, KEY_SCROLL_LOCK: 71, KEY_PAUSE: 72, KEY_INSERT: 73, KEY_HOME: 74,
  KEY_PAGE_UP: 75, KEY_DELETE: 76, KEY_END: 77, KEY_PAGE_DOWN: 78,
  KEY_RIGHT_ARROW: 79, KEY_LEFT_ARROW: 80, KEY_DOWN_ARROW: 81, KEY_UP_ARROW: 82,
  KEYPAD_NUMLOCK: 83, KEYPAD_SLASH: 84, KEYPAD_ASTERISK: 85, KEYPAD_MINUS: 86,
  KEYPAD_PLUS: 87, KEYPAD_ENTER: 88, KEYPAD_DOT: 99, KEY_102ND: 100,
  KEY_APPLICATION: 101, KEY_POWER: 102, KEYPAD_EQUAL: 103,
  KEY_EXECUTE: 116, KEY_HELP: 117, KEY_MENU: 118, KEY_SELECT: 119, KEY_STOP: 120,
  KEY_AGAIN: 121, KEY_UNDO: 122, KEY_CUT: 123, KEY_COPY: 124, KEY_PASTE: 125,
  KEY_FIND: 126, KEY_MUTE: 127, KEY_VOLUME_UP: 128, KEY_VOLUME_DOWN: 129,
  KEYPAD_COMMA: 133, KEY_RO: 135, KEY_KATAKANA_HIRAGANA: 136, KEY_YEN: 137,
  KEY_HENKAN: 138, KEY_MUHENKAN: 139, KEYPAD_JPCOMMA: 140,
  KEY_HANGEUL: 144, KEY_HANJA: 145, KEY_KATAKANA: 146, KEY_HIRAGANA: 147,
  KEY_ZENKAKU_HANKAKU: 148, KEY_FURIGANA: 149,
  KEY_ALTERNATE_ERASE: 153, KEY_SYS_REQ_ATTENTION: 154, KEY_CANCEL: 155,
  KEY_CLEAR: 156, KEY_PRIOR: 157, KEY_SEPARATOR: 159, KEY_OUT: 160, KEY_OPER: 161,
  KEY_CLEAR_AGAIN: 162, KEY_CR_SEL_PROPS: 163, KEY_EX_SEL: 164,
  KEYPAD_00: 176, KEYPAD_000: 177, KEY_THOUSANDS_SEPARATOR: 178,
  KEY_DECIMAL_SEPARATOR: 179, KEY_CURRENCY_UNIT: 180, KEY_CURRENCY_SUB_UNIT: 181,
  KEYPAD_LEFT_PARENTHESIS: 182, KEYPAD_RIGHT_PARENTHESIS: 183,
  KEYPAD_LEFT_BRACE: 184, KEYPAD_RIGHT_BRACE: 185, KEYPAD_TAB: 186,
  KEYPAD_BACKSPACE: 187, KEYPAD_A: 188, KEYPAD_B: 189, KEYPAD_C: 190,
  KEYPAD_D: 191, KEYPAD_E: 192, KEYPAD_F: 193, KEYPAD_XOR: 194, KEYPAD_CARET: 195,
  KEYPAD_PERCENT: 196, KEYPAD_LESS_THAN: 197, KEYPAD_GREATER_THAN: 198,
  KEYPAD_AMPERSAND: 199, KEYPAD_AMPERSAND_AMPERSAND: 200, KEYPAD_PIPE: 201,
  KEYPAD_PIPE_PIPE: 202, KEYPAD_COLON: 203, KEYPAD_HASH: 204, KEYPAD_SPACE: 205,
  KEYPAD_AT: 206, KEYPAD_EXCLAMATION: 207, KEYPAD_MEMORY_STORE: 208,
  KEYPAD_MEMORY_RECALL: 209, KEYPAD_MEMORY_CLEAR: 210, KEYPAD_MEMORY_ADD: 211,
  KEYPAD_MEMORY_SUBTRACT: 212, KEYPAD_MEMORY_MULTIPLY: 213, KEYPAD_MEMORY_DIVIDE: 214,
  KEYPAD_PLUS_MINUS: 215, KEYPAD_CLEAR: 216, KEYPAD_CLEAR_ENTRY: 217,
  KEYPAD_BINARY: 218, KEYPAD_DECIMAL: 220, KEYPAD_HEXADECIMAL: 221,
  KEY_MEDIA_PLAY_PAUSE: 232, KEY_MEDIA_STOP_CD: 233, KEY_MEDIA_PREVIOUS_SONG: 234,
  KEY_MEDIA_NEXT_SONG: 235, KEY_MEDIA_EJECT_CD: 236, KEY_MEDIA_VOLUME_UP: 237,
  KEY_MEDIA_VOLUME_DOWN: 238, KEY_MEDIA_MUTE: 239, KEY_MEDIA_WWW: 240,
  KEY_MEDIA_BACK: 241, KEY_MEDIA_FORWARD: 242, KEY_MEDIA_STOP: 243,
  KEY_MEDIA_FIND: 244, KEY_MEDIA_SCROLL_UP: 245, KEY_MEDIA_SCROLL_DOWN: 246,
  KEY_MEDIA_EDIT: 247, KEY_MEDIA_SLEEP: 248, KEY_MEDIA_COFFEE: 249,
  KEY_MEDIA_REFRESH: 250, KEY_MEDIA_CALC: 251,
});

const KEYBOARD_ALIASES = Object.freeze({
  BACK: "KEY_ESC", ESCAPE: "KEY_ESC", ENTER: "KEY_RETURN", OK: "KEY_RETURN",
  DPAD_MIDDLE: "KEY_RETURN", DPAD_UP: "KEY_UP_ARROW", UP: "KEY_UP_ARROW",
  DPAD_DOWN: "KEY_DOWN_ARROW", DOWN: "KEY_DOWN_ARROW", DPAD_LEFT: "KEY_LEFT_ARROW",
  LEFT: "KEY_LEFT_ARROW", DPAD_RIGHT: "KEY_RIGHT_ARROW", RIGHT: "KEY_RIGHT_ARROW",
  HOME: "KEY_HOME", MENU: "KEY_APPLICATION", DELETE: "KEY_DELETE",
  BACKSPACE: "KEY_BACKSPACE", TAB: "KEY_TAB", SPACE: "KEY_SPACE",
});

const CONSUMER_USAGES = Object.freeze({
  CONSUMER_INCREMENT_10: 0x20, CONSUMER_INCREMENT_100: 0x21, CONSUMER_AM_PM: 0x22,
  CONSUMER_POWER: 0x30, CONSUMER_RESET: 0x31, CONSUMER_SLEEP: 0x32,
  CONSUMER_MENU: 0x40, CONSUMER_MENU_PICK: 0x41, CONSUMER_MENU_UP: 0x42,
  CONSUMER_MENU_DOWN: 0x43, CONSUMER_MENU_LEFT: 0x44, CONSUMER_MENU_RIGHT: 0x45,
  CONSUMER_MENU_ESCAPE: 0x46, CONSUMER_DATA_ON_SCREEN: 0x60,
  CONSUMER_CLOSED_CAPTION: 0x61, CONSUMER_RED_MENU_BUTTON: 0x69,
  CONSUMER_GREEN_MENU_BUTTON: 0x6a, CONSUMER_BLUE_MENU_BUTTON: 0x6b,
  CONSUMER_YELLOW_MENU_BUTTON: 0x6c, CONSUMER_ASPECT: 0x6d,
  CONSUMER_SELECTION: 0x80, CONSUMER_RECALL_LAST: 0x83, CONSUMER_ENTER_CHANNEL: 0x84,
  CONSUMER_MEDIA_SELECT_TV: 0x89, CONSUMER_MEDIA_SELECT_PROGRAM_GUIDE: 0x8d,
  CONSUMER_QUIT: 0x94, CONSUMER_HELP: 0x95, CONSUMER_MEDIA_SELECT_HOME: 0x9a,
  CONSUMER_CHANNEL_INCREMENT: 0x9c, CONSUMER_CHANNEL_DECREMENT: 0x9d,
  CONSUMER_PLAY: 0xb0, CONSUMER_PAUSE: 0xb1, CONSUMER_RECORD: 0xb2,
  CONSUMER_FAST_FORWARD: 0xb3, CONSUMER_REWIND: 0xb4, CONSUMER_SCAN_NEXT_TRACK: 0xb5,
  CONSUMER_SCAN_PREVIOUS_TRACK: 0xb6, CONSUMER_STOP: 0xb7, CONSUMER_EJECT: 0xb8,
  CONSUMER_RANDOM_PLAY: 0xb9, CONSUMER_REPEAT: 0xbc, CONSUMER_STOP_EJECT: 0xcc,
  CONSUMER_PLAY_PAUSE: 0xcd, CONSUMER_PLAY_SKIP: 0xce, CONSUMER_VOICE_COMMAND: 0xcf,
  CONSUMER_VOLUME: 0xe0, CONSUMER_MUTE: 0xe2, CONSUMER_VOLUME_INCREMENT: 0xe9,
  CONSUMER_VOLUME_DECREMENT: 0xea,
  POWER: 0x30, MUTE: 0xe2, VOLUME_UP: 0xe9, VOLUME_DOWN: 0xea,
  PLAY: 0xb0, PAUSE: 0xb1, PLAY_PAUSE: 0xcd, STOP: 0xb7,
  NEXT: 0xb5, PREV: 0xb6, PREVIOUS: 0xb6, RECORD: 0xb2,
});

const SYSTEM_USAGES = Object.freeze({
  SYSTEM_POWER_DOWN: 0x81, SYSTEM_SLEEP: 0x82, SYSTEM_WAKE_UP: 0x83,
  SYSTEM_CONTEXT_MENU: 0x84, SYSTEM_MAIN_MENU: 0x85, SYSTEM_APP_MENU: 0x86,
  SYSTEM_MENU_HELP: 0x87, SYSTEM_MENU_EXIT: 0x88, SYSTEM_MENU_SELECT: 0x89,
  SYSTEM_MENU_RIGHT: 0x8a, SYSTEM_MENU_LEFT: 0x8b, SYSTEM_MENU_UP: 0x8c,
  SYSTEM_MENU_DOWN: 0x8d, SYSTEM_COLD_RESTART: 0x8e, SYSTEM_WARM_RESTART: 0x8f,
  SYSTEM_DPAD_UP: 0x90, SYSTEM_DPAD_DOWN: 0x91, SYSTEM_DPAD_RIGHT: 0x92,
  SYSTEM_DPAD_LEFT: 0x93,
});

const ASCII_PUNCTUATION = Object.freeze({
  " ": [44, 0], "-": [45, 0], "_": [45, 0x02], "=": [46, 0], "+": [46, 0x02],
  "[": [47, 0], "{": [47, 0x02], "]": [48, 0], "}": [48, 0x02],
  "\\": [49, 0], "|": [49, 0x02], ";": [51, 0], ":": [51, 0x02],
  "'": [52, 0], "\"": [52, 0x02], "`": [53, 0], "~": [53, 0x02],
  ",": [54, 0], "<": [54, 0x02], ".": [55, 0], ">": [55, 0x02],
  "/": [56, 0], "?": [56, 0x02], "!": [30, 0x02], "@": [31, 0x02],
  "#": [32, 0x02], "$": [33, 0x02], "%": [34, 0x02], "^": [35, 0x02],
  "&": [36, 0x02], "*": [37, 0x02], "(": [38, 0x02], ")": [39, 0x02],
  "\n": [40, 0], "\r": [40, 0], "\t": [43, 0],
});

function signedByte(value) {
  return Math.max(-128, Math.min(127, Math.round(Number(value) || 0))) & 0xff;
}

function regularUsage(name) {
  const normalized = KEYBOARD_ALIASES[name] || name;
  let match = normalized.match(/^KEY_([A-Z])$/);
  if (match) return 4 + match[1].charCodeAt(0) - 65;
  match = normalized.match(/^KEY_([1-9])$/);
  if (match) return 29 + Number(match[1]);
  if (normalized === "KEY_0") return 39;
  match = normalized.match(/^KEY_F(\d{1,2})$/);
  if (match) {
    const number = Number(match[1]);
    if (number >= 1 && number <= 12) return 57 + number;
    if (number >= 13 && number <= 24) return 91 + number;
  }
  match = normalized.match(/^KEYPAD_([1-9])$/);
  if (match) return 88 + Number(match[1]);
  if (normalized === "KEYPAD_0") return 98;
  return REGULAR_USAGES[normalized] ?? null;
}

function asciiUsage(character) {
  if (/^[a-z]$/.test(character)) return [4 + character.charCodeAt(0) - 97, 0];
  if (/^[A-Z]$/.test(character)) return [4 + character.charCodeAt(0) - 65, 0x02];
  if (/^[1-9]$/.test(character)) return [29 + Number(character), 0];
  if (character === "0") return [39, 0];
  return ASCII_PUNCTUATION[character] || null;
}

function keyboardSequenceForText(text) {
  if (!/^[\x00-\x7f]{1,20}$/.test(text)) {
    throw Object.assign(new Error("Bluetooth HID text must be 1-20 US-ASCII characters"), { status: 422 });
  }
  const reports = [];
  for (const character of text) {
    const mapped = asciiUsage(character);
    if (!mapped) throw Object.assign(new Error(`Unsupported US-ASCII HID character ${JSON.stringify(character)}`), { status: 422 });
    reports.push(keyboardReport(mapped[0], mapped[1]), keyboardReport(0, 0));
  }
  return reports;
}

function keyboardCombination(value, gui = false) {
  const tokens = String(value || "").trim().toUpperCase().split("+").filter(Boolean);
  let modifiers = gui ? 0x08 : 0;
  const usages = [];
  for (const token of tokens) {
    if (MODIFIERS[token]) {
      modifiers |= MODIFIERS[token];
      continue;
    }
    const usage = regularUsage(token);
    if (usage === null) return null;
    usages.push(usage);
  }
  if (!tokens.length || usages.length > 6) return null;
  return { usages, modifiers };
}

export function keyboardReport(usages = 0, modifiers = 0) {
  const values = Array.isArray(usages) ? usages : Number(usages) ? [Number(usages)] : [];
  const keys = values.slice(0, 6).map((value) => Number(value) & 0xff);
  while (keys.length < 6) keys.push(0);
  return Buffer.from([1, Number(modifiers) & 0xff, 0, ...keys]);
}

export function mouseReport({ buttons = 0, dx = 0, dy = 0, wheel = 0 } = {}) {
  return Buffer.from([2, Number(buttons) & 0x1f, signedByte(dx), signedByte(dy), signedByte(wheel)]);
}

export function consumerReport(usage = 0) {
  const value = Number(usage) & 0xffff;
  return Buffer.from([3, value & 0xff, (value >>> 8) & 0xff]);
}

export function systemReport(usage = 0) {
  return Buffer.from([4, Number(usage) & 0xff]);
}

function remoteKind(entity) {
  const explicit = String(entity?.kind || entity?.options?.kind || "").toUpperCase();
  if (explicit) return explicit;
  return entity?.bt || entity?.options?.bt ? "BT" : "IR";
}

function helperDefault() {
  return path.resolve(moduleDir, "../../tools/bluetooth-hid.py");
}

export class BluetoothHidService {
  constructor(platform, options = {}) {
    this.platform = platform;
    this.helper = options.helper || process.env.UCVR_BT_HID_HELPER || helperDefault();
    this.spawnProcess = options.spawnProcess || spawn;
    this.process = null;
    this.stdoutBuffer = "";
    this.waiters = [];
    this.state = {
      available: false,
      running: false,
      registered: false,
      connected: false,
      transport: "ble-hogp",
      address: null,
      adapter: null,
      peer: null,
      last_error: null,
    };
  }

  status() {
    return structuredClone(this.state);
  }

  hasConfiguredRemote() {
    return this.platform.db.listConfiguredEntities().some((entity) => entity.entity_type === "remote" && remoteKind(entity) === "BT");
  }

  async start(options = {}) {
    if (this.process && this.state.running) return this.status();
    const hardware = await this.platform.hardware.status(false).catch(() => this.platform.hardware.cached || {});
    const address = this.platform.hardware.bluetoothAddress?.();
    const selected = hardware.bluetooth?.find((item) => item.id === hardware.selection?.bluetooth_adapter)
      || hardware.bluetooth?.[0]
      || {};
    const adapter = selected.interface || selected.device || null;
    if (!address || address === "00:00:00:00:00:00") {
      const error = Object.assign(new Error("No Bluetooth adapter is available for HID peripheral mode"), { status: 409 });
      this.state = { ...this.state, available: false, running: false, last_error: error.message };
      if (options.optional) return this.status();
      throw error;
    }

    this.state = {
      ...this.state,
      available: true,
      running: false,
      registered: false,
      connected: false,
      transport: "ble-hogp",
      address,
      adapter,
      peer: null,
      last_error: null,
    };

    const child = this.spawnProcess("python3", [
      this.helper,
      "--address", address,
      "--name", String(options.name || this.platform.name || "UC Virtual Remote"),
      ...(adapter ? ["--adapter", adapter] : []),
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    this.process = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.#stdout(chunk));
    child.stderr.on("data", (chunk) => {
      const message = String(chunk || "").trim();
      if (message) log.warn(message);
    });
    child.once("error", (error) => this.#stopped(error));
    child.once("exit", (code, signal) => this.#stopped(code === 0 ? null : new Error(`Bluetooth HID helper exited with ${code ?? signal}`)));

    const ready = await this.#waitFor((event) => event.type === "ready" || event.type === "error", 8000);
    if (ready.type === "error") {
      const error = Object.assign(new Error(ready.message || "Unable to start Bluetooth LE HID peripheral"), { status: 502 });
      await this.stop().catch(() => {});
      if (options.optional) {
        this.state.last_error = error.message;
        return this.status();
      }
      throw error;
    }
    this.state.running = true;
    this.state.registered = true;
    this.state.transport = ready.transport || "ble-hogp";
    this.state.last_error = null;
    this.platform.events.publish("bluetooth.hid", this.status());
    return this.status();
  }

  async stop() {
    const child = this.process;
    this.process = null;
    if (child) {
      try { child.stdin.write(`${JSON.stringify({ action: "stop" })}\n`); } catch {}
      await new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        const timer = setTimeout(() => { try { child.kill("SIGTERM"); } catch {}; resolve(); }, 1500);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
    this.state = { ...this.state, running: false, registered: false, connected: false, peer: null };
    return this.status();
  }

  async ensureStarted() {
    if (!this.state.running) await this.start();
    return this.status();
  }

  async sendCommand(command, params = {}) {
    await this.ensureStarted();
    const raw = String(command || "").trim();
    const name = raw.toUpperCase();

    let match = name.match(/^MOUSE_BTN_([1-3])$/);
    if (match) {
      const buttons = 1 << (Number(match[1]) - 1);
      return this.sendReports([mouseReport({ buttons }), mouseReport({})], 20);
    }
    match = name.match(/^MOUSE_X_(-?\d+)$/);
    if (match) return this.sendReports([mouseReport({ dx: Number(match[1]) })]);
    match = name.match(/^MOUSE_Y_(-?\d+)$/);
    if (match) return this.sendReports([mouseReport({ dy: Number(match[1]) })]);
    match = name.match(/^MOUSE_WHEEL_(-?\d+)$/);
    if (match) return this.sendReports([mouseReport({ wheel: Number(match[1]) })]);
    if (name === "MOUSE_MOVE" || name === "MOUSE") return this.sendReports([mouseReport(params)]);
    if (name === "MOUSE_CLICK") {
      const buttons = Math.max(1, Number(params.buttons || params.button || 1)) & 0x1f;
      return this.sendReports([mouseReport({ ...params, buttons }), mouseReport({})], 20);
    }
    if (name === "MOUSE_SCROLL" || name === "SCROLL") return this.sendReports([mouseReport({ wheel: params.wheel ?? params.amount ?? 0 })]);

    if (/^0X[0-9A-F]{2}$/.test(name)) {
      return this.sendReports([keyboardReport(Number.parseInt(name.slice(2), 16)), keyboardReport(0)], 20);
    }
    if (/^0X[0-9A-F]{4}$/.test(name)) {
      return this.sendReports([consumerReport(Number.parseInt(name.slice(2), 16)), consumerReport(0)], 20);
    }
    if (Object.prototype.hasOwnProperty.call(CONSUMER_USAGES, name)) {
      return this.sendReports([consumerReport(CONSUMER_USAGES[name]), consumerReport(0)], 20);
    }
    if (Object.prototype.hasOwnProperty.call(SYSTEM_USAGES, name)) {
      return this.sendReports([systemReport(SYSTEM_USAGES[name]), systemReport(0)], 20);
    }

    const combination = keyboardCombination(name, Boolean(params.gui));
    if (combination) {
      return this.sendReports([
        keyboardReport(combination.usages, combination.modifiers),
        keyboardReport(0, 0),
      ], 20);
    }

    if (raw && /^[\x00-\x7f]{1,20}$/.test(raw)) {
      return this.sendReports(keyboardSequenceForText(raw), 15);
    }
    throw Object.assign(new Error(`Unsupported Bluetooth HID command ${command}`), { status: 422 });
  }

  async sendReports(reports, delayMs = 0) {
    await this.ensureStarted();
    if (!this.process?.stdin?.writable) throw Object.assign(new Error("Bluetooth HID helper is unavailable"), { status: 503 });
    const values = (reports || []).map((report) => Buffer.from(report).toString("base64"));
    this.process.stdin.write(`${JSON.stringify({ action: "sequence", reports: values, delay_ms: Math.max(0, Math.min(500, Number(delayMs) || 0)) })}\n`);
    return this.status();
  }

  async sendRemoteCommand(entity, commandId, params = {}) {
    if (entity?.entity_type !== "remote" || remoteKind(entity) !== "BT") return null;
    const id = String(commandId || "").toLowerCase();
    if (id.endsWith("send_key")) {
      const key = params?.key;
      if (!key) throw Object.assign(new Error("remote.send_key requires key"), { status: 422 });
      return this.sendCommand(key, { ...params, gui: Boolean(params.gui) });
    }
    const command = params?.command || params?.cmd_id;
    if (!command) throw Object.assign(new Error("remote.send_cmd requires command"), { status: 422 });
    return this.sendCommand(command, params);
  }

  #stdout(chunk) {
    this.stdoutBuffer += String(chunk || "");
    let index;
    while ((index = this.stdoutBuffer.indexOf("\n")) >= 0) {
      const line = this.stdoutBuffer.slice(0, index).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); }
      catch { log.info(line); continue; }
      this.#event(event);
    }
  }

  #event(event) {
    if (event.type === "ready") {
      this.state = { ...this.state, available: true, running: true, registered: true, transport: event.transport || "ble-hogp", last_error: null };
    } else if (event.type === "connected") {
      this.state = { ...this.state, connected: true, transport: event.transport || this.state.transport, peer: event.peer || this.state.peer };
    } else if (event.type === "disconnected") {
      this.state = { ...this.state, connected: false, peer: null };
    } else if (event.type === "error") {
      this.state = { ...this.state, last_error: String(event.message || "Bluetooth HID error") };
    } else if (event.type === "status") {
      this.state = { ...this.state, ...event.state };
    }
    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(event)) continue;
      clearTimeout(waiter.timer);
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      waiter.resolve(event);
    }
    this.platform.events.publish("bluetooth.hid", { ...this.status(), event: event.type });
  }

  #waitFor(predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(Object.assign(new Error("Timed out starting Bluetooth LE HID peripheral"), { status: 504 }));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  #stopped(error) {
    if (error) log.warn(error.message);
    this.process = null;
    this.state = {
      ...this.state,
      running: false,
      registered: false,
      connected: false,
      peer: null,
      ...(error ? { last_error: error.message } : {}),
    };
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error || new Error("Bluetooth LE HID helper stopped"));
    }
  }
}

export { REGULAR_USAGES as KEYBOARD_USAGES, CONSUMER_USAGES, SYSTEM_USAGES, MODIFIERS };
