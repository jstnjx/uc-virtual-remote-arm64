import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import util from "node:util";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const PRIORITIES = { debug: 7, info: 6, warn: 4, error: 3 };
const CORE_SERVICE = "virtual-remote-core";
const configured = LEVELS[String(process.env.LOG_LEVEL || "info").toLowerCase()] || LEVELS.info;
const bootId = crypto.randomUUID();
const startedAt = new Date().toISOString();
const records = [];
let logFile = "";

function formatValue(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  return util.inspect(value, { depth: 6, colors: false, breakLength: Infinity, compact: true });
}

export function configureLogger(options = {}) {
  logFile = String(options.file || "");
  if (logFile) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `[${startedAt}] INFO  system boot_id=${bootId} Virtual Remote Core process started\n`);
  }
}

function write(level, scope, values) {
  if (LEVELS[level] < configured) return;
  const timestamp = new Date().toISOString();
  const message = values.map(formatValue).join(" ");
  const line = `[${timestamp}] ${level.toUpperCase().padEnd(5)} ${scope} ${message}`.trimEnd();
  const record = { timestamp, level, priority: PRIORITIES[level], scope, service: CORE_SERVICE, boot_id: bootId, message, line };
  records.push(record);
  if (records.length > 20000) records.splice(0, records.length - 20000);
  if (logFile) {
    try { fs.appendFileSync(logFile, `${line}\n`); } catch {}
  }
  const method = level === "debug" ? "log" : level;
  console[method](line);
}

export function logger(scope) {
  return Object.freeze({
    debug: (...values) => write("debug", scope, values),
    info: (...values) => write("info", scope, values),
    warn: (...values) => write("warn", scope, values),
    error: (...values) => write("error", scope, values)
  });
}

export function currentBootId() { return bootId; }

export function logServices(extra = []) {
  const values = [{ service: CORE_SERVICE, name: "Virtual Remote Core" }, ...extra];
  const seen = new Set();
  return values.filter((item) => item?.service && !seen.has(item.service) && seen.add(item.service));
}

export function logBoots() {
  const current = records.filter((item) => item.boot_id === bootId);
  return [{ boot_id: bootId, index: 0, first_entry: current[0]?.timestamp || startedAt, last_entry: current.at(-1)?.timestamp || new Date().toISOString() }];
}

export function queryLogRecords(query = {}, extraRecords = []) {
  const services = new Set(String(query.s || "").split(",").map((item) => decodeURIComponent(item)).filter(Boolean));
  const boots = new Set(String(query.boot_ids || "").split(",").filter(Boolean));
  const maximumPriority = Number.isFinite(Number(query.p)) ? Number(query.p) : 7;
  const from = query.from ? Date.parse(query.from) : Number.NEGATIVE_INFINITY;
  const to = query.to ? Date.parse(query.to) : Number.POSITIVE_INFINITY;
  const text = query.q ? decodeURIComponent(String(query.q)).toLowerCase() : "";
  const limit = Math.max(1, Math.min(10000, Number(query.limit || 1000)));
  return [...records, ...extraRecords].filter((item) => {
    const time = Date.parse(item.timestamp);
    return (!services.size || services.has(item.service)) &&
      (!boots.size || !item.boot_id || boots.has(item.boot_id)) &&
      Number(item.priority ?? 7) <= maximumPriority && time >= from && time <= to &&
      (!text || String(item.line || item.message || "").toLowerCase().includes(text));
  }).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(-limit);
}

export function formatLogRecords(values) {
  return values.map((item) => item.line || `[${item.timestamp}] ${String(item.level || "info").toUpperCase().padEnd(5)} ${item.scope || item.service} ${item.message || ""}`.trimEnd()).join("\n") + "\n";
}

export function queryLogs(query = {}, extraRecords = []) {
  return formatLogRecords(queryLogRecords(query, extraRecords));
}

export { CORE_SERVICE };
