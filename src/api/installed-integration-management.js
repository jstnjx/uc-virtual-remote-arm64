import net from "node:net";
import { displayName, sha256 } from "../shared/util.js";
import { visibleIntegrations } from "../core/models.js";
import { logger } from "../shared/logger.js";

const log = logger("installed-integration-management");
const ROUTE_ROOT = "/management/installed-integrations";
const CORE_INSTANCE_ROOT = "/api/intg/instances/";
const ATTACHED = Symbol.for("ucvr.installed-integration-management.attached");
const MAX_BODY = 64 * 1024;

function json(response, status, payload) {
  const value = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(value),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(value);
}

function noContent(response, status = 204) {
  response.writeHead(status, { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end();
}

function cookies(request) {
  const values = {};
  for (const item of String(request.headers.cookie || "").split(";")) {
    const index = item.indexOf("=");
    if (index < 0) continue;
    values[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim());
  }
  return values;
}

function basicCredentials(request) {
  const authorization = String(request.headers.authorization || "");
  if (!authorization.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return null;
  }
}

function authenticated(request, url, httpServer, platform) {
  const session = cookies(request).ucvr_session;
  if (session && httpServer.sessions?.has(session)) return true;
  if (!platform.adminToken) return true;
  const authorization = String(request.headers.authorization || "");
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
  const key = request.headers["api-key"] || bearer || url.searchParams.get("token");
  if (key === platform.adminToken) return true;
  return Boolean(key && platform.db.findApiKey(sha256(key)));
}

function coreAuthenticated(request, url, httpServer, platform) {
  const session = cookies(request).ucvr_session;
  if (session && httpServer.sessions?.has(session)) return true;

  const credentials = basicCredentials(request);
  if (
    credentials &&
    credentials.username === "web-configurator" &&
    credentials.password === String(platform.pin)
  ) {
    return true;
  }

  const authorization = String(request.headers.authorization || "");
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
  const key = request.headers["api-key"] || bearer || url.searchParams.get("token");
  if (platform.adminToken && key === platform.adminToken) return true;
  return Boolean(key && platform.db.findApiKey(sha256(key)));
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Invalid JSON body"), { status: 400 }); }
}

function route(pathname) {
  if (pathname === ROUTE_ROOT) return { root: true };
  if (!pathname.startsWith(`${ROUTE_ROOT}/`)) return null;
  const parts = pathname.slice(ROUTE_ROOT.length + 1).split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 1) return { id: parts[0] };
  if (parts.length === 2) return { id: parts[0], action: parts[1] };
  return null;
}

function coreInstanceDeleteId(pathname) {
  if (!pathname.startsWith(CORE_INSTANCE_ROOT)) return null;
  const suffix = pathname.slice(CORE_INSTANCE_ROOT.length);
  if (!suffix || suffix.includes("/")) return null;
  try { return decodeURIComponent(suffix); }
  catch { return null; }
}

function driverId(record) {
  return String(record?.driver_id || record?.metadata?.driver_id || record?.id || "");
}

function integrationRecord(platform, id) {
  const records = visibleIntegrations(platform.db.listIntegrations());
  const direct = records.find((record) => String(record.id) === String(id));
  if (direct) return direct;

  const resolved = platform.integrations.resolveIntegration?.(id);
  if (resolved?.record && visibleIntegrations([resolved.record]).length) {
    return resolved.record;
  }
  return null;
}

async function waitForPort(host, port, timeoutMs = 20_000) {
  if (!port) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      const done = (value) => { socket.destroy(); resolve(value); };
      socket.setTimeout(600, () => done(false));
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });
    if (connected) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function containerRuntime(service, managed) {
  if (!managed?.container) return null;
  try {
    const result = await service.runner(
      process.env.UCVR_DOCKER_BIN || "docker",
      ["inspect", "--format", "{{json .State}}", managed.container],
      { timeoutMs: 5000, rejectOnError: false }
    );
    if (result.code !== 0) {
      return {
        state: "missing",
        running: false,
        error: String(result.stderr || result.stdout || "Container not found").trim()
      };
    }
    const state = JSON.parse(String(result.stdout || "{}").trim() || "{}");
    return {
      state: String(state.Status || "unknown").toLowerCase(),
      running: Boolean(state.Running),
      paused: Boolean(state.Paused),
      restarting: Boolean(state.Restarting),
      started_at: state.StartedAt || null,
      finished_at: state.FinishedAt || null,
      exit_code: Number.isFinite(Number(state.ExitCode)) ? Number(state.ExitCode) : null,
      error: state.Error || null
    };
  } catch (error) {
    return { state: "unavailable", running: false, error: error.message };
  }
}

export async function installedIntegrationItems(platform) {
  const service = platform.externalIntegrations;
  const records = visibleIntegrations(platform.db.listIntegrations());
  const updateItems = await service.updates(false).catch(() => []);
  const updates = new Map(updateItems.map((item) => [String(item.driver_id), item]));

  return await Promise.all(records.map(async (record) => {
    const id = driverId(record);
    const managed = service.managedRecord(id);
    const native = platform.nativeIntegrations?.managedRecord?.(id) || null;
    const runtime = managed ? await containerRuntime(service, managed) : native ? {
      state: platform.nativeIntegrations?.processes?.has?.(native.driver_id) ? "running" : "stopped",
      running: Boolean(platform.nativeIntegrations?.processes?.has?.(native.driver_id)),
      pid: platform.nativeIntegrations?.processes?.get?.(native.driver_id)?.pid || null
    } : null;
    const update = updates.get(id) || null;
    const configuredEntities = platform.db.listConfiguredEntities(record.id)?.length || 0;
    const availableEntities = platform.db.listAvailableEntities(record.id)?.length || 0;
    return {
      id: record.id,
      driver_id: id,
      name: displayName(record.name || record.metadata?.name, record.id),
      version: record.driver_version || record.metadata?.version || managed?.version || "unknown",
      status: record.status || "DISCONNECTED",
      device_state: record.device_state || "UNKNOWN",
      setup_state: record.setup_state || "IDLE",
      configured: record.configured !== false,
      enabled: record.enabled !== false,
      url: record.url || null,
      entities: configuredEntities,
      available_entities: availableEntities,
      registry_managed: Boolean(managed || record.registry_managed || record.metadata?.registry_managed),
      native_managed: Boolean(native || record.metadata?.native_runtime),
      update: update ? {
        supported: Boolean(update.update_supported),
        available: Boolean(update.update_available),
        available_version: update.available_version || null,
        checked_at: update.checked_at || null,
        error: update.check_error || null
      } : null,
      managed: managed ? {
        container: managed.container,
        image: managed.image,
        source: managed.source,
        port: managed.port,
        installed_at: managed.installed_at,
        updated_at: managed.updated_at,
        runtime
      } : native ? {
        native: true,
        executable: native.executable,
        source: "tarball",
        port: native.port,
        architecture: native.architecture,
        installed_at: native.installed_at,
        updated_at: native.updated_at,
        runtime
      } : null
    };
  }));
}

async function startManaged(platform, record, managed) {
  const started = await platform.externalIntegrations.setRunning(driverId(record), true);
  if (!started) throw Object.assign(new Error("Managed integration container was not found"), { status: 404 });
  if (!await waitForPort(platform.externalIntegrations.integrationHost, managed.port)) {
    throw Object.assign(new Error(`Container ${managed.container} did not become ready on port ${managed.port}`), { status: 504 });
  }
}

async function restartManaged(platform, managed) {
  const result = await platform.externalIntegrations.runner(
    process.env.UCVR_DOCKER_BIN || "docker",
    ["restart", managed.container],
    { timeoutMs: 90_000, rejectOnError: false }
  );
  if (result.code !== 0) {
    throw Object.assign(new Error(String(result.stderr || result.stdout || "Container restart failed").trim()), { status: 502 });
  }
  if (!await waitForPort(platform.externalIntegrations.integrationHost, managed.port)) {
    throw Object.assign(new Error(`Container ${managed.container} did not become ready on port ${managed.port}`), { status: 504 });
  }
}

export async function resetIntegrationInstance(platform, id) {
  const record = integrationRecord(platform, id);
  if (!record) return false;

  const recordDriverId = driverId(record);
  const sameDriverRecords = visibleIntegrations(platform.db.listIntegrations()).filter(
    (candidate) => driverId(candidate) === recordDriverId
  );
  const persistentDriver = sameDriverRecords.find(
    (candidate) =>
      candidate.id !== record.id &&
      (String(candidate.id) === recordDriverId || candidate.configured === false)
  );

  // When Core stores the driver and its instances as separate records, deleting
  // the instance record already gives us the desired first-stage reset. Do not
  // uninstall the managed driver/container here.
  if (persistentDriver) {
    return await platform.integrations.remove(record.id);
  }

  // UC Virtual Remote can also represent a driver's default instance directly
  // on the driver record. In that representation, reset the record in place so
  // the installed driver survives and is exposed with has_instances=false.
  const aliases = platform.db.listIntegrations().filter(
    (candidate) => candidate.metadata?.connection_record_id === record.id
  );
  const namespaceIds = new Set([
    String(id),
    String(record.id),
    ...aliases.map((candidate) => String(candidate.id))
  ]);

  await platform.integrations.disconnect(record.id).catch(() => {});

  const configuredEntities = platform.db.listConfiguredEntities().filter(
    (entity) => namespaceIds.has(String(entity.integration_id))
  );
  for (const entity of configuredEntities) {
    await platform.integrations.unconfigureEntity(entity.entity_id || entity.id).catch(() => {});
  }

  for (const activity of platform.db.listActivities().filter(
    (entity) => namespaceIds.has(String(entity.integration_id))
  )) {
    const entityId = activity.id || activity.entity_id;
    if (entityId && platform.db.deleteActivity(entityId)) {
      platform.events.publish("entity.deleted", { id: entityId });
    }
  }

  for (const macro of platform.db.listMacros().filter(
    (entity) => namespaceIds.has(String(entity.integration_id))
  )) {
    const entityId = macro.id || macro.entity_id;
    if (entityId && platform.db.deleteMacro(entityId)) {
      platform.events.publish("entity.deleted", { id: entityId });
    }
  }

  for (const namespaceId of namespaceIds) {
    platform.db.replaceAvailableEntities(namespaceId, []);
  }
  for (const alias of aliases) {
    platform.db.deleteIntegration(alias.id);
  }

  const updated = platform.db.updateIntegration(record.id, {
    configured: false,
    setup_data: {},
    setup_state: "IDLE",
    setup_action: null,
    last_error: null,
    status: "DISCONNECTED",
    device_state: "UNKNOWN"
  });
  if (!updated) return false;

  // The public Core contract describes this as an instance deletion. The
  // driver remains, and the configurator reacts by refreshing both the status
  // and has_instances=false driver lists.
  platform.events.publish("integration.deleted", {
    id: record.id,
    integration_id: String(id),
    driver_id: recordDriverId
  });
  return true;
}

export async function performInstalledIntegrationAction(platform, id, action, input = {}) {
  const record = integrationRecord(platform, id);
  if (!record) throw Object.assign(new Error("Installed integration not found"), { status: 404 });
  const runtimeId = driverId(record);
  const managed = platform.externalIntegrations.managedRecord(runtimeId);
  const native = platform.nativeIntegrations?.managedRecord?.(runtimeId) || null;

  if (action === "start") {
    if (native) await platform.nativeIntegrations.setRunning(runtimeId, true);
    else if (managed) await startManaged(platform, record, managed);
    await platform.integrations.connect(record.id);
  } else if (action === "stop") {
    await platform.integrations.disconnect(record.id).catch(() => {});
    if (native) await platform.nativeIntegrations.setRunning(runtimeId, false);
    else if (managed) await platform.externalIntegrations.setRunning(runtimeId, false);
  } else if (action === "restart") {
    await platform.integrations.disconnect(record.id).catch(() => {});
    if (native) await platform.nativeIntegrations.restart(runtimeId);
    else if (managed) await restartManaged(platform, managed);
    await platform.integrations.connect(record.id);
  } else if (action === "reconnect") {
    await platform.integrations.disconnect(record.id).catch(() => {});
    await platform.integrations.connect(record.id);
  } else if (action === "refresh-entities") {
    await platform.integrations.fetchAvailable(record.id);
  } else if (action === "reconfigure") {
    await platform.integrations.startSetup(record.id, true, input.setup_data || {});
  } else if (action === "reset") {
    if (!await resetIntegrationInstance(platform, id)) {
      throw Object.assign(new Error("Installed integration not found"), { status: 404 });
    }
  } else if (action === "update") {
    if (native) throw Object.assign(new Error("Native custom integrations are updated by uploading a newer tar.gz with Update enabled"), { status: 409 });
    const result = await platform.externalIntegrations.update(runtimeId);
    if (!result) throw Object.assign(new Error("Managed integration update is unavailable"), { status: 404 });
  } else {
    throw Object.assign(new Error(`Unsupported integration action ${action}`), { status: 400 });
  }

  return { code: "OK", action, integration_id: record.id };
}

export async function removeInstalledIntegration(platform, id) {
  const record = integrationRecord(platform, id);
  if (!record) return false;
  const managedDriverId = driverId(record);
  await platform.integrations.remove(record.id);
  await platform.nativeIntegrations?.remove?.(managedDriverId).catch(() => false);
  await platform.externalIntegrations.remove(managedDriverId).catch(() => false);
  return true;
}

async function handle(request, response, url, httpServer, platform) {
  if (!authenticated(request, url, httpServer, platform)) return json(response, 401, { error: "Unauthorized" });
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const matched = route(pathname);
  if (!matched) return json(response, 404, { error: "Not found" });

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, API-KEY, Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS"
    });
    return response.end();
  }

  if (matched.root && request.method === "GET") {
    return json(response, 200, { integrations: await installedIntegrationItems(platform) });
  }
  if (matched.id && !matched.action && request.method === "GET") {
    const item = (await installedIntegrationItems(platform)).find((candidate) => String(candidate.id) === String(matched.id));
    return item ? json(response, 200, item) : json(response, 404, { error: "Installed integration not found" });
  }
  if (matched.id && matched.action && request.method === "POST") {
    const input = await requestBody(request);
    return json(response, 200, await performInstalledIntegrationAction(platform, matched.id, matched.action, input));
  }
  if (matched.id && !matched.action && request.method === "DELETE") {
    return await removeInstalledIntegration(platform, matched.id)
      ? noContent(response)
      : json(response, 404, { error: "Installed integration not found" });
  }

  response.setHeader("Allow", matched.root ? "GET,OPTIONS" : matched.action ? "POST,OPTIONS" : "GET,DELETE,OPTIONS");
  return json(response, 405, { error: "Method not allowed" });
}

export function attachInstalledIntegrationManagement(httpServer, platform) {
  const server = httpServer?.server;
  if (!server || server[ATTACHED]) return;
  const originalListeners = server.listeners("request");
  if (!originalListeners.length) throw new Error("Platform HTTP server request listener is unavailable");

  server.removeAllListeners("request");
  server.on("request", function installedIntegrationManagementRequest(request, response) {
    const url = new URL(request.url, "http://localhost");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const coreDeleteId = request.method === "DELETE" ? coreInstanceDeleteId(pathname) : null;

    if (coreDeleteId) {
      const started = process.hrtime.bigint();
      response.once("finish", () => {
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
        log.info(`${request.method} ${pathname} ${response.statusCode} ${elapsedMs.toFixed(1)}ms`);
      });
      if (!coreAuthenticated(request, url, httpServer, platform)) {
        json(response, 401, { code: "AUTH_FAILED", message: "Unauthorized" });
        return;
      }
      resetIntegrationInstance(platform, coreDeleteId).then((reset) => {
        if (reset) json(response, 200, { code: "OK" });
        else json(response, 404, { code: "NOT_FOUND", message: "Integration instance not found" });
      }).catch((error) => {
        log.warn(`${request.method} ${pathname}:`, error.message);
        if (!response.headersSent) json(response, error.status || 500, { code: "ERROR", error: error.message, message: error.message });
        else response.end();
      });
      return;
    }

    if (pathname !== ROUTE_ROOT && !pathname.startsWith(`${ROUTE_ROOT}/`)) {
      for (const listener of originalListeners) listener.call(server, request, response);
      return;
    }

    const started = process.hrtime.bigint();
    response.once("finish", () => {
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      log.info(`${request.method} ${pathname} ${response.statusCode} ${elapsedMs.toFixed(1)}ms`);
    });
    handle(request, response, url, httpServer, platform).catch((error) => {
      log.warn(`${request.method} ${pathname}:`, error.message);
      if (!response.headersSent) json(response, error.status || 500, { error: error.message, message: error.message });
      else response.end();
    });
  });
  Object.defineProperty(server, ATTACHED, { value: true });
}
