import crypto from "node:crypto";
import http from "node:http";
import { VOICE_COMMAND_METADATA } from "./api-parity-compatibility.js";

let activePlatform = null;

function jsonBytes(value) {
  return Buffer.from(JSON.stringify(value));
}

function writeJson(response, status, value, headers = {}) {
  const payload = jsonBytes(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(payload.length),
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(payload);
}

async function readBody(request, maximum = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function captureResponse(response, onComplete) {
  const nativeWriteHead = response.writeHead.bind(response);
  const nativeWrite = response.write.bind(response);
  const nativeEnd = response.end.bind(response);
  let status = 200;
  let statusMessage;
  let headers = {};
  const chunks = [];
  let completed = false;

  response.writeHead = (value, messageOrHeaders, maybeHeaders) => {
    status = Number(value || 200);
    if (typeof messageOrHeaders === "string") {
      statusMessage = messageOrHeaders;
      headers = { ...(maybeHeaders || {}) };
    } else {
      headers = { ...(messageOrHeaders || {}) };
    }
    return response;
  };
  response.write = (chunk, encoding) => {
    if (chunk !== undefined && chunk !== null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    return true;
  };
  response.end = (chunk, encoding) => {
    if (completed) return response;
    completed = true;
    if (chunk !== undefined && chunk !== null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    const original = { status, statusMessage, headers: { ...headers }, body: Buffer.concat(chunks) };
    const replacement = onComplete(original) || original;
    if (replacement.json !== undefined) {
      const payload = jsonBytes(replacement.json);
      replacement.body = payload;
      replacement.headers = {
        ...(replacement.headers || {}),
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": String(payload.length),
        "Cache-Control": "no-store",
      };
    } else {
      replacement.body = Buffer.isBuffer(replacement.body) ? replacement.body : Buffer.from(replacement.body || []);
      replacement.headers = { ...(replacement.headers || {}), "Content-Length": String(replacement.body.length) };
    }
    if (replacement.statusMessage) nativeWriteHead(replacement.status, replacement.statusMessage, replacement.headers);
    else nativeWriteHead(replacement.status, replacement.headers);
    if (replacement.body.length) nativeWrite(replacement.body);
    nativeEnd();
    return response;
  };
}

function logWebState(platform) {
  const stored = platform.db.getSetting("system_log_web", {});
  return {
    autostart: Boolean(stored.autostart),
    enabled: Boolean(stored.enabled),
  };
}

function validateLogWebPatch(input = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(input, "autostart")) patch.autostart = Boolean(input.autostart);
  if (Object.prototype.hasOwnProperty.call(input, "enabled")) patch.enabled = Boolean(input.enabled);
  if (Object.prototype.hasOwnProperty.call(input, "password")) {
    const password = String(input.password || "");
    if (password && !/^[\w*@^(){}\[\]:,.=-]{6,30}$/.test(password)) {
      throw Object.assign(new Error("Log web-app password must be 6-30 allowed characters"), { status: 422 });
    }
    patch.password_hash = password
      ? crypto.createHash("sha256").update(password).digest("hex")
      : null;
  }
  return patch;
}

function rewriteCurrentAliases(request) {
  const url = new URL(request.url || "/", "http://localhost");
  if (url.pathname === "/api/cfg/voice") {
    url.pathname = "/api/cfg/voice_control";
    request.url = `${url.pathname}${url.search}`;
  } else if (url.pathname === "/api/resources/BtDeviceProfile") {
    url.pathname = "/api/cfg/bt/profiles";
    request.url = `${url.pathname}${url.search}`;
  }
}

function installResponseTransforms(platform, request, response) {
  const url = new URL(request.url || "/", "http://localhost");
  const method = String(request.method || "GET").toUpperCase();
  if (method !== "GET") return;

  if (url.pathname === "/api/cfg/voice_control/voice_assistants") {
    captureResponse(response, (original) => original.status >= 200 && original.status < 300
      ? { ...original, json: platform.voice.assistants() }
      : original);
    return;
  }

  if (url.pathname === "/api/cfg/entity/commands") {
    captureResponse(response, (original) => {
      if (original.status < 200 || original.status >= 300) return original;
      let current;
      try { current = JSON.parse(original.body.toString("utf8")); }
      catch { return original; }
      if (!Array.isArray(current)) return original;
      return {
        ...original,
        json: [...current, ...VOICE_COMMAND_METADATA.filter((voice) => !current.some((item) => item.id === voice.id))],
      };
    });
  }
}

async function installLogWebFallback(platform, request, response, listener) {
  const method = String(request.method || "GET").toUpperCase();
  let update = null;
  if (["PUT", "PATCH"].includes(method)) {
    try {
      const body = await readBody(request);
      update = validateLogWebPatch(body.length ? JSON.parse(body.toString("utf8")) : {});
    } catch (error) {
      writeJson(response, Number(error?.status || 400), { code: "INV_ARGUMENT", message: error.message });
      return;
    }
  }

  captureResponse(response, (original) => {
    // Preserve successful native handling and, critically, authentication
    // failures. The compatibility response is only substituted for the
    // native route-missing result after the server has authenticated it.
    if (![404, 405].includes(original.status)) return original;
    if (method === "GET") return { status: 200, headers: {}, json: logWebState(platform) };
    if (["PUT", "PATCH"].includes(method)) {
      const current = platform.db.getSetting("system_log_web", {});
      platform.db.setSetting("system_log_web", { ...current, ...update });
      return { status: 200, headers: {}, json: logWebState(platform) };
    }
    return original;
  });
  await listener(request, response);
}

export function registerCurrentRestPlatform(platform) {
  activePlatform = platform;
}

export function installCurrentRestCompatibility(httpModule = http) {
  if (httpModule.createServer.__ucvrCurrentRest) return;
  const previousCreateServer = httpModule.createServer;

  const createServer = function createServer(...args) {
    const listenerIndex = typeof args[0] === "function" ? 0 : typeof args[1] === "function" ? 1 : -1;
    if (listenerIndex >= 0) {
      const listener = args[listenerIndex];
      args[listenerIndex] = async (request, response) => {
        const platform = activePlatform;
        if (!platform) return listener(request, response);

        rewriteCurrentAliases(request);
        const url = new URL(request.url || "/", "http://localhost");
        if (url.pathname === "/api/system/logs/web") {
          return installLogWebFallback(platform, request, response, listener);
        }
        installResponseTransforms(platform, request, response);
        return listener(request, response);
      };
    }
    return previousCreateServer.apply(httpModule, args);
  };

  Object.defineProperty(createServer, "__ucvrCurrentRest", { value: true });
  httpModule.createServer = createServer;
}
