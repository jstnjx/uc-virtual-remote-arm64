import http from "node:http";
import { CoreWebSocketFacade } from "../core/websocket-facade.js";
import { sha256 } from "../shared/util.js";

let activePlatform = null;

const VOICE_COMMAND_METADATA = Object.freeze([
  {
    id: "voice_assistant.voice_start",
    entity_type: "voice_assistant",
    cmd_id: "voice_start",
    name: { en: "Start voice command" },
    params: [
      { param: "session_id", name: { en: "Session ID" }, type: "number" },
      { param: "profile_id", name: { en: "Profile" }, type: "regex", optional: true },
      { param: "speech_response", name: { en: "Speech response" }, type: "bool", optional: true },
      { param: "timeout", name: { en: "Timeout" }, type: "number", min: 1, optional: true },
    ],
  },
  {
    id: "voice_assistant.voice_end",
    entity_type: "voice_assistant",
    cmd_id: "voice_end",
    name: { en: "End voice command" },
    params: [{ param: "session_id", name: { en: "Session ID" }, type: "number" }],
  },
]);

function tokenFromRequest(request) {
  const authorization = String(request.headers.authorization || "");
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
  const query = new URL(request.url || "/", "http://localhost").searchParams.get("token");
  return request.headers["api-key"] || bearer || query || null;
}

function managementAuthorized(platform, request) {
  if (!platform?.adminToken) return true;
  return tokenFromRequest(request) === platform.adminToken;
}

function validCoreToken(platform, token) {
  if (!platform || !token) return false;
  if (platform.adminToken && token === platform.adminToken) return true;
  if (platform.coreToken && token === platform.coreToken) return true;
  return Boolean(platform.db.findApiKey(sha256(String(token))));
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

async function readBody(request, maximum = 1024 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximum) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const data = await readBody(request);
  if (!data.length) return {};
  try { return JSON.parse(data.toString("utf8")); }
  catch { throw Object.assign(new Error("Invalid JSON body"), { status: 400 }); }
}

function voiceRoute(pathname) {
  let match = pathname.match(/^\/api\/voice\/([^/]+)\/start$/);
  if (match) return { action: "start", entityId: decodeURIComponent(match[1]) };
  match = pathname.match(/^\/api\/voice\/([^/]+)\/(\d+)\/audio$/);
  if (match) return { action: "audio", entityId: decodeURIComponent(match[1]), sessionId: Number(match[2]) };
  match = pathname.match(/^\/api\/voice\/([^/]+)\/(\d+)\/(end|cancel)$/);
  if (match) return { action: match[3], entityId: decodeURIComponent(match[1]), sessionId: Number(match[2]) };
  return null;
}

async function handleVoiceManagement(platform, request, response, route) {
  if (!managementAuthorized(platform, request)) return sendJson(response, 401, { code: "AUTH_FAILED", message: "Unauthorized" });
  try {
    if (route.action === "start") return sendJson(response, 201, await platform.voice.start(route.entityId, await readJson(request)));
    if (route.action === "audio") return sendJson(response, 200, platform.voice.pushAudio(route.entityId, route.sessionId, await readBody(request, 512 * 1024)));
    if (route.action === "end") return sendJson(response, 200, platform.voice.end(route.entityId, route.sessionId));
    if (route.action === "cancel") {
      const input = await readJson(request).catch(() => ({}));
      return sendJson(response, 200, platform.voice.cancel(route.entityId, route.sessionId, input.reason || "CANCELLED"));
    }
  } catch (error) {
    return sendJson(response, Number(error?.status || 500), { code: "ERROR", message: error?.message || "Voice request failed" });
  }
}

function interceptJsonResponse(response, transform) {
  const nativeWriteHead = response.writeHead.bind(response);
  const nativeWrite = response.write.bind(response);
  const nativeEnd = response.end.bind(response);
  let statusCode = 200;
  let statusMessage;
  let headers = {};
  const chunks = [];

  response.writeHead = (status, messageOrHeaders, maybeHeaders) => {
    statusCode = Number(status || 200);
    if (typeof messageOrHeaders === "string") {
      statusMessage = messageOrHeaders;
      headers = { ...(maybeHeaders || {}) };
    } else headers = { ...(messageOrHeaders || {}) };
    return response;
  };
  response.write = (chunk, encoding) => {
    if (chunk !== undefined && chunk !== null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    return true;
  };
  response.end = (chunk, encoding) => {
    if (chunk !== undefined && chunk !== null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    let output = Buffer.concat(chunks);
    if (statusCode >= 200 && statusCode < 300) {
      try {
        const parsed = output.length ? JSON.parse(output.toString("utf8")) : null;
        output = Buffer.from(JSON.stringify(transform(parsed)));
        headers["Content-Type"] = "application/json; charset=utf-8";
        headers["Content-Length"] = String(output.length);
      } catch {}
    }
    if (statusMessage) nativeWriteHead(statusCode, statusMessage, headers);
    else nativeWriteHead(statusCode, headers);
    if (output.length) nativeWrite(output);
    return nativeEnd();
  };
}

function wsResponse(peer, id, msg, data = undefined, code = 200) {
  const payload = { kind: "resp", req_id: Number(id), msg, code };
  if (data !== undefined) payload.msg_data = data;
  peer.send(JSON.stringify(payload));
}

function wsEvent(peer, msg, cat, data) {
  peer.send(JSON.stringify({ kind: "event", msg, cat, ts: new Date().toISOString(), msg_data: data }));
}

function standbyInhibitors(platform) {
  const now = Date.now();
  const values = platform.db.getSetting("standby_inhibitors", []);
  const active = (Array.isArray(values) ? values : []).filter((item) => !item.expires_at || Number(item.expires_at) > now);
  if (active.length !== values.length) platform.db.setSetting("standby_inhibitors", active);
  return active;
}

async function compatibilityWsRequest(platform, peer, id, msg, data) {
  switch (msg) {
    case "get_voice_assistants":
      wsResponse(peer, id, "voice_assistants", platform.voice.assistants());
      return true;
    case "get_event_channels":
      wsResponse(peer, id, "event_channels", { channels: [
        "all", "configuration", "entities", "entity_button", "entity_switch", "entity_climate", "entity_cover",
        "entity_light", "entity_media_player", "entity_sensor", "entity_activity", "entity_macro", "entity_remote",
        "entity_select", "entity_voice_assistant", "activity_groups", "integrations", "profiles", "emitters", "docks",
        "software_update", "power_mode", "battery_status", "ambient_light", "wifi", "media", "assistant"
      ] });
      return true;
    case "reset_network_cfg":
      wsResponse(peer, id, "network_cfg", platform.configuration.reset("network"));
      return true;
    case "get_battery_charger":
      wsResponse(peer, id, "battery_charger", platform.db.getSetting("battery_charger", {
        connected: true, power_supply: true, charging: false, state: "FULL"
      }));
      return true;
    case "update_battery_charger": {
      const current = platform.db.getSetting("battery_charger", {});
      const next = { ...current, ...data };
      platform.db.setSetting("battery_charger", next);
      platform.events.publish("battery.charger", next);
      wsResponse(peer, id, "battery_charger", next);
      return true;
    }
    case "create_standby_inhibitor": {
      const values = standbyInhibitors(platform);
      const idValue = String(data.id || data.inhibitor_id || `inhibitor-${Date.now()}`);
      const timeout = Math.max(0, Number(data.timeout || data.timeout_ms || 0));
      const item = { ...data, id: idValue, ...(timeout ? { expires_at: Date.now() + timeout } : {}) };
      const next = [...values.filter((value) => value.id !== idValue), item];
      platform.db.setSetting("standby_inhibitors", next);
      wsResponse(peer, id, "result", { id: idValue });
      return true;
    }
    case "del_standby_inhibitor": {
      const idValue = String(data.id || data.inhibitor_id || "");
      platform.db.setSetting("standby_inhibitors", standbyInhibitors(platform).filter((item) => item.id !== idValue));
      wsResponse(peer, id, "result", {});
      return true;
    }
    case "del_all_standby_inhibitors":
      platform.db.setSetting("standby_inhibitors", []);
      wsResponse(peer, id, "result", {});
      return true;
    case "get_entity_command_metadata":
      wsResponse(peer, id, "entity_command_metadata", [...VOICE_COMMAND_METADATA]);
      return false;
    case "get_entity_commands": {
      const entity = platform.db.getConfiguredEntity(data.entity_id);
      if (entity?.entity_type !== "voice_assistant") return false;
      wsResponse(peer, id, "entity_commands", {
        entity_id: data.entity_id,
        entity_type: "voice_assistant",
        commands: [{ cmd_id: "voice_start" }, { cmd_id: "voice_end" }],
      });
      return true;
    }
    case "execute_entity_command": {
      const commandId = data.cmd_id || data.command_id || data.command;
      const result = await platform.integrations.command(data.entity_id, commandId, data.params);
      wsResponse(peer, id, "result", result || {});
      return true;
    }
    case "bt_pairing_response":
      platform.events.publish("bluetooth.pairing", { msg: "bt_pairing_response", ...data });
      wsResponse(peer, id, "result", {});
      return true;
    default:
      return false;
  }
}

function patchCoreWebSocketFacade() {
  if (CoreWebSocketFacade.prototype.attach.__ucvrApiParity) return;
  const nativeAttach = CoreWebSocketFacade.prototype.attach;

  const attach = function attach(peer, options = {}) {
    const before = new Set(peer.listeners("message"));
    const nativeSend = peer.send.bind(peer);
    nativeAttach.call(this, peer, options);
    const originalListener = peer.listeners("message").find((listener) => !before.has(listener));
    if (!originalListener) return;
    peer.removeListener("message", originalListener);

    const platform = this.platform;
    let authenticated = Boolean(options.authenticated) || validCoreToken(platform, options.token);
    let explicitSubscriptions = false;
    let channels = new Set();

    peer.send = (data, callback) => {
      nativeSend(data, callback);
      if (Buffer.isBuffer(data)) return;
      try {
        const payload = JSON.parse(String(data));
        if (payload?.kind === "event" && payload.msg === "profile_change") {
          const profile = payload.msg_data?.new_state?.profile;
          if (profile?.active === true) {
            nativeSend(JSON.stringify({
              kind: "event", msg: "active_profile_change", cat: "UI", ts: payload.ts || new Date().toISOString(),
              msg_data: { profile_id: payload.msg_data.profile_id || profile.id, profile }
            }));
          }
        }
      } catch {}
    };

    const dockPortListener = (event) => {
      if (!authenticated) return;
      if (explicitSubscriptions && !channels.has("all") && !channels.has("docks")) return;
      wsEvent(peer, "dock_port_mode", "DEVICE", event.data || {});
    };
    platform.events.on("dock.port", dockPortListener);
    peer.once("close", () => platform.events.off("dock.port", dockPortListener));

    peer.on("message", async (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return originalListener(raw); }
      if (message?.kind !== "req") return originalListener(raw);
      const msg = String(message.msg || "").toLowerCase();
      const data = message.msg_data && typeof message.msg_data === "object" ? message.msg_data : {};

      if (msg === "auth") {
        if (validCoreToken(platform, data.token)) authenticated = true;
        return originalListener(raw);
      }
      if (!authenticated) return originalListener(raw);

      if (msg === "subscribe_events") {
        explicitSubscriptions = true;
        channels = new Set(Array.isArray(data.channels) ? data.channels : ["all"]);
        return originalListener(raw);
      }
      if (msg === "unsubscribe_events") {
        explicitSubscriptions = true;
        const removals = Array.isArray(data.channels) ? data.channels : [];
        if (!removals.length) channels.clear();
        else for (const channel of removals) channels.delete(channel);
        return originalListener(raw);
      }

      try {
        const handled = await compatibilityWsRequest(platform, peer, message.id, msg, data);
        if (handled) return;
      } catch (error) {
        wsResponse(peer, message.id, "result", { code: "ERROR", message: error?.message || "Core request failed" }, Number(error?.status || 500));
        return;
      }
      return originalListener(raw);
    });
  };

  Object.defineProperty(attach, "__ucvrApiParity", { value: true });
  CoreWebSocketFacade.prototype.attach = attach;
}

function patchIntegrationCommands(platform) {
  if (platform.integrations.__ucvrVoiceCommandCompatibility) return;
  const nativeCommand = platform.integrations.command.bind(platform.integrations);
  platform.integrations.command = async (entityId, commandId, params = undefined) => {
    const entity = platform.db.getConfiguredEntity(entityId);
    if (entity?.entity_type === "voice_assistant") {
      const command = String(commandId || "").toLowerCase();
      if (command === "voice_start") return platform.voice.start(entityId, params || {});
      if (command === "voice_end") return platform.voice.end(entityId, params?.session_id);
    }
    return nativeCommand(entityId, commandId, params);
  };
  Object.defineProperty(platform.integrations, "__ucvrVoiceCommandCompatibility", { value: true });
}

export function registerApiParityPlatform(platform) {
  activePlatform = platform;
  patchIntegrationCommands(platform);
}

export function installApiParityCompatibility(httpModule = http) {
  patchCoreWebSocketFacade();
  if (httpModule.createServer.__ucvrApiParity) return;
  const nativeCreateServer = httpModule.createServer;

  const createServer = function createServer(...args) {
    const listenerIndex = typeof args[0] === "function" ? 0 : typeof args[1] === "function" ? 1 : -1;
    if (listenerIndex >= 0) {
      const listener = args[listenerIndex];
      args[listenerIndex] = (request, response) => {
        const platform = activePlatform;
        const url = new URL(request.url || "/", "http://localhost");
        const method = String(request.method || "GET").toUpperCase();

        if (platform) {
          const route = voiceRoute(url.pathname);
          if (route && ["POST", "PUT"].includes(method)) {
            handleVoiceManagement(platform, request, response, route);
            return;
          }
          if (url.pathname === "/api/voice" && method === "GET") {
            if (!managementAuthorized(platform, request)) return sendJson(response, 401, { code: "AUTH_FAILED", message: "Unauthorized" });
            return sendJson(response, 200, platform.voice.status());
          }

          if (url.pathname === "/cfg/voice") {
            url.pathname = "/cfg/voice_control";
            request.url = `${url.pathname}${url.search}`;
          } else if (url.pathname === "/resources/BtDeviceProfile") {
            url.pathname = "/cfg/bt/profiles";
            request.url = `${url.pathname}${url.search}`;
          }

          if (url.pathname === "/cfg/voice_control/voice_assistants" && method === "GET") {
            interceptJsonResponse(response, () => platform.voice.assistants());
          } else if (url.pathname === "/cfg/entity/commands" && method === "GET") {
            interceptJsonResponse(response, (value) => {
              const current = Array.isArray(value) ? value : [];
              return [...current, ...VOICE_COMMAND_METADATA.filter((voice) => !current.some((item) => item.id === voice.id))];
            });
          }
        }
        return listener(request, response);
      };
    }
    return nativeCreateServer.apply(httpModule, args);
  };

  Object.defineProperty(createServer, "__ucvrApiParity", { value: true });
  httpModule.createServer = createServer;
}

export { VOICE_COMMAND_METADATA };
