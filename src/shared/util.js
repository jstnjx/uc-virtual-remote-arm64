import crypto from "node:crypto";

export function nowIso() {
  return new Date().toISOString();
}

export function randomId(prefix = "") {
  return `${prefix}${crypto.randomUUID()}`;
}

export function slug(value, fallback = "item") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function jsonString(value, fallback = {}) {
  return JSON.stringify(value ?? fallback);
}

export function sleep(ms, signal = null) {
  if (!Number.isFinite(Number(ms)) || Number(ms) < 0) throw new Error("Invalid delay");
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new Error("Aborted"));
    const timer = setTimeout(done, Number(ms));
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal.reason || new Error("Aborted"));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function localEntityId(integrationId, entityId) {
  const value = String(entityId || "");
  const prefix = `${integrationId}.`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

export function qualifiedEntityId(integrationId, entityId) {
  const value = String(entityId || "");
  return value.startsWith(`${integrationId}.`) ? value : `${integrationId}.${value}`;
}

export function displayName(value, fallback = "") {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.en || Object.values(value).find((item) => typeof item === "string") || fallback;
  return fallback;
}

export function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}
