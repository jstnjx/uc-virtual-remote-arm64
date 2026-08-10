import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { displayName } from "../shared/util.js";
import { logger } from "../shared/logger.js";
import { runProcess } from "../shared/process.js";

const log = logger("native-integrations");
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_EXTRACTED_FILES = 20_000;
const RESTART_DELAY_MS = 2_000;

function safeJson(filename, fallback) {
  try { return JSON.parse(fs.readFileSync(filename, "utf8")); }
  catch { return structuredClone(fallback); }
}

function atomicJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temp = `${filename}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, filename);
}

function numericId(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function chownTree(root, uid, gid) {
  if (uid === null || gid === null || typeof process.getuid !== "function" || process.getuid() !== 0 || !fs.existsSync(root)) return;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(filename);
      fs.chownSync(filename, uid, gid);
    }
    fs.chownSync(current, uid, gid);
  }
}

function nativeEnvironment(record, host, configDir, dataDir) {
  const env = {};
  for (const key of ["PATH", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "TZ", "SSL_CERT_FILE", "SSL_CERT_DIR", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return {
    ...env,
    HOME: dataDir,
    UC_CONFIG_HOME: configDir,
    UC_DATA_HOME: dataDir,
    STATE_DIRECTORY: dataDir,
    UC_INTEGRATION_INTERFACE: host,
    UC_INTEGRATION_HTTP_PORT: String(record.port),
    UC_DISABLE_MDNS_PUBLISH: "true",
    UC_CLIENT_NAME: `ucvr-${record.driver_id}`,
    UC_LOG_LEVEL: String(process.env.UCVR_NATIVE_LOG_LEVEL || process.env.LOG_LEVEL || "INFO").toUpperCase(),
    PYTHONUNBUFFERED: "1"
  };
}

function parseVersion(value) {
  const match = String(value || "").trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function versionAtLeast(current, minimum) {
  const left = parseVersion(current);
  const right = parseVersion(minimum);
  if (!right || !left) return true;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

export function validateTarListing(output) {
  const entries = String(output || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (!entries.length) throw Object.assign(new Error("Integration archive is empty"), { status: 422 });
  if (entries.length > MAX_EXTRACTED_FILES) throw Object.assign(new Error("Integration archive contains too many files"), { status: 413 });
  for (const raw of entries) {
    if (raw === "." || raw === "./") continue;
    const name = raw.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!name || name.startsWith("/") || /^[A-Za-z]:\//.test(name)) {
      throw Object.assign(new Error(`Unsafe integration archive path: ${raw}`), { status: 422 });
    }
    const parts = name.split("/").filter(Boolean);
    if (parts.includes("..")) throw Object.assign(new Error(`Unsafe integration archive path: ${raw}`), { status: 422 });
  }
  return entries;
}

export function validateTarTypes(output) {
  const lines = String(output || "").split(/\r?\n/).map((item) => item.trimStart()).filter(Boolean);
  for (const line of lines) {
    const type = line[0];
    if (type !== "-" && type !== "d") {
      throw Object.assign(new Error(`Integration archive contains unsupported link or special file: ${line}`), { status: 422 });
    }
  }
}

function inspectTree(root) {
  let files = 0;
  const stack = [path.resolve(root)];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      const stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink()) throw Object.assign(new Error(`Integration archive contains unsupported symbolic link: ${path.relative(root, filename)}`), { status: 422 });
      if (stat.isDirectory()) stack.push(filename);
      else if (stat.isFile()) files += 1;
      else throw Object.assign(new Error(`Integration archive contains unsupported special file: ${path.relative(root, filename)}`), { status: 422 });
      if (files > MAX_EXTRACTED_FILES) throw Object.assign(new Error("Integration archive contains too many files"), { status: 413 });
    }
  }
}

function packageRoot(extracted) {
  const direct = path.join(extracted, "driver.json");
  if (fs.existsSync(direct)) return extracted;
  const matches = [];
  for (const entry of fs.readdirSync(extracted, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(extracted, entry.name);
    if (fs.existsSync(path.join(candidate, "driver.json"))) matches.push(candidate);
  }
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw Object.assign(new Error("Integration archive does not contain driver.json at the package root"), { status: 422 });
  throw Object.assign(new Error("Integration archive contains multiple package roots"), { status: 422 });
}

function copyMissingTree(source, destination) {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) return;
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyMissingTree(from, to);
    } else if (entry.isFile() && !fs.existsSync(to)) {
      fs.copyFileSync(from, to);
      fs.chmodSync(to, fs.statSync(from).mode & 0o777);
    }
  }
}

function packageExecutable(root) {
  const standard = path.join(root, "bin", "driver");
  if (fs.existsSync(standard) && fs.statSync(standard).isFile()) return standard;
  const bin = path.join(root, "bin");
  if (fs.existsSync(bin)) {
    const candidates = fs.readdirSync(bin)
      .map((name) => path.join(bin, name))
      .filter((filename) => {
        try { return fs.statSync(filename).isFile() && (fs.statSync(filename).mode & 0o111); }
        catch { return false; }
      });
    if (candidates.length === 1) return candidates[0];
  }
  throw Object.assign(new Error("Integration archive is missing the standard bin/driver executable"), { status: 422 });
}

export function executableArchitecture(filename) {
  const handle = fs.openSync(filename, "r");
  try {
    const header = Buffer.alloc(20);
    const read = fs.readSync(handle, header, 0, header.length, 0);
    if (read < 20 || header[0] !== 0x7f || header[1] !== 0x45 || header[2] !== 0x4c || header[3] !== 0x46) return null;
    const littleEndian = header[5] !== 2;
    const machine = littleEndian ? header.readUInt16LE(18) : header.readUInt16BE(18);
    if (machine === 183) return "arm64";
    if (machine === 62) return "amd64";
    if (machine === 40) return "arm";
    return `elf-${machine}`;
  } finally {
    fs.closeSync(handle);
  }
}

async function portAvailable(host, port) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (available) => { socket.destroy(); resolve(available); };
    socket.setTimeout(350, () => done(true));
    socket.once("connect", () => done(false));
    socket.once("error", () => done(true));
  });
}

async function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await portAvailable(host, port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

function readTail(filename, limit) {
  try {
    const lines = fs.readFileSync(filename, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit);
  } catch { return []; }
}

export class NativeIntegrationService {
  constructor(platform, options = {}) {
    this.platform = platform;
    this.runner = options.runner || runProcess;
    this.host = options.host || process.env.UCVR_NATIVE_INTEGRATION_HOST || "127.0.0.1";
    this.portStart = Math.max(1024, Number(options.portStart || process.env.UCVR_INTEGRATION_PORT_START || 11091));
    const applianceRuntime = String(process.env.UCVR_REQUIRE_ARM64 || "").toLowerCase() === "true";
    this.runUid = numericId(options.runUid ?? process.env.UCVR_NATIVE_UID, applianceRuntime ? 1000 : null);
    this.runGid = numericId(options.runGid ?? process.env.UCVR_NATIVE_GID, applianceRuntime ? 1000 : null);
    this.root = path.join(platform.dataDir, "native-integrations");
    this.packagesDir = path.join(this.root, "packages");
    this.configDir = path.join(this.root, "config");
    this.runtimeDataDir = path.join(this.root, "data");
    this.logsDir = path.join(this.root, "logs");
    this.stagingDir = path.join(this.root, "staging");
    this.statePath = path.join(this.root, "state.json");
    this.state = safeJson(this.statePath, { version: 1, integrations: {} });
    this.processes = new Map();
    this.restartTimers = new Map();
    this.stopping = false;
    for (const directory of [this.root, this.packagesDir, this.configDir, this.runtimeDataDir, this.logsDir, this.stagingDir]) {
      fs.mkdirSync(directory, { recursive: true });
    }
  }

  async start() {
    this.stopping = false;
    if (String(process.env.UCVR_REQUIRE_ARM64 || "").toLowerCase() === "true" && process.arch !== "arm64") {
      throw new Error(`UC Virtual Remote ARM64 requires an arm64 runtime, detected ${process.arch}`);
    }
    const records = Object.values(this.state.integrations || {});
    for (const record of records) {
      if (!fs.existsSync(record.package_dir || "")) continue;
      this.#ensureDatabaseRecord(record);
      await this.startDriver(record.driver_id, { wait: true }).catch((error) => {
        log.warn(`Unable to start native integration ${record.driver_id}:`, error.message);
      });
    }
    log.info(`Native integration runtime ready: installed=${records.length}, running=${this.processes.size}`);
  }

  async stop() {
    this.stopping = true;
    for (const timer of this.restartTimers.values()) clearTimeout(timer);
    this.restartTimers.clear();
    await Promise.allSettled([...this.processes.keys()].map((driverId) => this.stopDriver(driverId)));
  }

  status() {
    return {
      architecture: process.arch,
      installed: Object.keys(this.state.integrations || {}).length,
      running: this.processes.size,
      root: this.root
    };
  }

  records() { return Object.values(this.state.integrations || {}).map((item) => ({ ...item })); }

  reservedPorts() {
    return new Set(Object.values(this.state.integrations || {}).map((item) => Number(item.port)).filter(Boolean));
  }

  managedRecord(idOrDriver) {
    const key = String(idOrDriver || "");
    return this.state.integrations[key]
      || Object.values(this.state.integrations || {}).find((item) => item.driver_id === key)
      || null;
  }

  async install(archive, options = {}) {
    if (!Buffer.isBuffer(archive)) throw Object.assign(new Error("Integration archive is required"), { status: 400 });
    if (archive.length > MAX_ARCHIVE_BYTES) throw Object.assign(new Error("Integration archive is too large"), { status: 413 });

    const staging = fs.mkdtempSync(path.join(this.stagingDir, "upload-"));
    const archiveFile = path.join(staging, "integration.tar.gz");
    const extracted = path.join(staging, "extracted");
    fs.mkdirSync(extracted, { recursive: true });
    fs.writeFileSync(archiveFile, archive, { mode: 0o600 });

    try {
      const listing = await this.runner("tar", ["-tzf", archiveFile], { timeoutMs: 30_000, env: { LC_ALL: "C" } });
      validateTarListing(listing.stdout);
      const verboseListing = await this.runner("tar", ["-tvzf", archiveFile], { timeoutMs: 30_000, env: { LC_ALL: "C" } });
      validateTarTypes(verboseListing.stdout);
      await this.runner("tar", ["-xzf", archiveFile, "--no-same-owner", "--no-same-permissions", "-C", extracted], { timeoutMs: 90_000, env: { LC_ALL: "C" } });
      inspectTree(extracted);
      const sourceRoot = packageRoot(extracted);
      const metadata = JSON.parse(fs.readFileSync(path.join(sourceRoot, "driver.json"), "utf8"));
      const driverId = String(metadata.driver_id || "").trim();
      if (!/^[A-Za-z0-9_.-]{1,80}$/.test(driverId) || driverId === "." || driverId === "..") {
        throw Object.assign(new Error("driver.json contains an invalid driver_id"), { status: 422 });
      }
      if (metadata.min_core_api && !versionAtLeast(this.platform.restCoreApiVersion, metadata.min_core_api)) {
        throw Object.assign(new Error(`Integration requires Core API ${metadata.min_core_api}, this runtime provides ${this.platform.restCoreApiVersion}`), { status: 409 });
      }
      const executable = packageExecutable(sourceRoot);
      fs.chmodSync(executable, fs.statSync(executable).mode | 0o755);
      const architecture = executableArchitecture(executable);
      if (architecture && architecture !== "arm64") {
        throw Object.assign(new Error(`Integration executable is ${architecture}; an ARM64/aarch64 package is required`), { status: 409 });
      }

      const existing = this.managedRecord(driverId);
      const update = options.update === true;
      if (existing && !update) throw Object.assign(new Error(`Custom integration ${driverId} is already installed; enable Update to replace it`), { status: 409 });
      if (!existing && update) throw Object.assign(new Error(`Custom integration ${driverId} is not installed and cannot be updated`), { status: 404 });

      const port = existing?.port || await this.#nextPort();
      const packageDir = path.join(this.packagesDir, driverId);
      const backupDir = `${packageDir}.backup-${Date.now()}`;
      const previousRecord = existing ? { ...existing } : null;
      const databaseRecord = this.#databaseRecord(driverId);

      if (databaseRecord) await this.platform.integrations.disconnect(databaseRecord.id).catch(() => {});
      await this.stopDriver(driverId).catch(() => {});
      if (fs.existsSync(packageDir)) fs.renameSync(packageDir, backupDir);
      fs.renameSync(sourceRoot, packageDir);
      const relativeExecutable = path.relative(sourceRoot, executable);
      const record = {
        driver_id: driverId,
        name: displayName(metadata.name, driverId),
        version: String(metadata.version || this.#versionFile(packageDir) || "unknown").replace(/^v/, ""),
        min_core_api: metadata.min_core_api || null,
        package_dir: packageDir,
        executable: path.join(packageDir, relativeExecutable),
        port,
        architecture: architecture || "script",
        metadata,
        installed_at: existing?.installed_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        source_filename: String(options.filename || "integration.tar.gz")
      };
      this.state.integrations[driverId] = record;
      atomicJson(this.statePath, this.state);

      // UC integration packages can include default config/data assets. Seed only
      // files that do not already exist so upgrades never overwrite user state.
      copyMissingTree(path.join(packageDir, "config"), path.join(this.configDir, driverId));
      copyMissingTree(path.join(packageDir, "data"), path.join(this.runtimeDataDir, driverId));

      try {
        await this.startDriver(driverId, { wait: true });
        const saved = await this.#upsertDatabaseRecord(record, databaseRecord);
        if (saved.enabled !== false) await this.platform.integrations.connect(saved.id).catch((error) => log.warn(`Native integration ${driverId} connection failed after install:`, error.message));
        fs.rmSync(backupDir, { recursive: true, force: true });
        log.info(`${update ? "Updated" : "Installed"} native integration ${driverId} ${record.version} on port ${port}`);
        return this.platform.db.getIntegration(saved.id) || saved;
      } catch (error) {
        await this.stopDriver(driverId).catch(() => {});
        fs.rmSync(packageDir, { recursive: true, force: true });
        if (fs.existsSync(backupDir)) fs.renameSync(backupDir, packageDir);
        if (previousRecord) this.state.integrations[driverId] = previousRecord;
        else delete this.state.integrations[driverId];
        atomicJson(this.statePath, this.state);
        if (previousRecord) await this.startDriver(driverId, { wait: false }).catch(() => {});
        throw error;
      }
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  async setRunning(idOrDriver, running) {
    const record = this.managedRecord(idOrDriver);
    if (!record) return false;
    if (running) await this.startDriver(record.driver_id, { wait: true });
    else await this.stopDriver(record.driver_id);
    return true;
  }

  async restart(idOrDriver) {
    const record = this.managedRecord(idOrDriver);
    if (!record) return false;
    await this.stopDriver(record.driver_id);
    await this.startDriver(record.driver_id, { wait: true });
    return true;
  }

  async remove(idOrDriver) {
    const record = this.managedRecord(idOrDriver);
    if (!record) return false;
    await this.stopDriver(record.driver_id).catch(() => {});
    delete this.state.integrations[record.driver_id];
    atomicJson(this.statePath, this.state);
    fs.rmSync(record.package_dir, { recursive: true, force: true });
    fs.rmSync(path.join(this.configDir, record.driver_id), { recursive: true, force: true });
    fs.rmSync(path.join(this.runtimeDataDir, record.driver_id), { recursive: true, force: true });
    fs.rmSync(path.join(this.logsDir, `${record.driver_id}.log`), { force: true });
    log.info(`Removed native integration ${record.driver_id}`);
    return true;
  }

  async factoryReset() {
    this.stopping = true;
    await Promise.allSettled([...this.processes.keys()].map((driverId) => this.stopDriver(driverId)));
    this.state = { version: 1, integrations: {} };
    fs.rmSync(this.root, { recursive: true, force: true });
  }

  services() {
    return Object.values(this.state.integrations || {}).map((item) => ({
      service: `native:${item.driver_id}`,
      name: item.name || item.driver_id,
      driver_id: item.driver_id,
      native: true
    }));
  }

  async logRecords(query = {}) {
    const requested = new Set(String(query.s || "").split(",").map(decodeURIComponent).filter(Boolean));
    const limit = Math.max(1, Math.min(10_000, Number(query.limit || 1000)));
    const records = [];
    for (const service of this.services().filter((item) => !requested.size || requested.has(item.service))) {
      const filename = path.join(this.logsDir, `${service.driver_id}.log`);
      for (const raw of readTail(filename, limit)) {
        const match = raw.match(/^\[(\d{4}-\d\d-\d\dT[^\]]+)\]\s+(INFO|WARN|ERROR)\s+(.*)$/);
        const timestamp = match && !Number.isNaN(Date.parse(match[1])) ? new Date(match[1]).toISOString() : new Date().toISOString();
        const level = match ? match[2].toLowerCase() : "info";
        const message = match ? match[3] : raw;
        records.push({
          timestamp,
          level,
          priority: level === "error" ? 3 : level === "warn" ? 4 : 6,
          scope: service.service,
          service: service.service,
          message,
          line: `[${timestamp}] ${level.toUpperCase().padEnd(5)} ${service.service} ${message}`
        });
      }
    }
    return records;
  }

  async startDriver(idOrDriver, options = {}) {
    const record = this.managedRecord(idOrDriver);
    if (!record) throw Object.assign(new Error("Native integration not found"), { status: 404 });
    const current = this.processes.get(record.driver_id);
    if (current && current.exitCode === null && !current.killed) return record;
    if (!fs.existsSync(record.executable)) throw new Error(`Native integration executable is missing: ${record.executable}`);

    const configDir = path.join(this.configDir, record.driver_id);
    const dataDir = path.join(this.runtimeDataDir, record.driver_id);
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(this.logsDir, { recursive: true });
    chownTree(configDir, this.runUid, this.runGid);
    chownTree(dataDir, this.runUid, this.runGid);
    const logFile = path.join(this.logsDir, `${record.driver_id}.log`);
    const child = spawn(record.executable, [], {
      cwd: record.package_dir,
      env: nativeEnvironment(record, this.host, configDir, dataDir),
      ...(this.runUid !== null && this.runGid !== null && typeof process.getuid === "function" && process.getuid() === 0
        ? { uid: this.runUid, gid: this.runGid }
        : {}),
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.processes.set(record.driver_id, child);
    this.#pipeLogs(record.driver_id, child.stdout, "INFO", logFile);
    this.#pipeLogs(record.driver_id, child.stderr, "ERROR", logFile);
    child.once("error", (error) => log.warn(`Native integration ${record.driver_id} process error:`, error.message));
    child.once("exit", (code, signal) => {
      if (this.processes.get(record.driver_id) === child) this.processes.delete(record.driver_id);
      if (child.__ucvrExpectedStop || this.stopping) {
        log.info(`Native integration ${record.driver_id} stopped: code=${code ?? "null"} signal=${signal || "none"}`);
      } else {
        log.warn(`Native integration ${record.driver_id} exited unexpectedly: code=${code ?? "null"} signal=${signal || "none"}`);
        this.#scheduleRestart(record.driver_id);
      }
    });

    if (options.wait !== false) {
      const timeout = Number(process.env.UCVR_INTEGRATION_START_TIMEOUT_MS || 45_000);
      if (!await waitForPort(this.host, record.port, timeout)) {
        const tail = readTail(logFile, 60).join("\n");
        await this.stopDriver(record.driver_id).catch(() => {});
        throw new Error(`Native integration ${record.driver_id} did not open Integration API port ${record.port}.${tail ? ` Last output: ${tail.slice(-2000)}` : ""}`);
      }
    }
    return record;
  }

  async stopDriver(idOrDriver) {
    const record = this.managedRecord(idOrDriver);
    const driverId = record?.driver_id || String(idOrDriver || "");
    clearTimeout(this.restartTimers.get(driverId));
    this.restartTimers.delete(driverId);
    const child = this.processes.get(driverId);
    if (!child) return false;
    child.__ucvrExpectedStop = true;
    this.processes.delete(driverId);
    if (child.exitCode !== null || child.killed) return true;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        resolve();
      }, 5_000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      try { child.kill("SIGTERM"); } catch { clearTimeout(timer); resolve(); }
    });
    return true;
  }

  #scheduleRestart(driverId) {
    if (this.restartTimers.has(driverId)) return;
    const timer = setTimeout(() => {
      this.restartTimers.delete(driverId);
      this.startDriver(driverId, { wait: false }).catch((error) => log.warn(`Native integration ${driverId} restart failed:`, error.message));
    }, RESTART_DELAY_MS);
    timer.unref?.();
    this.restartTimers.set(driverId, timer);
  }

  #pipeLogs(driverId, stream, level, filename) {
    let pending = "";
    stream?.on("data", (chunk) => {
      pending += chunk.toString("utf8");
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) {
        if (!line) continue;
        const output = `[${new Date().toISOString()}] ${level} ${line}\n`;
        try { fs.appendFileSync(filename, output); } catch {}
        if (level === "ERROR") log.warn(`${driverId}: ${line}`);
        else log.info(`${driverId}: ${line}`);
      }
    });
    stream?.once("end", () => {
      if (!pending) return;
      try { fs.appendFileSync(filename, `[${new Date().toISOString()}] ${level} ${pending}\n`); } catch {}
    });
  }

  async #nextPort() {
    const used = this.reservedPorts();
    for (const port of this.platform.externalIntegrations?.reservedPorts?.() || []) used.add(Number(port));
    for (let port = this.portStart; port <= 65535; port += 1) {
      if (!used.has(port) && await portAvailable(this.host, port)) return port;
    }
    throw new Error(`No free integration port found from ${this.portStart}`);
  }

  #databaseRecord(driverId) {
    return this.platform.db.listIntegrations().find((item) => String(item.driver_id || item.metadata?.driver_id || item.id) === String(driverId) && !item.metadata?.instance_alias) || null;
  }

  #ensureDatabaseRecord(record) {
    const existing = this.#databaseRecord(record.driver_id);
    const values = {
      id: existing?.id || record.driver_id,
      driver_id: record.driver_id,
      name: record.name,
      url: `ws://${this.host}:${record.port}`,
      enabled: existing?.enabled !== false,
      configured: existing?.configured ?? false,
      driver_type: "CUSTOM",
      driver_version: record.version,
      metadata: { ...(record.metadata || {}), driver_id: record.driver_id, native_runtime: true }
    };
    if (existing) return this.platform.db.updateIntegration(existing.id, values);
    return this.platform.db.saveIntegration(values);
  }

  async #upsertDatabaseRecord(record, existing) {
    const values = {
      driver_id: record.driver_id,
      name: record.name,
      url: `ws://${this.host}:${record.port}`,
      driver_type: "CUSTOM",
      driver_version: record.version,
      metadata: { ...(existing?.metadata || {}), ...(record.metadata || {}), driver_id: record.driver_id, native_runtime: true }
    };
    if (existing) return this.platform.db.updateIntegration(existing.id, values);
    return await this.platform.integrations.register({
      id: record.driver_id,
      ...values,
      enabled: true,
      configured: false
    });
  }

  #versionFile(root) {
    try { return fs.readFileSync(path.join(root, "version.txt"), "utf8").trim(); }
    catch { return null; }
  }
}
