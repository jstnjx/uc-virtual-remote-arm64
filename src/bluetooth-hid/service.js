import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../shared/logger.js";

const log = logger("bluetooth-hid");
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const KEYBOARD_USAGES = Object.freeze({
  BACK: 0x29,
  ESCAPE: 0x29,
  ENTER: 0x28,
  OK: 0x28,
  DPAD_MIDDLE: 0x28,
  DPAD_UP: 0x52,
  UP: 0x52,
  DPAD_DOWN: 0x51,
  DOWN: 0x51,
  DPAD_LEFT: 0x50,
  LEFT: 0x50,
  DPAD_RIGHT: 0x4f,
  RIGHT: 0x4f,
  HOME: 0x4a,
  MENU: 0x65,
  DELETE: 0x4c,
  BACKSPACE: 0x2a,
  TAB: 0x2b,
  SPACE: 0x2c,
});

const CONSUMER_USAGES = Object.freeze({
  POWER: 0x0030,
  MUTE: 0x00e2,
  VOLUME_UP: 0x00e9,
  VOLUME_DOWN: 0x00ea,
  PLAY: 0x00b0,
  PAUSE: 0x00b1,
  PLAY_PAUSE: 0x00cd,
  STOP: 0x00b7,
  NEXT: 0x00b5,
  PREV: 0x00b6,
  PREVIOUS: 0x00b6,
  RECORD: 0x00b2,
});

function signedByte(value) {
  return Math.max(-127, Math.min(127, Math.round(Number(value) || 0))) & 0xff;
}

export function keyboardReport(usage = 0, modifiers = 0) {
  return Buffer.from([1, Number(modifiers) & 0xff, 0, Number(usage) & 0xff, 0, 0, 0, 0, 0]);
}

export function mouseReport({ buttons = 0, dx = 0, dy = 0, wheel = 0 } = {}) {
  return Buffer.from([2, Number(buttons) & 0x1f, signedByte(dx), signedByte(dy), signedByte(wheel)]);
}

export function consumerReport(usage = 0) {
  const value = Number(usage) & 0xffff;
  return Buffer.from([3, value & 0xff, (value >>> 8) & 0xff]);
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
      const error = Object.assign(new Error(ready.message || "Unable to start Bluetooth HID peripheral"), { status: 502 });
      await this.stop().catch(() => {});
      if (options.optional) {
        this.state.last_error = error.message;
        return this.status();
      }
      throw error;
    }
    this.state.running = true;
    this.state.registered = true;
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
    const name = String(command || "").trim().toUpperCase();
    if (name === "MOUSE_MOVE" || name === "MOUSE") {
      return this.sendReports([mouseReport(params)]);
    }
    if (name === "MOUSE_CLICK") {
      const buttons = Math.max(1, Number(params.buttons || params.button || 1)) & 0x1f;
      return this.sendReports([mouseReport({ ...params, buttons }), mouseReport({})], 20);
    }
    if (name === "MOUSE_SCROLL" || name === "SCROLL") {
      return this.sendReports([mouseReport({ wheel: params.wheel ?? params.amount ?? 0 })]);
    }
    if (Object.prototype.hasOwnProperty.call(KEYBOARD_USAGES, name)) {
      return this.sendReports([keyboardReport(KEYBOARD_USAGES[name], params.modifiers), keyboardReport(0, 0)], 20);
    }
    if (Object.prototype.hasOwnProperty.call(CONSUMER_USAGES, name)) {
      return this.sendReports([consumerReport(CONSUMER_USAGES[name]), consumerReport(0)], 20);
    }
    if (/^KEY_[A-F0-9]{2}$/i.test(name)) {
      return this.sendReports([keyboardReport(Number.parseInt(name.slice(4), 16), params.modifiers), keyboardReport(0, 0)], 20);
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
    const command = params?.command || params?.cmd_id || commandId;
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
      this.state = { ...this.state, available: true, running: true, registered: true, last_error: null };
    } else if (event.type === "connected") {
      this.state = { ...this.state, connected: true, peer: event.peer || this.state.peer };
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
        reject(Object.assign(new Error("Timed out starting Bluetooth HID peripheral"), { status: 504 }));
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
      waiter.reject(error || new Error("Bluetooth HID helper stopped"));
    }
  }
}

export { KEYBOARD_USAGES, CONSUMER_USAGES };
