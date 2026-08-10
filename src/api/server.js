import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { displayName, localEntityId, parseJson, sha256, slug } from "../shared/util.js";
import { RESOURCE_RULES, decodeDataUrl, extensionForMime, mimeFromFilename, normalizeResourceId, resourceIdFromFilename, validateResource } from "../resources.js";
import { CORE_SERVICE, formatLogRecords, logBoots, logger, logServices, queryLogRecords, queryLogs } from "../shared/logger.js";
import { CoreWebSocketFacade } from "../core/websocket-facade.js";
import { acceptWebSocketUpgrade, rejectWebSocketUpgrade } from "../protocol/websocket.js";
import { convertIrCode } from "../core/ir-converter.js";
import { buttonLayout, entityCommandMetadata, iconMapping, normalizeButtonMappings, screenLayout } from "../core/device-metadata.js";
import { normalizeActivityAction } from "../engine/activity-command.js";
import {
  availableEntity, coreEntity, coreGroup, corePage, coreProfile,
  integrationDriver, integrationInstance, integrationStatus, isInternalIntegration, pageSlice, uniqueDrivers, visibleIntegrations
} from "../core/models.js";

const log = logger("http-server");
const MAX_BODY = 8 * 1024 * 1024;
const MAX_CONFIGURATOR_ARCHIVE = 128 * 1024 * 1024;

function json(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(body);
}

function noContent(response, status = 204) {
  response.writeHead(status, { "Cache-Control": "no-store" });
  response.end();
}

function text(response, status, payload, contentType = "text/plain; charset=utf-8", headers = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  response.writeHead(status, { "Content-Type": contentType, "Content-Length": String(body.length), "Cache-Control": "no-store", ...headers });
  response.end(body);
}

function binary(response, item, cache = false) {
  if (!item || !fs.existsSync(item.path)) return json(response, 404, { error: "Resource not found" });
  const stat = fs.statSync(item.path);
  response.writeHead(200, {
    "Content-Type": item.mime_type || "application/octet-stream",
    "Content-Length": String(stat.size),
    "Cache-Control": cache ? "public, max-age=31536000, immutable" : "no-store",
    "Content-Disposition": `inline; filename="${String(item.filename || item.id).replace(/"/g, "")}"`
  });
  fs.createReadStream(item.path).pipe(response);
}

function fileDownload(response, filename, downloadName, contentType = "application/octet-stream") {
  if (!filename || !fs.existsSync(filename)) return json(response, 404, { error: "Log file not found" });
  const stat = fs.statSync(filename);
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": String(stat.size),
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="${String(downloadName || path.basename(filename)).replace(/["\r\n]/g, "")}"`
  });
  fs.createReadStream(filename).pipe(response);
}

function paginationInput(url) {
  return { page: Number(url.searchParams.get("page") || 1), limit: Number(url.searchParams.get("limit") || 100) };
}

function paginated(response, items, url, status = 200) {
  const page = pageSlice(items, paginationInput(url));
  return json(response, status, page.items, {
    "Pagination-Count": String(page.paging.count),
    "Pagination-Limit": String(page.paging.limit),
    "Pagination-Page": String(page.paging.page)
  });
}

function paginatedHead(response, items, url) {
  const page = pageSlice(items, paginationInput(url));
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Pagination-Count": String(page.paging.count),
    "Pagination-Limit": String(page.paging.limit),
    "Pagination-Page": String(page.paging.page)
  });
  response.end();
}

async function rawBody(request, maximum = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function body(request) {
  const data = await rawBody(request);
  if (!data.length) return {};
  const value = parseJson(data.toString("utf8"), undefined);
  if (value === undefined) throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  return value;
}

async function multipartFiles(request, maximum = MAX_BODY) {
  const contentType = String(request.headers["content-type"] || "");
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw Object.assign(new Error("Missing multipart boundary"), { status: 400 });
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const data = await rawBody(request, maximum);
  const files = [];
  let cursor = 0;
  while (cursor < data.length) {
    const start = data.indexOf(boundary, cursor);
    if (start < 0) break;
    const headerStart = start + boundary.length + 2;
    const headerEnd = data.indexOf(Buffer.from("\r\n\r\n"), headerStart);
    if (headerEnd < 0) break;
    const headers = data.subarray(headerStart, headerEnd).toString("utf8");
    const dispositionLine = headers.match(/content-disposition:\s*form-data;([^\r\n]*)/i)?.[1] || "";
    const fieldName = dispositionLine.match(/(?:^|;)\s*name="([^"]+)"/i)?.[1];
    const originalFilename = dispositionLine.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1];
    const next = data.indexOf(boundary, headerEnd + 4);
    if (next < 0) break;
    if (fieldName && originalFilename) {
      const mimeMatch = headers.match(/content-type:\s*([^\r\n]+)/i);
      const end = Math.max(headerEnd + 4, next - 2);
      files.push({
        field: fieldName,
        filename: path.basename(originalFilename),
        mimeType: String(mimeMatch?.[1] || mimeFromFilename(originalFilename)).trim().toLowerCase(),
        buffer: data.subarray(headerEnd + 4, end)
      });
    }
    cursor = next;
  }
  if (!files.length) throw Object.assign(new Error("No file found in multipart request"), { status: 400 });
  return files;
}

async function multipartFile(request, maximum = MAX_BODY) {
  return (await multipartFiles(request, maximum))[0];
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

function ok(response, payload = {}) {
  return json(response, 200, { code: "OK", ...payload });
}

function decodeBasic(header) {
  if (!String(header || "").startsWith("Basic ")) return null;
  try {
    const [username, password] = Buffer.from(String(header).slice(6), "base64").toString("utf8").split(":");
    return { username, password };
  } catch { return null; }
}

function internalResourceType(type) {
  const value = String(type || "");
  if (value === "Icon" || value.toLowerCase() === "icon") return "icon";
  if (value === "BackgroundImage" || ["background", "backgroundimage"].includes(value.toLowerCase())) return "background";
  return value;
}

function officialResourceType(type) {
  return internalResourceType(type) === "background" ? "BackgroundImage" : "Icon";
}

function managedUpdateMetadata(item) {
  if (!item) return {};
  return {
    registry_managed: true,
    update_supported: Boolean(item.update_supported),
    update_available: Boolean(item.update_available),
    current_version: item.current_version,
    installed_ref: item.installed_ref,
    available_version: item.available_version,
    available_ref: item.available_ref,
    update_checked_at: item.checked_at,
    check_error: item.check_error
  };
}

function integrationSetupInfo(record) {
  if (!record) return null;
  return {
    id: record.driver_id || record.metadata?.driver_id || record.id,
    state: record.setup_state || "IDLE",
    ...(record.last_error ? { error: record.last_error } : {}),
    ...(record.setup_action ? { require_user_action: record.setup_action } : {})
  };
}

function match(pathname, pattern) {
  const names = [];
  const source = pattern.replace(/:[^/]+/g, (value) => {
    names.push(value.slice(1));
    return "([^/]+)";
  });
  const result = pathname.match(new RegExp(`^${source}$`));
  if (!result) return null;
  return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(result[index + 1])]));
}

function mime(filename) {
  const extension = path.extname(filename).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[extension] || "application/octet-stream";
}

export class PlatformHttpServer {
  constructor(platform, publicDir) {
    this.platform = platform;
    this.publicDir = publicDir;
    this.sessions = new Map();
    this.coreWs = new CoreWebSocketFacade(platform);
    this.sockets = new Set();
    this.server = http.createServer((request, response) => this.#request(request, response));
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.once("close", () => this.sockets.delete(socket));
    });
    this.server.on("upgrade", (request, socket, head) => this.#upgrade(request, socket, head));
  }

  async listen() {
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.platform.restPort, this.platform.host, resolve);
    });
    log.info(`REST API and web UI listening on http://${this.platform.host}:${this.platform.restPort}`);
  }

  async close(options = {}) {
    this.coreWs.close();
    if (!this.server.listening && this.sockets.size === 0) return;
    const gracePeriodMs = Math.max(50, Number(options.gracePeriodMs ?? process.env.UCVR_SHUTDOWN_GRACE_MS ?? 1000));
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceTimer);
        resolve();
      };
      const forceTimer = setTimeout(() => {
        if (this.sockets.size) log.warn(`Forcing ${this.sockets.size} remaining HTTP connection(s) closed`);
        try { this.server.closeAllConnections?.(); } catch {}
        for (const socket of this.sockets) socket.destroy();
        finish();
      }, gracePeriodMs);
      try {
        this.server.close(finish);
        this.server.closeIdleConnections?.();
      } catch {
        for (const socket of this.sockets) socket.destroy();
        finish();
      }
    });
  }

  #authenticated(request, allowManagement = false) {
    const session = cookies(request).ucvr_session;
    if (session && this.sessions.has(session)) return true;
    if (allowManagement && !this.platform.adminToken) return true;
    const authorization = String(request.headers.authorization || "");
    const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
    const queryToken = new URL(request.url, "http://localhost").searchParams.get("token");
    const key = request.headers["api-key"] || bearer || queryToken;
    if (this.platform.adminToken && key === this.platform.adminToken) return true;
    return Boolean(key && this.platform.db.findApiKey(sha256(key)));
  }

  #coreApiAuthenticated(request) {
    if (this.#authenticated(request, false)) return true;
    const credentials = decodeBasic(request.headers.authorization);
    return Boolean(
      credentials
      && credentials.username === "web-configurator"
      && credentials.password === this.platform.pin
    );
  }

  #managementApiRequest(request) {
    const authorization = String(request.headers.authorization || "");
    const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
    const queryToken = new URL(request.url, "http://localhost").searchParams.get("token");
    const key = request.headers["api-key"] || bearer || queryToken;
    if (this.platform.adminToken) return key === this.platform.adminToken;
    return !key;
  }

  #sessionAuthenticated(request) {
    const token = cookies(request).ucvr_session;
    return Boolean(token && this.sessions.has(token));
  }

  #officialRequest(request) {
    return this.#sessionAuthenticated(request);
  }

  #upgrade(request, socket, head) {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname !== "/ws") return rejectWebSocketUpgrade(socket, 404, "Not Found");
    const peer = acceptWebSocketUpgrade(request, socket, head);
    if (!peer) return;
    const authorization = String(request.headers.authorization || "");
    const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
    const token = request.headers["api-key"] || bearer || url.searchParams.get("token") || null;
    this.coreWs.attach(peer, { token, authenticated: this.#sessionAuthenticated(request) });
  }

  async #webConfiguratorLogin(request, response) {
    const input = await body(request);
    if (input.username !== "web-configurator" || String(input.password || "") !== this.platform.pin) {
      return json(response, 401, { code: "AUTH_FAILED", message: "Invalid Web Configurator PIN" });
    }
    const token = crypto.randomBytes(32).toString("base64url");
    this.sessions.set(token, { created_at: Date.now() });
    return json(response, 200, { code: "OK" }, {
      "Set-Cookie": `ucvr_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`
    });
  }

  #webConfiguratorLogout(request, response) {
    const token = cookies(request).ucvr_session;
    if (token) this.sessions.delete(token);
    return json(response, 200, { code: "OK" }, {
      "Set-Cookie": "ucvr_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
    });
  }

  async #request(request, response) {
    const started = process.hrtime.bigint();
    const url = new URL(request.url, "http://localhost");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    response.once("finish", () => {
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      const message = `${request.method} ${pathname} ${response.statusCode} ${elapsedMs.toFixed(1)}ms`;
      if (["/health", "/pub/health_check", "/pub/status"].includes(pathname)) log.debug(message);
      else log.info(message);
    });
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Authorization, API-KEY, Content-Type",
          "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS"
        });
        return response.end();
      }

      if (pathname === "/api/pub/login" && request.method === "POST") return this.#webConfiguratorLogin(request, response);
      if (pathname === "/api/pub/logout" && request.method === "POST") return this.#webConfiguratorLogout(request, response);

      if (url.pathname === this.platform.webConfigurator.sourceRoute && request.method === "GET") {
        return fileDownload(
          response,
          this.platform.webConfigurator.sourceArchive,
          path.basename(this.platform.webConfigurator.sourceArchive),
          "application/gzip"
        );
      }

      if (url.pathname === "/configurator") {
        response.writeHead(302, { Location: "/configurator/", "Cache-Control": "no-store" });
        return response.end();
      }
      if (url.pathname.startsWith("/configurator/")) {
        return this.#webConfiguratorStatic(response, url.pathname);
      }

      if (pathname === "/api/system/install/web_configurator") {
        if (!this.#coreApiAuthenticated(request) && !this.#authenticated(request, true)) return json(response, 401, { code: "AUTH_REQUIRED", message: "Unauthorized" });
        if (request.method === "GET") {
          const status = this.platform.webConfigurator.status();
          return json(response, 200, {
            ...status,
            active: status.installed,
            release: status.installed ? {
              name: { en: "Unfolded.Tools community Web Configurator" },
              version: status.version,
              source: status.source,
              upstream_version: status.upstream_version
            } : null
          });
        }
        response.setHeader("Allow", "GET");
        return json(response, 405, {
          code: "IMMUTABLE_COMPONENT",
          message: "The source-built community Web Configurator is bundled with UC Virtual Remote and cannot be uploaded, replaced, or removed at runtime."
        });
      }

      let artwork = match(pathname, "/media/artwork/:id");
      if (artwork && request.method === "GET") {
        const item = await this.platform.media.resolveArtwork(artwork.id);
        return binary(response, item, true);
      }
      let mediaResource = match(pathname, "/media/resource/:id");
      if (mediaResource && request.method === "GET") {
        const item = await this.platform.media.resolveArtwork(mediaResource.id);
        return binary(response, item, true);
      }

      let publicResource = match(pathname, "/api/resources/:type/:id/content");
      if (publicResource && request.method === "GET") return binary(response, this.platform.db.getResource(publicResource.type, publicResource.id), true);

      if (["/health", "/pub/health_check"].includes(pathname)) return json(response, 200, { status: "OK" });
      if (pathname === "/pub/status") return json(response, 200, this.platform.status());
      if (pathname === "/pub/version" || pathname === "/api/pub/version") return json(response, 200, {
        device_name: this.platform.name,
        hostname: this.platform.hostname,
        address: this.platform.id,
        api: this.platform.restCoreApiVersion,
        core: this.platform.version,
        ui: this.platform.remoteUiCompatibilityVersion,
        os: `Node.js ${process.version}`,
        integrations: Object.fromEntries(visibleIntegrations(this.platform.db.listIntegrations()).map((item) => [item.name, item.driver_version || "unknown"])),
        model: "UCR3",
        name: this.platform.name
      });
      if (pathname === "/pub/login" && request.method === "POST") {
        const credentials = decodeBasic(request.headers.authorization);
        if (!credentials || credentials.password !== this.platform.pin) return json(response, 401, { error: "Invalid credentials" });
        return this.#createApiKey(request, response, true);
      }
      if (pathname === "/pub/logout" && request.method === "POST") return noContent(response);

      if (["/api/auth/api_keys", "/auth/api_keys"].includes(pathname) && request.method === "POST") return this.#createApiKey(request, response);

      // The External Integration Installer and the official Core REST API use
      // /api/intg/drivers. Internally the compatibility facade is implemented at
      // /intg/drivers, so expose an authenticated alias instead of duplicating
      // driver registration logic.
      if (pathname === "/api/intg/drivers" || pathname.startsWith("/api/intg/drivers/")) {
        if (!this.#coreApiAuthenticated(request)) {
          return json(response, 401, { error: "Unauthorized" }, { "WWW-Authenticate": 'Basic realm="Virtual Remote"' });
        }
        return await this.#compatibility(request, response, pathname.slice(4), url);
      }

      // The built-in management UI must remain isolated from the official
      // configurator session cookie. Otherwise /api/* requests are interpreted
      // as official Core API requests after the user logs into /configurator/.
      if (pathname === "/management/events" && request.method === "GET") {
        if (!this.#authenticated(request, true)) return json(response, 401, { error: "Unauthorized" });
        return this.#events(request, response);
      }
      if (pathname.startsWith("/management/")) {
        if (!this.#authenticated(request, true)) return json(response, 401, { error: "Unauthorized" });
        return await this.#management(request, response, `/api/${pathname.slice("/management/".length)}`, url);
      }

      if (pathname.startsWith("/api/") && this.#officialRequest(request)) {
        if (!this.#sessionAuthenticated(request)) return json(response, 401, { code: "AUTH_REQUIRED", message: "Authentication required" });
        return await this.#compatibility(request, response, pathname.slice(4), url);
      }

      // API-key clients such as UC Remote Sync use the documented /api prefix
      // for the Core REST API. Route Core resource namespaces through the full
      // compatibility facade while leaving the management-only namespaces below.
      const coreApiPath = pathname.startsWith("/api/") ? pathname.slice(4) : null;
      if (coreApiPath && [
        "/auth", "/intg", "/entities", "/activities", "/macros", "/profiles",
        "/activity_groups", "/remotes", "/docks", "/resources", "/cfg", "/system", "/ir"
      ].some((prefix) => coreApiPath === prefix || coreApiPath.startsWith(`${prefix}/`))) {
        // /api/resources predates the Core compatibility facade and is also used
        // by the local management UI. Keep management-token/open-local requests
        // on that API while database API keys (including UC Remote Sync) receive
        // the official Core resource contract.
        if (coreApiPath === "/resources" || coreApiPath.startsWith("/resources/")) {
          if (this.#managementApiRequest(request)) return await this.#management(request, response, pathname, url);
        }
        if (!this.#coreApiAuthenticated(request)) return json(response, 401, { error: "Unauthorized" });
        return await this.#compatibility(request, response, coreApiPath, url);
      }

      if (pathname === "/api/events" && request.method === "GET") {
        if (!this.#authenticated(request, true)) return json(response, 401, { error: "Unauthorized" });
        return this.#events(request, response);
      }

      if (pathname.startsWith("/api/")) {
        if (!this.#authenticated(request, true)) return json(response, 401, { error: "Unauthorized" });
        return await this.#management(request, response, pathname, url);
      }

      if (["/auth", "/intg", "/entities", "/activities", "/macros", "/profiles", "/activity_groups", "/remotes", "/docks", "/resources", "/cfg", "/system", "/ir"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
        if (!this.#authenticated(request, false)) return json(response, 401, { error: "Unauthorized" });
        return await this.#compatibility(request, response, pathname, url);
      }

      return this.#static(response, pathname);
    } catch (error) {
      log.warn(`${request.method} ${pathname}:`, error.message);
      if (!response.headersSent) json(response, error.status || 500, {
        code: error.code || (error.status === 502 ? "BAD_GATEWAY" : "INTERNAL_ERROR"),
        message: error.message,
        error: error.message
      });
      else response.end();
    }
  }

  async #createApiKey(request, response, login = false) {
    const credentials = decodeBasic(request.headers.authorization);
    if (!credentials || (!login && credentials.username !== "web-configurator") || credentials.password !== this.platform.pin) {
      return json(response, 401, { error: "Invalid Web Configurator PIN" }, { "WWW-Authenticate": 'Basic realm="Virtual Remote"' });
    }
    const input = await body(request);
    const apiKey = crypto.randomBytes(32).toString("base64url");
    const record = this.platform.db.createApiKey(input.name || "API key", sha256(apiKey), input.scopes || ["admin"], input);
    return json(response, 201, { ...record, api_key: apiKey, active: true });
  }

  #simulatorSettings() {
    return {
      accent: "#769990",
      battery_level: 82,
      charging: false,
      wifi_state: "CONNECTED",
      show_hardware: true,
      haptic: true,
      show_battery_percentage: true,
      device_model: "remote3",
      touch_slider_mode: "auto",
      ...this.platform.db.getSetting("simulator", {})
    };
  }

  #events(request, response) {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    response.write(`event: ready\ndata: ${JSON.stringify(this.platform.status())}\n\n`);
    const listener = (event) => {
      response.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };
    this.platform.events.on("event", listener);
    const keepAlive = setInterval(() => response.write(": keepalive\n\n"), 20_000);
    request.on("close", () => {
      clearInterval(keepAlive);
      this.platform.events.off("event", listener);
    });
  }

  async #management(request, response, pathname, url) {
    if (pathname === "/api/status" && request.method === "GET") return json(response, 200, this.platform.status());
    if (pathname === "/api/hardware" && request.method === "GET") {
      const hardware = await this.platform.hardware.status(url.searchParams.get("refresh") === "true");
      const [wifiConnection, bluetoothPairing] = await Promise.all([
        this.platform.hardware.wifiStatus().catch(() => ({ wpa_state: "UNKNOWN", ssid: null, address: null, ip_address: null, adapter: hardware.selection?.wifi_adapter || null })),
        this.platform.hardware.pairedBluetoothDevices().catch(() => ({ adapter: null, address: hardware.selection?.bluetooth_adapter || null, devices: [] }))
      ]);
      return json(response, 200, { ...hardware, current: { wifi: wifiConnection, bluetooth: bluetoothPairing } });
    }
    if (pathname === "/api/hardware" && ["PUT", "PATCH"].includes(request.method)) return json(response, 200, await this.platform.hardware.setSelection(await body(request)));
    if (pathname === "/api/hardware/bluetooth/power" && request.method === "POST") {
      const input = await body(request);
      return json(response, 200, await this.platform.hardware.setBluetoothPower(input.enabled !== false));
    }
    if (pathname === "/api/hardware/wifi/networks" && request.method === "GET") return json(response, 200, await this.platform.hardware.scanWifi());
    if (pathname === "/api/hardware/wifi/connect" && request.method === "POST") return json(response, 200, await this.platform.hardware.connectWifi(await body(request)));

    if (pathname === "/api/integration-sources" && request.method === "GET") {
      let entries = null;
      if (url.searchParams.get("refresh") === "true") entries = (await this.platform.externalIntegrations.fetchRegistry(true)).integrations.length;
      return json(response, 200, { ...this.platform.externalIntegrations.sourceSettings(), ...(entries === null ? {} : { entries }) });
    }
    if (pathname === "/api/integration-sources" && ["PUT", "PATCH"].includes(request.method)) {
      const input = await body(request);
      return json(response, 200, await this.platform.externalIntegrations.setRegistryUrls(input.registries || input.registry_urls || []));
    }
    if (pathname === "/api/integration-sources/jobs" && request.method === "GET") {
      return json(response, 200, this.platform.externalIntegrations.setupJobs());
    }
    if (pathname === "/api/integration-sources/ghcr" && request.method === "POST") {
      const input = await body(request);
      const entry = await this.platform.externalIntegrations.addGhcrIntegration(input);
      let job = null;
      if (input.pull !== false) {
        job = await this.platform.externalIntegrations.startSetup(entry.driver_id, {
          input_values: { ucvr_install_source: "image", ucvr_install_version: entry.version || "latest" }
        });
      }
      return json(response, 201, { entry, job });
    }
    let integrationSource = match(pathname, "/api/integration-sources/ghcr/:id");
    if (integrationSource && request.method === "DELETE") {
      return this.platform.externalIntegrations.removeGhcrIntegration(integrationSource.id)
        ? noContent(response)
        : json(response, 404, { error: "Custom GHCR integration not found" });
    }
    integrationSource = match(pathname, "/api/integration-sources/ghcr/:id/pull");
    if (integrationSource && request.method === "POST") {
      const entry = await this.platform.externalIntegrations.findEntry(integrationSource.id);
      if (!entry?.custom_image) return json(response, 404, { error: "Custom GHCR integration not found" });
      return json(response, 201, await this.platform.externalIntegrations.startSetup(entry.driver_id, {
        input_values: { ucvr_install_source: "image", ucvr_install_version: entry.version || "latest" }
      }));
    }

    if (pathname === "/api/logs/sources" && request.method === "GET") {
      const [hardware, hci] = await Promise.all([
        this.platform.hardware.status(false),
        this.platform.hardware.hciLogStatus()
      ]);
      const services = this.platform.externalIntegrations.services();
      return json(response, 200, {
        sources: [
          { id: "core", type: "core", name: "Virtual Remote Core" },
          { id: "wifi", type: "wifi", name: "Wi-Fi adapter", adapter: hardware.selection?.wifi_adapter || null },
          { id: "bluetooth-hci", type: "bluetooth-hci", name: "Bluetooth HCI", ...hci },
          ...services.map((item) => ({ id: `integration:${item.service}`, type: "integration", name: item.name || item.service, service: item.service }))
        ],
        hci
      });
    }
    if (pathname === "/api/logs/hci" && request.method === "POST") {
      const input = await body(request);
      const state = await this.platform.hardware.setHciLogging(input.enabled !== false);
      return json(response, 200, { ...state, ...(await this.platform.hardware.hciLogStatus()) });
    }
    if (pathname === "/api/logs/hci/raw" && request.method === "GET") {
      const status = await this.platform.hardware.hciLogStatus();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      return fileDownload(response, status.path, `bluetooth-hci-${stamp}.btsnoop`, "application/vnd.bluetooth.btsnoop");
    }
    if (pathname === "/api/logs" && request.method === "GET") {
      const source = String(url.searchParams.get("source") || "core");
      const limit = Math.max(1, Math.min(10000, Number(url.searchParams.get("limit") || 1000)));
      let output = "";
      let label = source;
      if (source === "core") {
        const records = queryLogRecords({ limit: 10000 }).filter((item) => item.service === CORE_SERVICE).slice(-limit);
        output = formatLogRecords(records);
        label = "virtual-remote-core";
      } else if (source === "wifi") {
        const records = queryLogRecords({ limit: 10000 }).filter((item) => item.scope === "host-hardware").slice(-Math.min(limit, 1000));
        const diagnostics = await this.platform.hardware.wifiLogText({ limit });
        output = `${formatLogRecords(records).trim()}\n\n${diagnostics}\n`.trimStart();
        label = "wifi-adapter";
      } else if (source === "bluetooth-hci") {
        output = `${await this.platform.hardware.hciLogText({ limit })}\n`;
        label = "bluetooth-hci";
      } else if (source.startsWith("integration:")) {
        const service = source.slice("integration:".length);
        const available = this.platform.externalIntegrations.services().find((item) => item.service === service);
        if (!available) return json(response, 404, { error: "Integration log source not found" });
        const records = await this.platform.externalIntegrations.logRecords({ s: service, limit });
        output = formatLogRecords(records.slice(-limit));
        label = service;
      } else {
        return json(response, 404, { error: "Log source not found" });
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const headers = ["1", "true", "yes"].includes(String(url.searchParams.get("download") || "").toLowerCase())
        ? { "Content-Disposition": `attachment; filename="${slug(label, "logs")}-${stamp}.txt"` }
        : {};
      return text(response, 200, output || "No log entries are available.\n", "text/plain; charset=utf-8", headers);
    }

    if (pathname === "/api/system/update" && request.method === "GET") {
      return json(response, 200, await this.platform.systemUpdate.check(url.searchParams.get("force") === "true"));
    }
    let managementUpdate = match(pathname, "/api/system/update/:id/progress");
    if (managementUpdate && request.method === "GET") {
      const progress = this.platform.systemUpdate.progress(managementUpdate.id);
      return progress ? json(response, 200, progress) : json(response, 404, { error: "Software update progress not found" });
    }
    managementUpdate = match(pathname, "/api/system/update/:id");
    if (managementUpdate && request.method === "POST") {
      return json(response, 201, await this.platform.systemUpdate.action(managementUpdate.id));
    }

    if (pathname === "/api/simulator" && request.method === "GET") {
      return json(response, 200, this.#simulatorSettings());
    }
    if (pathname === "/api/simulator" && ["PUT", "PATCH"].includes(request.method)) {
      const current = this.#simulatorSettings();
      const input = await body(request);
      const value = {
        ...current,
        ...input,
        accent: /^#[0-9a-f]{6}$/i.test(String(input.accent || current.accent)) ? String(input.accent || current.accent) : current.accent,
        battery_level: Math.max(0, Math.min(100, Number(input.battery_level ?? current.battery_level))),
        charging: Boolean(input.charging ?? current.charging),
        show_hardware: Boolean(input.show_hardware ?? current.show_hardware),
        haptic: Boolean(input.haptic ?? current.haptic),
        show_battery_percentage: Boolean(input.show_battery_percentage ?? current.show_battery_percentage),
        device_model: ["remote2", "remote3"].includes(String(input.device_model || current.device_model)) ? String(input.device_model || current.device_model) : current.device_model,
        touch_slider_mode: ["auto", "volume", "pages"].includes(String(input.touch_slider_mode || current.touch_slider_mode)) ? String(input.touch_slider_mode || current.touch_slider_mode) : current.touch_slider_mode
      };
      this.platform.db.setSetting("simulator", value);
      this.platform.events.publish("simulator.change", value);
      return json(response, 200, value);
    }

    if ((pathname === "/api/intg" || pathname === "/api/intg/instances") && request.method === "GET") {
      return json(response, 200, visibleIntegrations(this.platform.db.listIntegrations()).filter((item) => item.configured !== false).map((item) => ({
        id: item.id,
        integration_id: item.id,
        name: item.name,
        state: item.status,
        device_state: item.device_state,
        driver_state: item.setup_state,
        driver_id: item.metadata?.driver_id || item.id,
        version: item.driver_version
      })));
    }
    let coreParams = match(pathname, "/api/intg/instances/:integration/entities/:entity");
    if (!coreParams) coreParams = match(pathname, "/api/intg/:integration/entities/:entity");
    if (coreParams && request.method === "POST") {
      return json(response, 201, await this.platform.integrations.configureEntity(
        coreParams.integration,
        localEntityId(coreParams.integration, coreParams.entity),
        await body(request)
      ));
    }
    if (["/api/activity_groups", "/api/remotes", "/api/docks"].includes(pathname) && request.method === "GET") return json(response, 200, []);
    if (pathname === "/api/resources" && request.method === "GET") return json(response, 200, {
      types: Object.entries(RESOURCE_RULES).map(([type, rules]) => ({ type, ...rules })),
      items: this.platform.db.listResources()
    });
    let params = match(pathname, "/api/resources/:type");
    if (params && request.method === "GET") return json(response, 200, this.platform.db.listResources(params.type));
    if (params && request.method === "DELETE") return json(response, 200, { deleted: this.platform.db.deleteResources(params.type) });
    if (params && request.method === "POST") {
      const input = await body(request);
      const decoded = decodeDataUrl(input.data_url);
      const filename = normalizeResourceId(input.filename || `resource${extensionForMime(decoded.mimeType)}`);
      const id = normalizeResourceId(input.id || filename);
      const metadata = validateResource(params.type, decoded.buffer, decoded.mimeType);
      const record = this.platform.db.saveResource({ type: params.type, id, filename: id, mime_type: decoded.mimeType, metadata, data: decoded.buffer });
      this.platform.events.publish("resource.change", record);
      return json(response, 201, record);
    }
    params = match(pathname, "/api/resources/:type/:id");
    if (params && request.method === "DELETE") {
      const deleted = this.platform.db.deleteResource(params.type, params.id);
      if (!deleted) return json(response, 404, { error: "Resource not found" });
      this.platform.events.publish("resource.change", { type: params.type, id: params.id, deleted: true });
      return noContent(response);
    }

    if (pathname === "/api/api-keys" && request.method === "GET") return json(response, 200, this.platform.db.listApiKeys());
    params = match(pathname, "/api/api-keys/:id");
    if (params && request.method === "DELETE") return noContent(response, this.platform.db.deleteApiKey(params.id) ? 204 : 404);

    if (pathname === "/api/integrations" && request.method === "GET") return json(response, 200, visibleIntegrations(this.platform.db.listIntegrations()));
    if (pathname === "/api/integrations" && request.method === "POST") return json(response, 201, await this.platform.integrations.register(await body(request)));
    if (pathname === "/api/integrations/discover" && request.method === "POST") {
      const input = await body(request);
      return json(response, 200, await this.platform.integrations.discover(Number(input.timeout_ms || 2500)));
    }
    params = match(pathname, "/api/integrations/:id");
    if (params && request.method === "GET") { const item = this.platform.db.getIntegration(params.id); return json(response, 200, item && !isInternalIntegration(item) ? item : { error: "Not found" }); }
    if (params && request.method === "PATCH") {
      const existing = this.platform.db.getIntegration(params.id);
      if (!existing || isInternalIntegration(existing)) return json(response, 404, { error: "Not found" });
      const updated = this.platform.db.updateIntegration(params.id, await body(request));
      return json(response, 200, updated);
    }
    if (params && request.method === "DELETE") {
      const existing = this.platform.db.getIntegration(params.id);
      if (!existing || isInternalIntegration(existing)) return noContent(response, 404);
      return noContent(response, await this.platform.integrations.remove(params.id) ? 204 : 404);
    }
    for (const action of ["connect", "disconnect", "fetch-entities", "setup", "setup-input", "setup-abort"]) {
      params = match(pathname, `/api/integrations/:id/${action}`);
      if (!params || request.method !== "POST") continue;
      const input = await body(request);
      const result = action === "connect" ? await this.platform.integrations.connect(params.id)
        : action === "disconnect" ? await this.platform.integrations.disconnect(params.id)
          : action === "fetch-entities" ? await this.platform.integrations.fetchAvailable(params.id)
            : action === "setup" ? await this.platform.integrations.startSetup(params.id, input.reconfigure, input.setup_data || {})
              : action === "setup-input" ? await this.platform.integrations.submitSetup(params.id, input)
                : await this.platform.integrations.abortSetup(params.id);
      return json(response, 200, result);
    }

    if (pathname === "/api/entities/available" && request.method === "GET") {
      return json(response, 200, this.platform.db.listAvailableEntities(url.searchParams.get("integration_id")));
    }
    if (pathname === "/api/entities" && ["GET", "HEAD"].includes(request.method)) {
      let items = [
        ...this.platform.db.listConfiguredEntities(),
        ...this.platform.db.listActivities(),
        ...this.platform.db.listMacros()
      ];
      const typeFilter = String(url.searchParams.get("entity_types") || url.searchParams.get("entity_type") || "")
        .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
      const integrationFilter = String(url.searchParams.get("intg_ids") || url.searchParams.get("intg_id") || "")
        .split(",").map((value) => value.trim()).filter(Boolean);
      const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
      if (typeFilter.length) items = items.filter((item) => typeFilter.includes(String(item.entity_type || "").toLowerCase()));
      if (integrationFilter.length) items = items.filter((item) => integrationFilter.includes(String(item.integration_id || "")));
      if (query) {
        items = items.filter((item) => {
          const integration = item.integration || this.platform.db.getIntegration?.(item.integration_id);
          const haystack = [
            item.entity_id,
            item.id,
            displayName(item.name, item.display_name || ""),
            item.display_name,
            item.integration_id,
            displayName(integration?.name || integration?.metadata?.name, "")
          ].map((value) => String(value || "").toLowerCase()).join(" ");
          return haystack.includes(query);
        });
      }
      return request.method === "HEAD" ? paginatedHead(response, items, url) : paginated(response, items, url);
    }
    if (pathname === "/api/entities" && request.method === "POST") {
      const input = await body(request);
      return json(response, 201, await this.platform.integrations.configureEntity(input.integration_id, input.local_id, input.overrides || {}));
    }
    params = match(pathname, "/api/entities/:id/command");
    if (params && ["POST", "PUT"].includes(request.method)) {
      const input = await body(request);
      const commandId = input.command || input.cmd_id;
      const activity = this.platform.db.getActivity(params.id);
      if (activity) {
        const result = this.platform.demo?.isIntegration(activity.integration_id)
          ? await this.platform.demo.command(params.id, commandId, input.params)
          : await this.platform.engine.runActivity(params.id, normalizeActivityAction(commandId));
        return json(response, 200, result);
      }
      const macro = this.platform.db.getMacro(params.id);
      if (macro) {
        const result = this.platform.demo?.isIntegration(macro.integration_id)
          ? await this.platform.demo.command(params.id, commandId || "start", input.params)
          : await this.platform.engine.runMacro(params.id);
        return json(response, 200, result);
      }
      return json(response, 200, await this.platform.integrations.command(params.id, commandId, input.params));
    }
    params = match(pathname, "/api/entities/:id");
    if (params && request.method === "GET") {
      const item = this.platform.db.getConfiguredEntity(params.id) || this.platform.db.getActivity(params.id) || this.platform.db.getMacro(params.id);
      return item ? json(response, 200, item) : json(response, 404, { error: "Not found" });
    }
    if (params && ["PUT", "PATCH"].includes(request.method)) {
      const item = this.platform.db.updateConfiguredEntity(params.id, await body(request));
      if (!item) return json(response, 404, { error: "Not found" });
      this.platform.events.publish("entity.change", item);
      return json(response, 200, item);
    }
    if (params && request.method === "DELETE") return noContent(response, await this.platform.integrations.unconfigureEntity(params.id) ? 204 : 404);

    if (pathname === "/api/activities" && request.method === "GET") return json(response, 200, this.platform.db.listActivities());
    if (pathname === "/api/activities" && request.method === "POST") {
      const record = this.platform.db.saveActivity(await body(request));
      this.platform.events.publish("activity.change", record);
      return json(response, 201, record);
    }
    params = match(pathname, "/api/activities/:id/buttons");
    if (params && request.method === "GET") return json(response, 200, this.platform.db.getActivity(params.id)?.options?.button_mapping || normalizeButtonMappings());
    params = match(pathname, "/api/activities/:id/ui/pages/:page");
    if (params && request.method === "GET") {
      const pages = this.platform.db.getActivity(params.id)?.options?.user_interface?.pages || [];
      const page = pages.find((item) => String(item.page_id || item.id) === params.page);
      return page ? json(response, 200, page) : json(response, 404, { error: "Not found" });
    }
    params = match(pathname, "/api/activities/:id/ui/pages");
    if (params && request.method === "GET") return json(response, 200, this.platform.db.getActivity(params.id)?.options?.user_interface?.pages || []);
    params = match(pathname, "/api/activities/:id/ui");
    if (params && request.method === "GET") return json(response, 200, this.platform.db.getActivity(params.id)?.options?.user_interface || {});
    params = match(pathname, "/api/activities/:id/:action");
    if (params && request.method === "POST" && ["on", "off"].includes(params.action)) {
      const activity = this.platform.db.getActivity(params.id);
      const result = this.platform.demo?.isIntegration(activity?.integration_id)
        ? await this.platform.demo.command(params.id, params.action)
        : await this.platform.engine.runActivity(params.id, params.action);
      return json(response, 200, result);
    }
    params = match(pathname, "/api/activities/:id");
    if (params && request.method === "GET") return json(response, 200, this.platform.db.getActivity(params.id) || { error: "Not found" });
    if (params && ["PUT", "PATCH"].includes(request.method)) {
      const record = this.platform.db.saveActivity({ ...(await body(request)), id: params.id });
      this.platform.events.publish("activity.change", record);
      return json(response, 200, record);
    }
    if (params && request.method === "DELETE") {
      const deleted = this.platform.db.deleteActivity(params.id);
      if (deleted) this.platform.events.publish("activity.deleted", { id: params.id });
      return noContent(response, deleted ? 204 : 404);
    }

    if (pathname === "/api/macros" && request.method === "GET") return json(response, 200, this.platform.db.listMacros());
    if (pathname === "/api/macros" && request.method === "POST") {
      const record = this.platform.db.saveMacro(await body(request));
      this.platform.events.publish("macro.change", record);
      return json(response, 201, record);
    }
    params = match(pathname, "/api/macros/:id/run");
    if (params && request.method === "POST") {
      const macro = this.platform.db.getMacro(params.id);
      const result = this.platform.demo?.isIntegration(macro?.integration_id)
        ? await this.platform.demo.command(params.id, "start")
        : await this.platform.engine.runMacro(params.id);
      return json(response, 200, result);
    }
    params = match(pathname, "/api/macros/:id");
    if (params && request.method === "GET") {
      const record = this.platform.db.getMacro(params.id);
      return record ? json(response, 200, integrationSetupInfo(record)) : json(response, 404, { error: "Not found" });
    }
    if (params && ["PUT", "PATCH"].includes(request.method)) {
      const record = this.platform.db.saveMacro({ ...(await body(request)), id: params.id });
      this.platform.events.publish("macro.change", record);
      return json(response, 200, record);
    }
    if (params && request.method === "DELETE") {
      const deleted = this.platform.db.deleteMacro(params.id);
      if (deleted) this.platform.events.publish("macro.deleted", { id: params.id });
      return noContent(response, deleted ? 204 : 404);
    }

    if (pathname === "/api/profiles" && request.method === "GET") return json(response, 200, this.platform.db.listProfiles());
    if (pathname === "/api/profiles" && request.method === "POST") {
      const record = this.platform.db.saveProfile(await body(request));
      this.platform.events.publish("profile.change", record);
      return json(response, 201, record);
    }
    if ((pathname === "/api/profiles/active" || pathname === "/api/profiles/active_profile") && request.method === "GET") {
      return json(response, 200, this.platform.db.listProfiles().find((item) => item.active) || null);
    }
    params = match(pathname, "/api/profiles/:id/pages/:page");
    if (params && request.method === "GET") {
      const page = this.platform.db.getPage(params.page);
      return page && page.profile_id === params.id ? json(response, 200, page) : json(response, 404, { error: "Not found" });
    }
    params = match(pathname, "/api/profiles/:id/pages");
    if (params && request.method === "GET") return json(response, 200, this.platform.db.listPages(params.id));
    params = match(pathname, "/api/profiles/:id/groups");
    if (params && request.method === "GET") return json(response, 200, this.platform.db.listGroups(params.id));
    if (params && request.method === "POST") {
      const record = this.platform.db.saveGroup({ ...(await body(request)), profile_id: params.id });
      this.platform.events.publish("profile.change", { event_type: "NEW", profile_id: params.id, group_id: record.id, new_state: { group: coreGroup(record) } });
      return json(response, 201, record);
    }
    params = match(pathname, "/api/profiles/:id/activate");
    if (params && request.method === "POST") {
      const record = this.platform.db.setActiveProfile(params.id);
      this.platform.events.publish("profile.change", record);
      return json(response, 200, record);
    }
    params = match(pathname, "/api/profiles/:id");
    if (params && request.method === "GET") {
      const record = this.platform.db.getProfile(params.id);
      return record ? json(response, 200, record) : json(response, 404, { error: "Not found" });
    }
    if (params && ["PUT", "PATCH"].includes(request.method)) {
      const record = this.platform.db.saveProfile({ ...(await body(request)), id: params.id });
      this.platform.events.publish("profile.change", record);
      return json(response, 200, record);
    }
    if (params && request.method === "DELETE") {
      const deleted = this.platform.db.deleteProfile(params.id);
      if (deleted) this.platform.events.publish("profile.deleted", { id: params.id });
      return noContent(response, deleted ? 204 : 404);
    }

    if (pathname === "/api/groups" && request.method === "GET") return json(response, 200, this.platform.db.listGroups(url.searchParams.get("profile_id")));
    if (pathname === "/api/groups" && request.method === "POST") {
      const record = this.platform.db.saveGroup(await body(request));
      this.platform.events.publish("profile.change", { event_type: "NEW", profile_id: record.profile_id, group_id: record.id, new_state: { group: coreGroup(record) } });
      return json(response, 201, record);
    }
    params = match(pathname, "/api/groups/:id");
    if (params && request.method === "GET") {
      const record = this.platform.db.getGroup(params.id);
      return record ? json(response, 200, record) : json(response, 404, { error: "Not found" });
    }
    if (params && ["PUT", "PATCH"].includes(request.method)) {
      const record = this.platform.db.saveGroup({ ...(await body(request)), id: params.id });
      this.platform.events.publish("profile.change", { event_type: "CHANGE", profile_id: record.profile_id, group_id: record.id, new_state: { group: coreGroup(record) } });
      return json(response, 200, record);
    }
    if (params && request.method === "DELETE") {
      const record = this.platform.db.getGroup(params.id);
      const deleted = this.platform.db.deleteGroup(params.id);
      if (deleted) this.platform.events.publish("profile.change", { event_type: "DELETE", profile_id: record?.profile_id, group_id: params.id });
      return noContent(response, deleted ? 204 : 404);
    }

    if (pathname === "/api/pages" && request.method === "GET") return json(response, 200, this.platform.db.listPages(url.searchParams.get("profile_id")));
    if (pathname === "/api/pages" && request.method === "POST") {
      const record = this.platform.db.savePage(await body(request));
      this.platform.events.publish("page.change", record);
      return json(response, 201, record);
    }
    params = match(pathname, "/api/pages/:id");
    if (params && request.method === "GET") return json(response, 200, this.platform.db.getPage(params.id) || { error: "Not found" });
    if (params && ["PUT", "PATCH"].includes(request.method)) {
      const record = this.platform.db.savePage({ ...(await body(request)), id: params.id });
      this.platform.events.publish("page.change", record);
      return json(response, 200, record);
    }
    if (params && request.method === "DELETE") {
      const deleted = this.platform.db.deletePage(params.id);
      if (deleted) this.platform.events.publish("page.deleted", { id: params.id });
      return noContent(response, deleted ? 204 : 404);
    }

    if (pathname === "/api/media/sessions" && request.method === "GET") return json(response, 200, this.platform.media.listSessions());
    if (pathname === "/api/executions" && request.method === "GET") return json(response, 200, this.platform.db.listExecutions());
    params = match(pathname, "/api/executions/:id/cancel");
    if (params && request.method === "POST") return json(response, this.platform.engine.cancel(params.id) ? 200 : 404, { cancelled: true });

    if (pathname === "/api/backup" && request.method === "GET") return json(response, 200, this.platform.db.exportData(), {
      "Content-Disposition": `attachment; filename="uc-virtual-remote-backup.json"`
    });
    if (pathname === "/api/backup" && request.method === "POST") return json(response, 200, this.platform.db.importData(await body(request)));

    return json(response, 404, { error: "Not found" });
  }

  async #compatibility(request, response, pathname, url) {
    const db = this.platform.db;
    const method = request.method;
    const integrations = () => visibleIntegrations(db.listIntegrations());
    let params;

    // Simulator settings are consumed by the patched official configurator,
    // which is authenticated and therefore reaches the Core compatibility
    // router rather than the unauthenticated management router.
    if (pathname === "/simulator" && method === "GET") return json(response, 200, this.#simulatorSettings());
    if (pathname === "/simulator" && ["PUT", "PATCH"].includes(method)) {
      const current = this.#simulatorSettings();
      const input = await body(request);
      const value = {
        ...current, ...input,
        battery_level: Math.max(0, Math.min(100, Number(input.battery_level ?? current.battery_level))),
        slider_mode: ["auto", "volume", "pages"].includes(String(input.slider_mode || current.slider_mode)) ? String(input.slider_mode || current.slider_mode) : "auto"
      };
      this.platform.db.setSetting("simulator", value);
      this.platform.events.publish("simulator.change", value);
      return json(response, 200, value);
    }

    // API keys and authorization metadata
    if (pathname === "/auth/scopes" && method === "GET") return json(response, 200, ["admin", "read", "write"]);
    if (pathname === "/auth/api_keys" && method === "HEAD") return paginatedHead(response, db.listApiKeys(), url);
    if (pathname === "/auth/api_keys" && method === "GET") return paginated(response, db.listApiKeys(), url);
    if (pathname === "/auth/api_keys" && method === "DELETE") { db.deleteAllApiKeys(); return ok(response); }
    params = match(pathname, "/auth/api_keys/:id");
    if (params && method === "GET") {
      const item = db.getApiKey(params.id);
      return item ? json(response, 200, item) : json(response, 404, { code: "NOT_FOUND", message: "API key not found" });
    }
    if (params && method === "PATCH") {
      const item = db.updateApiKey(params.id, await body(request));
      return item ? json(response, 200, item) : json(response, 404, { code: "NOT_FOUND", message: "API key not found" });
    }
    if (params && method === "DELETE") return db.deleteApiKey(params.id) ? ok(response) : json(response, 404, { code: "NOT_FOUND", message: "API key not found" });

    // Integration drivers, instances, discovery and setup
    if (pathname === "/intg" && method === "HEAD") return paginatedHead(response, integrations().filter((item) => item.configured !== false), url);
    if (pathname === "/intg" && method === "GET") {
      const updates = await this.platform.externalIntegrations.updates(url.searchParams.get("refresh_updates") === "true").catch(() => []);
      const updateMap = new Map(updates.map((item) => [item.driver_id, item]));
      const items = integrations().filter((item) => item.configured !== false).map((record) => {
        const status = integrationStatus(record);
        return { ...status, ...managedUpdateMetadata(updateMap.get(status.driver_id)) };
      });
      return paginated(response, items, url);
    }
    if (pathname === "/intg/updates" && method === "GET") {
      let items = await this.platform.externalIntegrations.updates(url.searchParams.get("force") === "true");
      if (["true", "1", "yes"].includes(String(url.searchParams.get("available") || "").toLowerCase())) items = items.filter((item) => item.update_available);
      return json(response, 200, items);
    }
    if (pathname === "/intg/drivers" && method === "HEAD") return paginatedHead(response, uniqueDrivers(integrations()), url);
    if (pathname === "/intg/drivers" && method === "GET") {
      const updateItems = await this.platform.externalIntegrations.updates(false).catch(() => []);
      const updateMap = new Map(updateItems.map((item) => [item.driver_id, item]));
      const installedDrivers = uniqueDrivers(integrations()).map((driver) => ({ ...driver, ...managedUpdateMetadata(updateMap.get(driver.driver_id)) }));
      const installedIds = new Set(installedDrivers.map((item) => item.driver_id));
      // The add-integration modal requests the complete enabled driver
      // catalogue. The Integrations tab separately requests unconfigured
      // EXTERNAL/CUSTOM drivers to render alongside registered instances.
      // Registry entries are installable catalogue items, not registered
      // drivers, so only merge them into catalogue-style requests.
      const catalogueRequest = !url.searchParams.has("driver_type") && !url.searchParams.has("has_instances");
      const registryDrivers = catalogueRequest
        ? (await this.platform.externalIntegrations.drivers()).filter((item) => !installedIds.has(item.driver_id))
        : [];
      let drivers = [...installedDrivers, ...registryDrivers];
      const driverType = url.searchParams.get("driver_type");
      if (driverType) drivers = drivers.filter((item) => String(item.driver_type || "").toUpperCase() === driverType.toUpperCase());
      for (const key of ["enabled", "has_instances"]) {
        if (!url.searchParams.has(key)) continue;
        const expected = ["true", "1", "yes"].includes(String(url.searchParams.get(key)).toLowerCase());
        drivers = drivers.filter((item) => Boolean(item[key]) === expected);
      }
      return paginated(response, drivers, url);
    }
    if (pathname === "/intg/drivers" && method === "POST") {
      const input = await body(request);
      const record = await this.platform.integrations.register({
        id: input.driver_id,
        driver_id: input.driver_id,
        name: input.name?.en || input.name || input.driver_id,
        url: input.driver_url || input.connection?.driver_url,
        token: input.token || input.connection?.token,
        enabled: input.enabled !== false,
        metadata: input
      });
      return json(response, 201, integrationDriver(record));
    }
    params = match(pathname, "/intg/drivers/:id/update");
    if (params && method === "POST") {
      const result = await this.platform.externalIntegrations.update(params.id);
      return result ? json(response, 200, result) : json(response, 404, { error: "Managed integration not found" });
    }
    params = match(pathname, "/intg/drivers/:id");
    if (params && method === "GET") {
      const record = integrations().find((item) => (item.driver_id || item.id) === params.id);
      const registry = record ? null : await this.platform.externalIntegrations.driver(params.id);
      const updateInfo = record ? await this.platform.externalIntegrations.updateInfo(params.id, false).catch(() => null) : null;
      return record ? json(response, 200, { ...integrationDriver(record), ...managedUpdateMetadata(updateInfo) }) : registry ? json(response, 200, registry) : json(response, 404, { error: "Not found" });
    }
    if (params && method === "PATCH") {
      const input = await body(request);
      const records = integrations().filter((item) => (item.driver_id || item.id) === params.id);
      if (!records.length) return json(response, 404, { error: "Not found" });
      for (const record of records) db.updateIntegration(record.id, {
        url: input.driver_url || input.connection?.driver_url || record.url,
        token: input.token ?? input.connection?.token ?? record.token,
        enabled: input.enabled ?? record.enabled,
        metadata: { ...record.metadata, ...input }
      });
      return json(response, 200, integrationDriver(db.getIntegration(records[0].id)));
    }
    if (params && method === "PUT") {
      const input = await body(request);
      const records = integrations().filter((item) => (item.driver_id || item.id) === params.id);
      const start = String(input.cmd_id || input.command || "").toUpperCase() === "START";
      await this.platform.externalIntegrations.setRunning(params.id, start).catch((error) => log.warn(`Managed integration ${params.id} container command failed:`, error.message));
      for (const record of records) start ? await this.platform.integrations.connect(record.id) : await this.platform.integrations.disconnect(record.id);
      return noContent(response);
    }
    if (params && method === "POST") {
      const input = await body(request);
      const driver = integrations().find((item) => (item.driver_id || item.id) === params.id);
      if (!driver) return json(response, 404, { error: "Not found" });
      const value = db.saveIntegration({ ...driver, ...input, id: input.integration_id, driver_id: params.id, setup_data: input.setup_data, configured: true });
      return json(response, 201, integrationInstance(value));
    }
    if (params && method === "DELETE") {
      const records = integrations().filter((item) => (item.driver_id || item.id) === params.id);
      for (const record of records) await this.platform.integrations.remove(record.id);
      await this.platform.externalIntegrations.remove(params.id);
      return noContent(response);
    }

    if (pathname === "/intg/instances" && method === "HEAD") return paginatedHead(response, integrations().filter((item) => item.configured !== false), url);
    if (pathname === "/intg/instances" && method === "GET") return paginated(response, integrations().filter((item) => item.configured !== false).map(integrationInstance), url);
    if (pathname === "/intg/instances" && method === "PUT") {
      const input = await body(request);
      const command = String(input.cmd_id || input.command || "").toUpperCase();
      for (const record of integrations()) {
        if (command === "CONNECT") await this.platform.integrations.connect(record.id);
        if (command === "DISCONNECT") await this.platform.integrations.disconnect(record.id);
      }
      return noContent(response);
    }
    params = match(pathname, "/intg/instances/:id/entities/:entity");
    if (params && method === "POST") {
      return json(response, 201, coreEntity(await this.platform.integrations.configureEntity(
        params.id, localEntityId(params.id, params.entity), await body(request)
      )));
    }
    params = match(pathname, "/intg/instances/:id/entities");
    if (params && ["GET", "HEAD"].includes(method)) {
      let items = db.listAvailableEntities(params.id).map(availableEntity);
      const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
      const types = String(url.searchParams.get("entity_types") || "").split(",").filter(Boolean);
      const filter = String(url.searchParams.get("filter") || "").toUpperCase();
      if (query) items = items.filter((item) => JSON.stringify(item.name || "").toLowerCase().includes(query));
      if (types.length) items = items.filter((item) => types.includes(item.entity_type));
      if (filter === "NEW") {
        const configured = new Set(db.listConfiguredEntities(params.id).map((item) => item.local_id));
        for (const item of db.listActivities().filter((entity) => entity.integration_id === params.id)) configured.add(item.local_id);
        for (const item of db.listMacros().filter((entity) => entity.integration_id === params.id)) configured.add(item.local_id);
        items = items.filter((item) => !configured.has(item.entity_id));
      }
      return method === "HEAD" ? paginatedHead(response, items, url) : paginated(response, items, url);
    }
    if (params && method === "POST") {
      const input = await body(request);
      const ids = Array.isArray(input) ? input : (input.entity_ids || input.entities || []);
      const result = [];
      for (const id of ids) result.push(coreEntity(await this.platform.integrations.configureEntity(params.id, localEntityId(params.id, id))));
      return json(response, 201, result);
    }
    params = match(pathname, "/intg/instances/:id");
    if (params && method === "GET") {
      const value = db.getIntegration(params.id);
      return value && !isInternalIntegration(value) ? json(response, 200, integrationInstance(value)) : json(response, 404, { error: "Not found" });
    }
    if (params && method === "PATCH") {
      const existing = db.getIntegration(params.id);
      if (!existing || isInternalIntegration(existing)) return json(response, 404, { error: "Not found" });
      const input = await body(request);
      const value = db.updateIntegration(params.id, {
        name: input.name?.en || input.name,
        enabled: input.enabled,
        setup_data: input.setup_data
      });
      return json(response, 200, integrationInstance(value));
    }
    if (params && method === "PUT") {
      const existing = db.getIntegration(params.id);
      if (!existing || isInternalIntegration(existing)) return json(response, 404, { error: "Not found" });
      const input = await body(request);
      const command = String(input.cmd_id || input.command || "").toUpperCase();
      if (command === "CONNECT") {
        await this.platform.externalIntegrations.setRunning(params.id, true).catch(() => false);
        await this.platform.integrations.connect(params.id);
      } else if (command === "DISCONNECT") {
        await this.platform.integrations.disconnect(params.id);
        await this.platform.externalIntegrations.setRunning(params.id, false).catch(() => false);
      } else return json(response, 400, { error: `Unsupported integration command ${command}` });
      return noContent(response);
    }
    if (params && method === "DELETE") {
      const record = db.getIntegration(params.id);
      if (!record || isInternalIntegration(record)) return noContent(response, 404);
      await this.platform.integrations.remove(params.id);
      await this.platform.externalIntegrations.remove(record.driver_id || record.metadata?.driver_id || record.id);
      return noContent(response);
    }

    if (pathname === "/intg/discover" && method === "GET") {
      const state = db.getSetting("integration_discovery", { active: false, drivers: [] });
      return json(response, 200, state);
    }
    if (pathname === "/intg/discover" && method === "PUT") {
      db.setSetting("integration_discovery", { active: true, drivers: [] });
      const drivers = await this.platform.integrations.discover(Number(url.searchParams.get("timeout") || 3) * 1000);
      const state = { active: false, drivers, updated_at: new Date().toISOString() };
      db.setSetting("integration_discovery", state);
      return json(response, 200, state);
    }
    if (pathname === "/intg/discover" && method === "DELETE") {
      const state = db.getSetting("integration_discovery", { active: false, drivers: [] });
      db.setSetting("integration_discovery", { ...state, active: false });
      return ok(response);
    }
    params = match(pathname, "/intg/discover/:driver");
    if (params) {
      const state = db.getSetting("integration_discovery", { active: false, drivers: [] });
      const discovered = (state.drivers || []).find((item) => String(item.driver_id || item.id) === params.driver);
      if (method === "GET") return discovered ? json(response, 200, discovered) : json(response, 404, { code: "NOT_FOUND", message: "Discovered integration driver not found" });
      if (method === "PUT") {
        if (!discovered) return json(response, 404, { code: "NOT_FOUND", message: "Discovered integration driver not found" });
        const input = await body(request);
        const driverUrl = input.connection?.driver_url || discovered.driver_url || discovered.url;
        return json(response, 200, {
          ...discovered, connection: { driver_url: driverUrl, authenticated: Boolean(input.connection?.token), reachable: Boolean(driverUrl) },
          metadata: discovered.metadata || { driver_id: params.driver, name: discovered.name || { en: params.driver } }
        });
      }
      if (method === "POST") {
        if (!discovered) return json(response, 404, { code: "NOT_FOUND", message: "Discovered integration driver not found" });
        const input = await body(request);
        const record = await this.platform.integrations.register({
          id: params.driver, driver_id: params.driver, name: input.name?.en || input.name || displayName(discovered.name, params.driver),
          url: input.driver_url || discovered.driver_url || discovered.url, token: input.token, metadata: { ...discovered, ...input }, configured: false
        });
        return json(response, 201, integrationDriver(record));
      }
    }
    if (pathname === "/intg/setup/jobs" && method === "GET") return json(response, 200, this.platform.externalIntegrations.setupJobs());
    if (pathname === "/intg/setup" && method === "GET") return json(response, 200, integrations().filter((item) => item.setup_state !== "IDLE").map(integrationSetupInfo));
    if (pathname === "/intg/setup" && method === "DELETE") {
      for (const record of integrations().filter((item) => item.setup_state !== "IDLE")) await this.platform.integrations.abortSetup(record.id).catch(() => {});
      for (const job of this.platform.externalIntegrations.jobs?.() || []) this.platform.externalIntegrations.stopSetup?.(job.id);
      return ok(response);
    }
    if (pathname === "/intg/setup" && method === "POST") {
      const input = await body(request);
      const record = integrations().find((item) => (item.driver_id || item.id) === input.driver_id);
      if (!record) {
        const job = await this.platform.externalIntegrations.startSetup(input.driver_id, input.setup_data || {});
        return job ? json(response, 201, job) : json(response, 404, { error: "Driver not found" });
      }
      await this.platform.integrations.startSetup(record.id, Boolean(input.reconfigure), input.setup_data || {});
      return json(response, 201, integrationSetupInfo(db.getIntegration(record.id)));
    }
    params = match(pathname, "/intg/setup/:id");
    if (params && method === "GET") {
      const record = integrations().find((item) => (item.driver_id || item.id) === params.id);
      const job = this.platform.externalIntegrations.job(params.id);
      return record ? json(response, 200, integrationSetupInfo(record)) : job ? json(response, 200, this.platform.externalIntegrations.publicJob(job)) : json(response, 404, { error: "Not found" });
    }
    if (params && method === "PUT") {
      const input = await body(request);
      if (await this.platform.externalIntegrations.continueSetup(params.id, input)) {
        const managed = integrations().find((item) => (item.driver_id || item.id) === params.id);
        return json(response, 200, managed ? integrationSetupInfo(managed) : { driver_id: params.id, state: "SETUP" });
      }
      const record = integrations().find((item) => (item.driver_id || item.id) === params.id);
      if (!record) return json(response, 404, { error: "Not found" });
      await this.platform.integrations.submitSetup(record.id, input);
      return json(response, 200, integrationSetupInfo(db.getIntegration(record.id)));
    }
    if (params && method === "DELETE") {
      if (await this.platform.externalIntegrations.cancelSetup(params.id)) return noContent(response);
      const record = integrations().find((item) => (item.driver_id || item.id) === params.id);
      if (record) await this.platform.integrations.abortSetup(record.id);
      return noContent(response);
    }

    // Configured entities
    if (pathname === "/entities" && ["GET", "HEAD"].includes(method)) {
      let items = [...db.listConfiguredEntities(), ...db.listActivities(), ...db.listMacros()].map(coreEntity);
      const type = url.searchParams.get("entity_type");
      const integrationId = url.searchParams.get("integration_id") || url.searchParams.get("intg_id");
      const integrations = String(url.searchParams.get("intg_ids") || "").split(",").filter(Boolean);
      const types = String(url.searchParams.get("entity_types") || "").split(",").filter(Boolean);
      const excluded = new Set(String(url.searchParams.get("exclude") || "").split(",").filter(Boolean));
      const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
      if (type) items = items.filter((item) => item.entity_type === type);
      if (integrationId) items = items.filter((item) => item.integration_id === integrationId);
      if (integrations.length) items = items.filter((item) => integrations.includes(item.integration_id));
      if (types.length) items = items.filter((item) => types.includes(item.entity_type));
      if (excluded.size) items = items.filter((item) => !excluded.has(item.entity_id));
      if (query) items = items.filter((item) => JSON.stringify(item.name || "").toLowerCase().includes(query));
      return method === "HEAD" ? paginatedHead(response, items, url) : paginated(response, items, url);
    }
    if (pathname === "/entities" && method === "DELETE") {
      const input = await body(request);
      const ids = input.entity_ids || db.listConfiguredEntities(input.integration_id).map((item) => item.entity_id);
      for (const id of ids) await this.platform.integrations.unconfigureEntity(id);
      return noContent(response);
    }
    params = match(pathname, "/entities/:id/media/browse");
    if (params && method === "GET") {
      const result = await this.platform.media.browse(params.id, Object.fromEntries(url.searchParams.entries()));
      return json(response, 200, { media: result.media }, {
        "Pagination-Count": String(result.pagination.count),
        "Pagination-Limit": String(result.pagination.limit),
        "Pagination-Page": String(result.pagination.page)
      });
    }
    params = match(pathname, "/entities/:id/media/search");
    if (params && method === "GET") {
      const result = await this.platform.media.search(params.id, Object.fromEntries(url.searchParams.entries()));
      return json(response, 200, result.items, {
        "Pagination-Count": String(result.pagination.count),
        "Pagination-Limit": String(result.pagination.limit),
        "Pagination-Page": String(result.pagination.page)
      });
    }
    params = match(pathname, "/entities/:id/media/queue");
    if (params && method === "GET") return json(response, 200, this.platform.media.getQueue(params.id));
    if (params && ["PUT", "POST", "PATCH"].includes(method)) return json(response, 200, this.platform.media.setQueue(params.id, await body(request)));
    if (params && method === "DELETE") return json(response, 200, this.platform.media.clearQueue(params.id));

    params = match(pathname, "/entities/:id/command");
    if (params && method === "PUT") {
      const input = await body(request);
      const activity = db.getActivity(params.id);
      const macro = db.getMacro(params.id);
      const result = activity
        ? this.platform.demo?.isIntegration(activity.integration_id)
          ? await this.platform.demo.command(params.id, input.cmd_id, input.params)
          : await this.platform.engine.runActivity(params.id, normalizeActivityAction(input.cmd_id))
        : macro ? this.platform.demo?.isIntegration(macro.integration_id)
          ? await this.platform.demo.command(params.id, input.cmd_id || "start", input.params)
          : await this.platform.engine.runMacro(params.id)
          : await this.platform.integrations.command(params.id, input.cmd_id, input.params);
      return json(response, 200, result || {});
    }
    params = match(pathname, "/entities/:id");
    if (params && method === "GET") {
      const item = db.getConfiguredEntity(params.id) || db.getActivity(params.id) || db.getMacro(params.id);
      return item ? json(response, 200, coreEntity(item)) : json(response, 404, { error: "Not found" });
    }
    if (params && method === "PATCH") {
      const item = db.updateConfiguredEntity(params.id, await body(request));
      return item ? json(response, 200, coreEntity(item)) : json(response, 404, { error: "Not found" });
    }
    if (params && method === "DELETE") return noContent(response, await this.platform.integrations.unconfigureEntity(params.id) ? 204 : 404);

    // Activities and activity groups
    const activityItems = () => {
      let items = db.listActivities().map(coreEntity);
      const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
      if (query) items = items.filter((item) => JSON.stringify(item.name || "").toLowerCase().includes(query));
      const inGroup = url.searchParams.get("in_group");
      if (inGroup !== null) {
        const grouped = new Set(db.listActivityGroups().flatMap((group) => group.activities || []));
        items = items.filter((item) => grouped.has(item.entity_id) === (inGroup === "true"));
      }
      return items;
    };
    if (pathname === "/activities" && method === "HEAD") return paginatedHead(response, activityItems(), url);
    if (pathname === "/activities" && method === "GET") return paginated(response, activityItems(), url);
    if (pathname === "/activities" && method === "POST") {
      const input = await body(request);
      let value;
      if (input.clone_from) {
        const source = db.getActivity(input.clone_from);
        if (!source) return json(response, 404, { code: "NOT_FOUND", message: "Source activity not found" });
        value = db.saveActivity({ ...source, ...input, id: undefined, entity_id: undefined, options: { ...source.options, ...input.options } });
      } else value = db.saveActivity(input);
      this.platform.events.publish("entity.created", value);
      return json(response, 201, coreEntity(value));
    }
    if (pathname === "/activities" && method === "DELETE") { db.deleteAllActivities(); return ok(response); }

    params = match(pathname, "/activities/:id/ui/pages/:page");
    if (params) {
      const activity = db.getActivity(params.id);
      if (!activity) return json(response, 404, { code: "NOT_FOUND", message: "Activity not found" });
      const pages = [...(activity.options?.user_interface?.pages || [])];
      const index = pages.findIndex((page) => page.page_id === params.page);
      if (index < 0) return json(response, 404, { code: "NOT_FOUND", message: "Page not found" });
      if (method === "GET") return json(response, 200, pages[index]);
      if (method === "PATCH") {
        pages[index] = { ...pages[index], ...(await body(request)), page_id: params.page };
        const value = db.saveActivity({ id: params.id, options: { ...activity.options, user_interface: { ...(activity.options?.user_interface || {}), pages } } });
        return json(response, 200, coreEntity(value));
      }
      if (method === "DELETE") {
        pages.splice(index, 1);
        db.saveActivity({ id: params.id, options: { ...activity.options, user_interface: { ...(activity.options?.user_interface || {}), pages } } });
        return ok(response);
      }
    }
    params = match(pathname, "/activities/:id/ui/pages");
    if (params) {
      const activity = db.getActivity(params.id);
      if (!activity) return json(response, 404, { code: "NOT_FOUND", message: "Activity not found" });
      const pages = [...(activity.options?.user_interface?.pages || [])];
      if (method === "GET") return json(response, 200, pages);
      if (method === "POST") {
        const input = await body(request);
        const pageId = String(input.page_id || `page-${crypto.randomUUID()}`);
        pages.push({
          page_id: pageId, name: input.name || "New page",
          grid: input.grid || { width: 4, height: 6 }, items: input.items || [],
          ...(input.image ? { image: input.image } : {})
        });
        const value = db.saveActivity({ id: params.id, options: { ...activity.options, user_interface: { ...(activity.options?.user_interface || {}), pages } } });
        return json(response, 201, coreEntity(value));
      }
      if (method === "PATCH") {
        const order = (await body(request)).page_order || [];
        const byId = new Map(pages.map((page) => [page.page_id, page]));
        const reordered = [...order.map((id) => byId.get(id)).filter(Boolean), ...pages.filter((page) => !order.includes(page.page_id))];
        const value = db.saveActivity({ id: params.id, options: { ...activity.options, user_interface: { ...(activity.options?.user_interface || {}), pages: reordered } } });
        return json(response, 200, coreEntity(value));
      }
      if (method === "DELETE") {
        const value = db.saveActivity({ id: params.id, options: { ...activity.options, user_interface: { ...(activity.options?.user_interface || {}), pages: [] } } });
        return json(response, 200, coreEntity(value));
      }
    }
    params = match(pathname, "/activities/:id/ui");
    if (params) {
      const activity = db.getActivity(params.id);
      if (!activity) return json(response, 404, { code: "NOT_FOUND", message: "Activity not found" });
      if (method === "GET") return json(response, 200, activity.options?.user_interface || {});
      if (method === "DELETE") {
        const options = { ...activity.options }; delete options.user_interface;
        return json(response, 200, coreEntity(db.saveActivity({ id: params.id, options })));
      }
    }

    params = match(pathname, "/activities/:id/buttons/:button/:press");
    if (params) {
      const activity = db.getActivity(params.id);
      if (!activity) return json(response, 404, { code: "NOT_FOUND", message: "Activity not found" });
      const mappings = normalizeButtonMappings(activity.options?.button_mapping);
      const mapping = mappings.find((item) => item.button === params.button);
      if (method === "GET") {
        const value = mapping?.[params.press];
        return value !== undefined ? json(response, 200, value) : json(response, 404, { code: "NOT_FOUND", message: "Button press mapping not found" });
      }
      if (method === "DELETE") {
        if (mapping) delete mapping[params.press];
        return json(response, 200, coreEntity(db.saveActivity({
          id: params.id,
          options: { ...activity.options, button_mapping: normalizeButtonMappings(mappings) }
        })));
      }
    }
    params = match(pathname, "/activities/:id/buttons/:button");
    if (params) {
      const activity = db.getActivity(params.id);
      if (!activity) return json(response, 404, { code: "NOT_FOUND", message: "Activity not found" });
      const mappings = normalizeButtonMappings(activity.options?.button_mapping);
      const index = mappings.findIndex((item) => item.button === params.button);
      if (method === "GET") {
        const mapping = index >= 0 ? mappings[index] : { button: params.button };
        return json(response, 200, mapping);
      }
      if (method === "PATCH") {
        const input = await body(request);
        if (index < 0) mappings.push({ button: params.button, ...input });
        else mappings[index] = { ...mappings[index], ...input, button: params.button };
        return json(response, 200, coreEntity(db.saveActivity({
          id: params.id,
          options: { ...activity.options, button_mapping: normalizeButtonMappings(mappings) }
        })));
      }
      if (method === "DELETE") {
        if (index >= 0) mappings[index] = { button: params.button };
        return json(response, 200, coreEntity(db.saveActivity({
          id: params.id,
          options: { ...activity.options, button_mapping: normalizeButtonMappings(mappings) }
        })));
      }
    }
    params = match(pathname, "/activities/:id/buttons");
    if (params) {
      const activity = db.getActivity(params.id);
      if (!activity) return json(response, 404, { code: "NOT_FOUND", message: "Activity not found" });
      if (method === "GET") return json(response, 200, normalizeButtonMappings(activity.options?.button_mapping));
      if (method === "POST") {
        const mappings = await body(request);
        return json(response, 200, coreEntity(db.saveActivity({
          id: params.id,
          options: { ...activity.options, button_mapping: normalizeButtonMappings(mappings) }
        })));
      }
      if (method === "PATCH") {
        const incoming = await body(request);
        const map = new Map(normalizeButtonMappings(activity.options?.button_mapping).map((item) => [item.button, item]));
        for (const item of Array.isArray(incoming) ? incoming : []) {
          if (!item?.button) continue;
          map.set(item.button, { ...(map.get(item.button) || {}), ...item, button: item.button });
        }
        return json(response, 200, coreEntity(db.saveActivity({
          id: params.id,
          options: { ...activity.options, button_mapping: normalizeButtonMappings([...map.values()]) }
        })));
      }
      if (method === "DELETE") return json(response, 200, coreEntity(db.saveActivity({
        id: params.id,
        options: { ...activity.options, button_mapping: normalizeButtonMappings() }
      })));
    }

    params = match(pathname, "/activities/:id");
    if (params && method === "GET") {
      const value = db.getActivity(params.id);
      return value ? json(response, 200, coreEntity(value)) : json(response, 404, { code: "NOT_FOUND", message: "Not found" });
    }
    if (params && method === "PATCH") {
      const value = db.saveActivity({ ...(await body(request)), id: params.id });
      this.platform.events.publish("entity.updated", value);
      return json(response, 200, coreEntity(value));
    }
    if (params && method === "DELETE") return db.deleteActivity(params.id) ? ok(response) : json(response, 404, { code: "NOT_FOUND", message: "Not found" });

    if (pathname === "/activity_groups" && method === "HEAD") return paginatedHead(response, db.listActivityGroups(), url);
    if (pathname === "/activity_groups" && method === "GET") return paginated(response, db.listActivityGroups(), url);
    if (pathname === "/activity_groups" && method === "POST") return json(response, 201, db.saveActivityGroup(await body(request)));
    if (pathname === "/activity_groups" && method === "DELETE") { db.deleteAllActivityGroups(); return ok(response); }
    params = match(pathname, "/activity_groups/:id");
    if (params && method === "GET") {
      const value = db.getActivityGroup(params.id);
      return value ? json(response, 200, value) : json(response, 404, { code: "NOT_FOUND", message: "Not found" });
    }
    if (params && method === "PATCH") return json(response, 200, db.saveActivityGroup({ ...(await body(request)), id: params.id }));
    if (params && method === "DELETE") return db.deleteActivityGroup(params.id) ? ok(response) : json(response, 404, { code: "NOT_FOUND", message: "Not found" });

    // Macros
    const macroItems = () => {
      let items = db.listMacros().map(coreEntity);
      const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
      if (query) items = items.filter((item) => JSON.stringify(item.name || "").toLowerCase().includes(query));
      return items;
    };
    if (pathname === "/macros" && method === "HEAD") return paginatedHead(response, macroItems(), url);
    if (pathname === "/macros" && method === "GET") return paginated(response, macroItems(), url);
    if (pathname === "/macros" && method === "POST") {
      const input = await body(request);
      let value;
      if (input.clone_from) {
        const source = db.getMacro(input.clone_from);
        if (!source) return json(response, 404, { code: "NOT_FOUND", message: "Source macro not found" });
        value = db.saveMacro({ ...source, ...input, id: undefined, entity_id: undefined, options: { ...source.options, ...input.options } });
      } else value = db.saveMacro(input);
      this.platform.events.publish("entity.created", value);
      return json(response, 201, coreEntity(value));
    }
    if (pathname === "/macros" && method === "DELETE") { db.deleteAllMacros(); return ok(response); }
    params = match(pathname, "/macros/:id");
    if (params && method === "GET") {
      const value = db.getMacro(params.id);
      return value ? json(response, 200, coreEntity(value)) : json(response, 404, { code: "NOT_FOUND", message: "Not found" });
    }
    if (params && method === "PATCH") {
      const value = db.saveMacro({ ...(await body(request)), id: params.id });
      this.platform.events.publish("entity.updated", value);
      return json(response, 200, coreEntity(value));
    }
    if (params && method === "DELETE") return db.deleteMacro(params.id) ? ok(response) : json(response, 404, { code: "NOT_FOUND", message: "Not found" });

    // Profiles, pages and groups
    const profileItems = () => {
      let items = db.listProfiles();
      if (url.searchParams.get("active") === "true") items = items.filter((item) => item.active);
      return items.map(coreProfile);
    };
    if (pathname === "/profiles" && method === "HEAD") return paginatedHead(response, profileItems(), url);
    if (pathname === "/profiles" && method === "GET") return paginated(response, profileItems(), url);
    if (pathname === "/profiles" && method === "POST") {
      const value = db.saveProfile(await body(request));
      this.platform.events.publish("profile.change", { event_type: "NEW", profile_id: value.id, new_state: { profile: coreProfile(value) } });
      return json(response, 201, coreProfile(value));
    }
    if (pathname === "/profiles" && method === "PUT") {
      const input = await body(request);
      const profileId = url.searchParams.get("active_profile_id") || input.profile_id || input.active_profile_id;
      const value = db.setActiveProfile(profileId);
      this.platform.events.publish("profile.change", { event_type: "CHANGE", profile_id: value.id, new_state: { profile: coreProfile(value) } });
      return ok(response);
    }
    if (pathname === "/profiles" && method === "DELETE") { db.deleteAllProfiles(); return ok(response); }
    if (["/profiles/active", "/profiles/active_profile"].includes(pathname)) {
      if (method === "GET") {
        const value = db.listProfiles().find((item) => item.active) || null;
        return json(response, 200, value ? coreProfile(value) : null);
      }
      if (["PUT", "PATCH"].includes(method)) {
        const input = await body(request);
        const profileId = input.profile_id || input.active_profile_id || url.searchParams.get("profile_id");
        return json(response, 200, coreProfile(db.setActiveProfile(profileId)));
      }
    }
    params = match(pathname, "/profiles/:profile/pages/:page");
    if (params && method === "GET") {
      const value = db.getPage(params.page);
      return value && value.profile_id === params.profile ? json(response, 200, corePage(value)) : json(response, 404, { code: "NOT_FOUND", message: "Not found" });
    }
    if (params && method === "PATCH") {
      const existing = db.getPage(params.page);
      if (!existing || existing.profile_id !== params.profile) return json(response, 404, { code: "NOT_FOUND", message: "Page does not belong to this profile" });
      const value = db.savePage({ ...(await body(request)), id: params.page, profile_id: existing.profile_id });
      this.platform.events.publish("profile.change", { event_type: "CHANGE", profile_id: params.profile, page_id: value.id, new_state: { page: corePage(value) } });
      return json(response, 200, corePage(value));
    }
    if (params && method === "DELETE") {
      const existing = db.getPage(params.page);
      if (!existing || existing.profile_id !== params.profile) return json(response, 404, { code: "NOT_FOUND", message: "Page does not belong to this profile" });
      if (!db.deletePage(params.page)) return json(response, 404, { code: "NOT_FOUND", message: "Not found" });
      this.platform.events.publish("profile.change", { event_type: "DELETE", profile_id: params.profile, page_id: params.page });
      return ok(response);
    }
    params = match(pathname, "/profiles/:profile/pages");
    if (params && method === "GET") return json(response, 200, db.listPages(params.profile).map(corePage));
    if (params && method === "POST") {
      const input = await body(request);
      const requestedId = String(input.page_id || input.id || "");
      const existing = requestedId ? db.getPage(requestedId) : null;
      if (existing && existing.profile_id !== params.profile) return json(response, 409, { code: "PROFILE_PAGE_CONFLICT", message: "Page ID already belongs to another profile" });
      const value = db.savePage({ ...input, profile_id: params.profile });
      this.platform.events.publish("profile.change", { event_type: "NEW", profile_id: params.profile, page_id: value.id, new_state: { page: corePage(value) } });
      return json(response, 201, corePage(value));
    }
    if (params && method === "DELETE") { db.deletePagesInProfile(params.profile); return ok(response); }
    params = match(pathname, "/profiles/:profile/groups/:group");
    if (params && method === "GET") {
      const value = db.getGroup(params.group);
      return value && value.profile_id === params.profile ? json(response, 200, coreGroup(value)) : json(response, 404, { code: "NOT_FOUND", message: "Not found" });
    }
    if (params && method === "PATCH") {
      const existing = db.getGroup(params.group);
      if (!existing || existing.profile_id !== params.profile) return json(response, 404, { code: "NOT_FOUND", message: "Group does not belong to this profile" });
      return json(response, 200, coreGroup(db.saveGroup({ ...(await body(request)), id: params.group, profile_id: existing.profile_id })));
    }
    if (params && method === "DELETE") {
      const existing = db.getGroup(params.group);
      if (!existing || existing.profile_id !== params.profile) return json(response, 404, { code: "NOT_FOUND", message: "Group does not belong to this profile" });
      return db.deleteGroup(params.group) ? ok(response) : json(response, 404, { code: "NOT_FOUND", message: "Not found" });
    }
    params = match(pathname, "/profiles/:profile/groups");
    if (params && method === "GET") return json(response, 200, db.listGroups(params.profile).map(coreGroup));
    if (params && method === "POST") {
      const input = await body(request);
      const requestedId = String(input.group_id || input.id || "");
      const existing = requestedId ? db.getGroup(requestedId) : null;
      if (existing && existing.profile_id !== params.profile) return json(response, 409, { code: "PROFILE_GROUP_CONFLICT", message: "Group ID already belongs to another profile" });
      return json(response, 201, coreGroup(db.saveGroup({ ...input, profile_id: params.profile })));
    }
    if (params && method === "DELETE") { db.deleteGroupsInProfile(params.profile); return ok(response); }
    params = match(pathname, "/profiles/:id");
    if (params && method === "GET") {
      const value = db.getProfile(params.id);
      return value ? json(response, 200, coreProfile(value)) : json(response, 404, { code: "NOT_FOUND", message: "Not found" });
    }
    if (params && method === "PATCH") {
      const input = await body(request);
      const value = db.saveProfile({ ...input, id: params.id });
      if (Array.isArray(input.pages)) {
        input.pages.forEach((pageRef, index) => {
          const pageId = typeof pageRef === "object" && pageRef
            ? String(pageRef.page_id || pageRef.id || "")
            : String(pageRef || "");
          const page = pageId ? db.getPage(pageId) : null;
          if (page && page.profile_id === params.id) db.savePage({ ...page, pos: index });
        });
      }
      this.platform.events.publish("profile.change", { event_type: "CHANGE", profile_id: value.id, new_state: { profile: coreProfile(value) } });
      return json(response, 200, coreProfile(value));
    }
    if (params && method === "DELETE") return db.deleteProfile(params.id) ? ok(response) : json(response, 404, { code: "NOT_FOUND", message: "Not found" });

    // External-system access tokens. Keep the discovery filter used by the
    // Web Configurator while exposing the complete Core multi-token model.
    if (pathname === "/auth/external") {
      if (method === "GET") {
        const state = String(url.searchParams.get("state") || "");
        if (state === "NEW" && url.searchParams.get("intg") === "true") {
          const configured = new Set(db.listExternalSystems().map((item) => item.system));
          return json(response, 200, integrations().filter((item) => !configured.has(item.id)).map((item) => ({
            system: item.id, name: item.name || item.id, intg_name: item.metadata?.name || { en: item.name || item.id },
            icon: item.metadata?.icon || "uc:integration", type: "OAUTH2_APP", state: "NEW"
          })));
        }
        if (url.searchParams.has("type")) return json(response, 200, db.listExternalAccessTokens().map(({ token: _token, ...item }) => item));
        return json(response, 200, db.listExternalSystems());
      }
      if (method === "DELETE") { db.deleteExternalAccessTokens(); return ok(response); }
    }
    params = match(pathname, "/auth/external/:system/:token");
    if (params) {
      if (method === "GET") {
        const item = db.getExternalAccessToken(params.system, params.token);
        return item ? json(response, 200, item) : json(response, 404, { code: "NOT_FOUND", message: "External access token not found" });
      }
      if (method === "PUT") {
        const existing = db.getExternalAccessToken(params.system, params.token);
        if (!existing) return json(response, 404, { code: "NOT_FOUND", message: "External access token not found" });
        return json(response, 200, db.saveExternalAccessToken(params.system, await body(request), params.token));
      }
      if (method === "DELETE") return db.deleteExternalAccessToken(params.system, params.token)
        ? ok(response) : json(response, 404, { code: "NOT_FOUND", message: "External access token not found" });
    }
    params = match(pathname, "/auth/external/:system");
    if (params) {
      const items = db.listExternalAccessTokens(params.system);
      if (method === "HEAD") return paginatedHead(response, items, url);
      if (method === "GET") return paginated(response, items.map(({ token: _token, ...item }) => item), url);
      if (method === "POST") {
        const saved = db.saveExternalAccessToken(params.system, await body(request));
        return json(response, 201, { code: "OK", ...saved });
      }
      if (method === "DELETE") { db.deleteExternalAccessTokens(params.system); return ok(response); }
    }

    if (pathname === "/cfg/entity/commands" && method === "GET") return json(response, 200, entityCommandMetadata());
    if (pathname === "/cfg/device/button_layout" && method === "GET") return json(response, 200, buttonLayout());
    if (pathname === "/cfg/device/icon_mapping" && method === "GET") return json(response, 200, iconMapping());
    if (pathname === "/cfg/device/screen_layout" && method === "GET") return json(response, 200, screenLayout());
    if (pathname === "/cfg/bt/profiles" && method === "GET") return json(response, 200, [
      { id: "HID", name: { en: "Human Interface Device" }, enabled: true },
      { id: "A2DP", name: { en: "Advanced Audio Distribution" }, enabled: true }
    ]);
    if (pathname === "/cfg/bt" && method === "GET") return json(response, 200, this.platform.configuration.get("bt"));
    if (pathname === "/cfg/bt" && method === "PATCH") {
      const input = await body(request);
      const value = this.platform.configuration.update("bt", input);
      if (Object.prototype.hasOwnProperty.call(input, "enable_hci_log")) await this.platform.hardware.setHciLogging(value.enable_hci_log);
      return json(response, 200, value);
    }
    if (pathname === "/cfg/network" && method === "PATCH") {
      const input = await body(request);
      const previous = this.platform.configuration.get("network");
      const value = this.platform.configuration.update("network", input);
      if (Object.prototype.hasOwnProperty.call(input, "wifi_enabled") && Boolean(previous.wifi_enabled) !== Boolean(value.wifi_enabled)) {
        await this.platform.hardware.setWifiPower(value.wifi_enabled);
      }
      if (Object.prototype.hasOwnProperty.call(input, "bt_enabled") && Boolean(previous.bt_enabled) !== Boolean(value.bt_enabled)) {
        await this.platform.hardware.setBluetoothPower(value.bt_enabled);
      }
      return json(response, 200, value);
    }
    if (pathname === "/cfg/network/wifi" && method === "GET") return json(response, 200, this.platform.configuration.get("network")?.wifi || {});
    if (pathname === "/cfg/network/wifi" && method === "PATCH") {
      const network = this.platform.configuration.get("network") || {};
      return json(response, 200, this.platform.configuration.update("network", { ...network, wifi: { ...(network.wifi || {}), ...(await body(request)) } }));
    }
    if (pathname === "/cfg" && method === "GET") return json(response, 200, this.platform.configuration.getAll());
    if (pathname === "/cfg" && method === "DELETE") { this.platform.configuration.reset(); return noContent(response); }
    params = match(pathname, "/cfg/:section");
    if (params && ["button", "bt", "device", "display", "features", "haptic", "localization", "network", "power_saving", "profile", "software_update", "sound", "voice_control"].includes(params.section)) {
      if (method === "GET") return json(response, 200, this.platform.configuration.get(params.section));
      if (method === "PATCH") return json(response, 200, this.platform.configuration.update(params.section, await body(request)));
      if (method === "DELETE") return json(response, 200, this.platform.configuration.reset(params.section));
    }
    if (pathname === "/cfg/localization/tz_names" && method === "GET") return json(response, 200, Intl.supportedValuesOf?.("timeZone") || ["UTC"]);
    if (pathname === "/cfg/localization/countries" && method === "GET") return json(response, 200, [
      { code: "DE", name_en: "Germany" }, { code: "GB", name_en: "United Kingdom" }, { code: "US", name_en: "United States" }
    ]);
    if (pathname === "/cfg/localization/translations" && method === "GET") return json(response, 200, { version: "1", translations: [{ code: "en_US", name: "English" }] });
    if (pathname === "/cfg/voice_control/voice_assistants" && method === "GET") return json(response, 200, []);

    // Resources and empty virtual hardware surfaces
    if (pathname === "/resources" && method === "GET") return json(response, 200, Object.entries(RESOURCE_RULES).map(([type, rules]) => ({
      type: officialResourceType(type),
      description: { en: type === "icon" ? "Entity and profile icons. Exactly 90×90 pixels." : "Page background images. Exactly 480×275 pixels." },
      file_formats: ["png", "jpg", "jpeg", "webp"],
      max_file_size: rules.maxSize,
      max_count: 500,
      image: { width: rules.width, height: rules.height }
    })));
    if (pathname === "/resources" && method === "DELETE") return ok(response, { deleted: db.deleteResources(internalResourceType(url.searchParams.get("type"))) });
    params = match(pathname, "/resources/:type/:id");
    if (params && method === "GET") return binary(response, db.getResource(internalResourceType(params.type), params.id));
    if (params && method === "DELETE") return db.deleteResource(internalResourceType(params.type), params.id) ? ok(response) : json(response, 404, { code: "NOT_FOUND", message: "Resource not found" });
    params = match(pathname, "/resources/:type");
    if (params && method === "HEAD") return paginatedHead(response, db.listResources(internalResourceType(params.type)), url);
    if (params && method === "GET") {
      let items = db.listResources(internalResourceType(params.type));
      const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
      if (query) items = items.filter((item) => item.id.toLowerCase().includes(query));
      return paginated(response, items.map((item) => ({ type: officialResourceType(item.type), id: item.id, size: item.metadata?.size || 0 })), url);
    }
    if (params && method === "DELETE") return ok(response, { deleted: db.deleteResources(internalResourceType(params.type)) });
    if (params && method === "POST") {
      const resourceType = internalResourceType(params.type);
      const uploads = await multipartFiles(request);
      const records = [];
      for (const upload of uploads) {
        const declaredMimeType = String(upload.mimeType || "").toLowerCase();
        const mimeType = !declaredMimeType || declaredMimeType === "application/octet-stream"
          ? mimeFromFilename(upload.filename)
          : declaredMimeType;
        const resourceId = resourceIdFromFilename(upload.filename || `resource${extensionForMime(mimeType)}`);
        const metadata = validateResource(resourceType, upload.buffer, mimeType);
        const record = db.saveResource({ type: resourceType, id: resourceId, filename: resourceId, mime_type: mimeType, metadata, data: upload.buffer });
        this.platform.events.publish("resource.change", record);
        records.push({ type: officialResourceType(record.type), id: record.id, size: record.metadata?.size || upload.buffer.length });
      }
      return json(response, 201, records);
    }
    // Virtual Dock 2/3 and output services
    if (pathname === "/docks" && ["GET", "HEAD"].includes(method)) {
      const activeValue = url.searchParams.get("active");
      const active = activeValue === null ? undefined : activeValue === "true";
      const items = this.platform.docks.list(active);
      return method === "HEAD" ? paginatedHead(response, items, url) : paginated(response, items, url);
    }
    if (pathname === "/docks" && method === "POST") return json(response, 201, this.platform.docks.save(await body(request)));
    if (pathname === "/docks" && method === "PUT") return json(response, 200, this.platform.docks.connectionCommandAll(url.searchParams.get("cmd")));
    if (pathname === "/docks" && method === "DELETE") return json(response, 200, this.platform.docks.removeAll());
    if (pathname === "/docks/discover" && method === "GET") return json(response, 200, this.platform.docks.discovery());
    if (pathname === "/docks/discover" && method === "PUT") return json(response, 200, this.platform.docks.startDiscovery());
    if (pathname === "/docks/discover" && method === "DELETE") return json(response, 200, this.platform.docks.stopDiscovery());
    params = match(pathname, "/docks/discover/:id");
    if (params && method === "GET") { const item = this.platform.docks.discoveryDevice(params.id); return item ? json(response, 200, item) : json(response, 404, { code: "NOT_FOUND", message: "Discovered Dock not found" }); }
    if (params && method === "PUT") { const item = this.platform.docks.discoveryCommand(params.id, url.searchParams.get("cmd")); return item ? json(response, 200, item) : json(response, 404, { code: "NOT_FOUND", message: "Discovered Dock not found" }); }
    if (pathname === "/docks/setup" && method === "GET") return json(response, 200, { sessions: this.platform.docks.setupSessions() });
    if (pathname === "/docks/setup" && method === "POST") return json(response, 201, this.platform.docks.startSetup(await body(request)));
    if (pathname === "/docks/setup" && method === "DELETE") { for (const id of this.platform.docks.setupSessions()) this.platform.docks.stopSetup(id); return ok(response); }
    params = match(pathname, "/docks/setup/:id");
    if (params && method === "GET") { const item = this.platform.docks.setupInfo(params.id); return item ? json(response, 200, item) : json(response, 404, { code: "NOT_FOUND", message: "Dock setup not found" }); }
    if (params && method === "PUT") return json(response, 200, this.platform.docks.setupInfo(params.id) || this.platform.docks.startSetup({ manually: { id: params.id, ...(await body(request)) } }));
    if (params && method === "DELETE") return json(response, 200, this.platform.docks.stopSetup(params.id));
    params = match(pathname, "/docks/devices/:id/ports/:port/output");
    if (params && method === "POST") {
      const input = await body(request);
      const item = this.platform.docks.output(params.id, params.port, input.mode, input);
      return item ? json(response, 200, item) : json(response, 404, { code: "NOT_FOUND", message: "Dock or port not found" });
    }
    params = match(pathname, "/docks/devices/:id/ports/:port");
    if (params && method === "PATCH") {
      const item = this.platform.docks.updatePort(params.id, params.port, await body(request));
      return item ? json(response, 200, item) : json(response, 404, { code: "NOT_FOUND", message: "Dock or port not found" });
    }
    params = match(pathname, "/docks/devices/:id/command");
    if (params && method === "POST") { const item = this.platform.docks.command(params.id, await body(request)); return item ? json(response, 200, item) : json(response, 404, { code: "NOT_FOUND", message: "Dock not found" }); }
    params = match(pathname, "/docks/devices/:id/update");
    if (params && ["GET", "PUT"].includes(method)) { const item = this.platform.docks.updateCheck(params.id); return item ? json(response, 200, item) : json(response, 404, { code: "NOT_FOUND", message: "Dock not found" }); }
    if (params && method === "POST") { const item = this.platform.docks.startUpdate(params.id); return item ? json(response, 201, item) : json(response, 404, { code: "NOT_FOUND", message: "Dock not found" }); }
    if (params && method === "DELETE") return json(response, 200, this.platform.docks.abortUpdate(params.id));
    params = match(pathname, "/docks/devices/:id/update/:updateId");
    if (params && method === "GET") { const item = this.platform.docks.updateProgress(params.id, params.updateId); return item ? json(response, 200, item) : json(response, 404, { code: "NOT_FOUND", message: "Dock update not found" }); }
    params = match(pathname, "/docks/devices/:id/ir/send");
    if (params && ["GET", "POST"].includes(method)) {
      const emitter = this.platform.docks.emitters().find((item) => item.dock_id === params.id);
      if (!emitter) return json(response, 404, { code: "NOT_FOUND", message: "Dock IR emitter not found" });
      const input = method === "POST" ? await body(request) : Object.fromEntries(url.searchParams.entries());
      return json(response, 200, this.platform.docks.sendIr(emitter.emitter_id, input));
    }
    params = match(pathname, "/docks/devices/:id/outputs");
    if (params && method === "GET") return json(response, 200, this.platform.docks.outputLog(params.id, url.searchParams.get("limit") || 100));
    params = match(pathname, "/docks/devices/:id");
    if (params && method === "GET") { const item = this.platform.docks.get(params.id); return item ? json(response, 200, item) : json(response, 404, { code: "NOT_FOUND", message: "Dock not found" }); }
    if (params && method === "PATCH") { const item = this.platform.docks.update(params.id, await body(request)); return item ? json(response, 200, item) : json(response, 404, { code: "NOT_FOUND", message: "Dock not found" }); }
    if (params && method === "PUT") return json(response, 200, this.platform.docks.connectionCommand(params.id, url.searchParams.get("cmd") || (await body(request)).cmd) || { code: "OK" });
    if (params && method === "DELETE") return this.platform.docks.remove(params.id) ? ok(response) : json(response, 404, { code: "NOT_FOUND", message: "Dock not found" });

    const remoteKind = (item) => {
      const explicit = String(item.kind || item.options?.kind || "").toUpperCase();
      if (["BT", "IR", "EXTERNAL"].includes(explicit)) return explicit;
      if (item.bt || item.options?.bt) return "BT";
      if (item.integration_id && item.integration_id !== "uc.main") return "EXTERNAL";
      return "IR";
    };
    const remoteItems = () => {
      let items = db.listConfiguredEntities().filter((item) => item.entity_type === "remote");
      const requested = String(url.searchParams.get("kind") || "").toUpperCase();
      if (requested) items = items.filter((item) => remoteKind(item) === requested);
      return items.map((item) => ({ ...item, kind: remoteKind(item), options: { ...(item.options || {}), kind: remoteKind(item) } }));
    };
    if (pathname === "/remotes" && method === "HEAD") return paginatedHead(response, remoteItems(), url);
    if (pathname === "/remotes" && method === "GET") return paginated(response, remoteItems().map(coreEntity), url);
    if (pathname === "/remotes" && method === "POST") {
      const input = await body(request);
      const clone = input.clone_from ? db.getConfiguredEntity(input.clone_from) : null;
      if (input.clone_from && clone?.entity_type !== "remote") return json(response, 404, { code: "NOT_FOUND", message: "Source remote not found" });
      if (!input.name && !clone?.name) return json(response, 400, { code: "INV_ARGUMENT", message: "Remote name is required" });
      const internalOwner = db.getIntegration("uc.main");
      const internalMetadata = {
        ...(internalOwner?.metadata || {}),
        internal: true,
        hidden: true,
        name: { en: "UC Virtual Remote" },
        version: this.platform.version
      };
      if (!internalOwner) db.saveIntegration({
        id: "uc.main", driver_id: "uc", name: "UC Virtual Remote", url: "virtual://core", enabled: false,
        status: "CONNECTED", device_state: "CONNECTED", driver_type: "INTERNAL", driver_version: this.platform.version,
        configured: true, metadata: internalMetadata
      });
      else db.updateIntegration("uc.main", {
        name: "UC Virtual Remote", url: "virtual://core", enabled: false, status: "CONNECTED", device_state: "CONNECTED",
        driver_id: "uc", driver_type: "INTERNAL", driver_version: this.platform.version, configured: true, metadata: internalMetadata
      });
      const localId = `remote.${slug(displayName(input.name || clone?.name, `remote-${Date.now()}`), `remote-${Date.now()}`)}`;
      let ir = structuredClone(clone?.options?.ir || {});
      if (input.codeset_id) ir = { ...ir, codeset: { id: input.codeset_id }, commands: { ...(this.platform.docks.codeSet(input.codeset_id)?.codes || {}) } };
      if (input.custom_codeset) {
        const setId = slug(`${input.custom_codeset.manufacturer_id || "custom"}-${input.custom_codeset.device_name}`, `custom-${Date.now()}`);
        this.platform.docks.saveCodeSet(setId, {
          name: input.custom_codeset.device_name, metadata: { manufacturer: input.custom_codeset.manufacturer_id || "custom", device_type: input.custom_codeset.device_type || "various" }, codes: {}
        }, false);
        ir = { ...ir, codeset: { id: setId }, commands: {} };
      }
      const available = {
        entity_id: localId, entity_type: "remote", name: input.name || clone?.name, icon: input.icon || clone?.icon || "uc:remote",
        description: input.description || clone?.description, features: clone?.features || ["send_cmd"],
        options: {
          ...(clone?.options || {}), ...(input.options || {}),
          kind: String(input.kind || input.options?.kind || clone?.options?.kind || "IR").toUpperCase(),
          ...(input.bt !== undefined ? { bt: input.bt } : clone?.options?.bt ? { bt: clone.options.bt } : {}),
          ...(String(input.kind || input.options?.kind || clone?.options?.kind || "IR").toUpperCase() === "IR" ? { ir } : {}),
          button_mapping: normalizeButtonMappings(clone?.options?.button_mapping)
        }
      };
      db.upsertAvailableEntity("uc.main", available);
      const value = db.configureEntity("uc.main", localId, available);
      this.platform.events.publish("entity.created", value);
      return json(response, 201, coreEntity(value));
    }
    if (pathname === "/remotes" && method === "DELETE") {
      for (const remote of remoteItems()) { db.deleteConfiguredEntity(remote.entity_id); this.platform.events.publish("entity.deleted", { id: remote.entity_id }); }
      return ok(response);
    }

    params = match(pathname, "/remotes/:id/ui/pages/:page");
    if (params) {
      const remote = db.getConfiguredEntity(params.id);
      if (!remote || remote.entity_type !== "remote") return json(response, 404, { code: "NOT_FOUND", message: "Remote not found" });
      const pages = Array.isArray(remote.options?.user_interface?.pages) ? [...remote.options.user_interface.pages] : [];
      const index = pages.findIndex((item) => String(item.page_id || item.id) === params.page);
      if (method === "GET") return index >= 0 ? json(response, 200, pages[index]) : json(response, 404, { code: "NOT_FOUND", message: "Remote page not found" });
      if (["PUT", "PATCH"].includes(method)) {
        const input = await body(request);
        const value = { ...(index >= 0 ? pages[index] : {}), ...input, page_id: params.page };
        if (index >= 0) pages[index] = value; else pages.push(value);
        const updated = db.updateConfiguredEntity(params.id, { options: { ...remote.options, user_interface: { ...(remote.options?.user_interface || {}), pages } } });
        return json(response, index >= 0 ? 200 : 201, value, { "X-Entity-Id": updated.entity_id });
      }
      if (method === "DELETE") {
        if (index < 0) return json(response, 404, { code: "NOT_FOUND", message: "Remote page not found" });
        pages.splice(index, 1);
        db.updateConfiguredEntity(params.id, { options: { ...remote.options, user_interface: { ...(remote.options?.user_interface || {}), pages } } });
        return ok(response);
      }
    }
    params = match(pathname, "/remotes/:id/ui/pages");
    if (params) {
      const remote = db.getConfiguredEntity(params.id);
      if (!remote || remote.entity_type !== "remote") return json(response, 404, { code: "NOT_FOUND", message: "Remote not found" });
      const pages = Array.isArray(remote.options?.user_interface?.pages) ? [...remote.options.user_interface.pages] : [];
      if (method === "GET") return json(response, 200, pages);
      if (method === "POST") {
        const input = await body(request);
        const pageId = String(input.page_id || input.id || `page-${crypto.randomUUID()}`);
        const value = { ...input, page_id: pageId };
        pages.push(value);
        db.updateConfiguredEntity(params.id, { options: { ...remote.options, user_interface: { ...(remote.options?.user_interface || {}), pages } } });
        return json(response, 201, value);
      }
      if (method === "PATCH") {
        const order = (await body(request)).page_order || [];
        const byId = new Map(pages.map((page) => [String(page.page_id || page.id), page]));
        const reordered = [...order.map((id) => byId.get(String(id))).filter(Boolean), ...pages.filter((page) => !order.map(String).includes(String(page.page_id || page.id)))];
        db.updateConfiguredEntity(params.id, { options: { ...remote.options, user_interface: { ...(remote.options?.user_interface || {}), pages: reordered } } });
        return json(response, 200, reordered);
      }
      if (method === "DELETE") {
        db.updateConfiguredEntity(params.id, { options: { ...remote.options, user_interface: { ...(remote.options?.user_interface || {}), pages: [] } } });
        return ok(response);
      }
    }
    params = match(pathname, "/remotes/:id/ui");
    if (params) {
      const remote = db.getConfiguredEntity(params.id);
      if (!remote || remote.entity_type !== "remote") return json(response, 404, { code: "NOT_FOUND", message: "Remote not found" });
      if (method === "GET") return json(response, 200, remote.options?.user_interface || { pages: [] });
      if (["PUT", "PATCH"].includes(method)) {
        const input = await body(request);
        const value = method === "PUT" ? input : { ...(remote.options?.user_interface || {}), ...input };
        db.updateConfiguredEntity(params.id, { options: { ...remote.options, user_interface: value } });
        return json(response, 200, value);
      }
      if (method === "DELETE") {
        const options = { ...remote.options }; delete options.user_interface;
        db.updateConfiguredEntity(params.id, { options });
        return ok(response);
      }
    }
    params = match(pathname, "/remotes/:id/ir/:command");
    if (params) {
      const remote = db.getConfiguredEntity(params.id);
      if (!remote || remote.entity_type !== "remote") return json(response, 404, { code: "NOT_FOUND", message: "Remote not found" });
      const ir = { ...(remote.options?.ir || {}) };
      const commands = { ...(ir.commands || {}) };
      const current = commands[params.command];
      if (method === "GET") {
        if (!current) return json(response, 404, { code: "NOT_FOUND", message: "IR command not found" });
        const value = typeof current === "string" ? { key: params.command, format: "PRONTO", value: current } : { key: params.command, format: current.format || "PRONTO", value: current.value || current.code || "" };
        return json(response, 200, value);
      }
      if (["POST", "PATCH"].includes(method)) {
        const input = await body(request);
        if (!input.value || !input.format) return json(response, 400, { code: "INV_ARGUMENT", message: "IR value and format are required" });
        commands[params.command] = { key: params.command, format: String(input.format).toUpperCase(), value: String(input.value) };
        const value = db.updateConfiguredEntity(params.id, { options: { ...remote.options, ir: { ...ir, commands } } });
        this.platform.events.publish("entity.updated", value);
        return json(response, 200, commands[params.command]);
      }
      if (method === "DELETE") {
        if (!current) return json(response, 404, { code: "NOT_FOUND", message: "IR command not found" });
        delete commands[params.command];
        db.updateConfiguredEntity(params.id, { options: { ...remote.options, ir: { ...ir, commands } } });
        return ok(response);
      }
    }

    params = match(pathname, "/remotes/:id/bt/pairing");
    if (params) {
      const remote = db.getConfiguredEntity(params.id);
      const kind = remote ? remoteKind(remote) : null;
      if (!remote || remote.entity_type !== "remote" || kind !== "BT") return json(response, 404, { code: "NOT_FOUND", message: "Bluetooth remote not found" });
      const settingKey = `bluetooth_pairing.${params.id}`;
      const fallback = {
        enabled: false, paired: false, state: "IDLE", peer: null,
        advertisement_name: displayName(remote.name, "UC Virtual Remote")
      };
      if (method === "GET") {
        const persisted = { ...fallback, ...db.getSetting(settingKey, {}) };
        const live = this.platform.hardware.bluetoothPairingStatus?.();
        const value = live ? { ...persisted, ...live } : persisted;
        if (live && JSON.stringify(value) !== JSON.stringify(persisted)) db.setSetting(settingKey, value);
        return json(response, 200, value);
      }
      if (method === "PUT") {
        const enabled = ["true", "1", "yes", "on"].includes(String(url.searchParams.get("enabled") || "true").toLowerCase());
        const input = await body(request).catch(() => ({}));
        const value = await this.platform.hardware.setBluetoothPairing(enabled, input.advertisement_name || fallback.advertisement_name);
        db.setSetting(settingKey, value);
        return json(response, 200, value);
      }
      if (method === "POST") {
        const input = await body(request);
        const current = { ...fallback, ...db.getSetting(settingKey, {}) };
        const value = {
          ...current, ...input,
          paired: Boolean(input.paired ?? current.paired),
          state: input.paired ? "PAIRED" : (current.enabled ? "PAIRING" : "IDLE"),
          peer: input.peer || current.peer || (input.address ? { address: input.address, name: input.name } : null)
        };
        db.setSetting(settingKey, value);
        this.platform.events.publish("bluetooth.pairing", {
          msg: value.paired ? "bt_pairing_complete" : "bt_pairing_auth_request",
          success: Boolean(value.paired),
          ...value
        });
        return json(response, 200, value);
      }
      if (method === "DELETE") {
        const current = db.getSetting(settingKey, {});
        const value = await this.platform.hardware.clearBluetoothPairing(current.peer?.address);
        db.setSetting(settingKey, { ...fallback, ...value });
        return ok(response);
      }
    }

    for (const section of ["ir", "bt"]) {
      params = match(pathname, `/remotes/:id/${section}`);
      if (!params) continue;
      const remote = db.getConfiguredEntity(params.id);
      if (!remote || remote.entity_type !== "remote") return json(response, 404, { code: "NOT_FOUND", message: "Remote not found" });
      if (method === "GET") return json(response, 200, remote.options?.[section] ?? remote[section] ?? null);
      if (["PUT", "PATCH"].includes(method)) {
        const input = await body(request);
        const value = method === "PATCH" && remote.options?.[section] && typeof remote.options[section] === "object"
          ? { ...remote.options[section], ...input }
          : input;
        db.updateConfiguredEntity(params.id, { options: { ...remote.options, [section]: value } });
        return json(response, 200, value);
      }
      if (method === "DELETE") {
        const options = { ...remote.options }; delete options[section];
        db.updateConfiguredEntity(params.id, { options });
        return ok(response);
      }
    }

    params = match(pathname, "/remotes/:id/buttons/:button/:press");
    if (params) {
      const remote = db.getConfiguredEntity(params.id);
      if (!remote || remote.entity_type !== "remote") return json(response, 404, { code: "NOT_FOUND", message: "Remote not found" });
      const mappings = normalizeButtonMappings(remote.options?.button_mapping);
      const mapping = mappings.find((item) => item.button === params.button);
      if (method === "GET") {
        const value = mapping?.[params.press];
        return value !== undefined ? json(response, 200, value) : json(response, 404, { code: "NOT_FOUND", message: "Button press mapping not found" });
      }
      if (method === "DELETE") {
        if (mapping) delete mapping[params.press];
        const value = db.updateConfiguredEntity(params.id, { options: { ...remote.options, button_mapping: normalizeButtonMappings(mappings) } });
        return json(response, 200, coreEntity(value));
      }
    }
    params = match(pathname, "/remotes/:id/buttons/:button");
    if (params) {
      const remote = db.getConfiguredEntity(params.id);
      if (!remote || remote.entity_type !== "remote") return json(response, 404, { code: "NOT_FOUND", message: "Remote not found" });
      const mappings = normalizeButtonMappings(remote.options?.button_mapping);
      const index = mappings.findIndex((item) => item.button === params.button);
      if (method === "GET") return json(response, 200, index >= 0 ? mappings[index] : { button: params.button });
      if (method === "PATCH") {
        const input = await body(request);
        if (index < 0) mappings.push({ button: params.button, ...input });
        else mappings[index] = { ...mappings[index], ...input, button: params.button };
        const value = db.updateConfiguredEntity(params.id, {
          options: { ...remote.options, button_mapping: normalizeButtonMappings(mappings) }
        });
        return json(response, 200, coreEntity(value));
      }
      if (method === "DELETE") {
        if (index >= 0) mappings[index] = { button: params.button };
        const value = db.updateConfiguredEntity(params.id, {
          options: { ...remote.options, button_mapping: normalizeButtonMappings(mappings) }
        });
        return json(response, 200, coreEntity(value));
      }
    }
    params = match(pathname, "/remotes/:id/buttons");
    if (params) {
      const remote = db.getConfiguredEntity(params.id);
      if (!remote || remote.entity_type !== "remote") return json(response, 404, { code: "NOT_FOUND", message: "Remote not found" });
      if (method === "GET") return json(response, 200, normalizeButtonMappings(remote.options?.button_mapping));
      if (method === "POST") {
        const mappings = await body(request);
        const value = db.updateConfiguredEntity(params.id, {
          options: { ...remote.options, button_mapping: normalizeButtonMappings(mappings) }
        });
        return json(response, 200, coreEntity(value));
      }
      if (method === "PATCH") {
        const incoming = await body(request);
        const map = new Map(normalizeButtonMappings(remote.options?.button_mapping).map((item) => [item.button, item]));
        for (const item of Array.isArray(incoming) ? incoming : []) {
          if (!item?.button) continue;
          map.set(item.button, { ...(map.get(item.button) || {}), ...item, button: item.button });
        }
        const value = db.updateConfiguredEntity(params.id, {
          options: { ...remote.options, button_mapping: normalizeButtonMappings([...map.values()]) }
        });
        return json(response, 200, coreEntity(value));
      }
      if (method === "DELETE") {
        const value = db.updateConfiguredEntity(params.id, {
          options: { ...remote.options, button_mapping: normalizeButtonMappings() }
        });
        return json(response, 200, coreEntity(value));
      }
    }
    params = match(pathname, "/remotes/:id");
    if (params && method === "GET") {
      const remote = db.getConfiguredEntity(params.id);
      return remote?.entity_type === "remote" ? json(response, 200, coreEntity(remote)) : json(response, 404, { code: "NOT_FOUND", message: "Remote not found" });
    }
    if (params && method === "PATCH") {
      const remote = db.getConfiguredEntity(params.id);
      if (!remote || remote.entity_type !== "remote") return json(response, 404, { code: "NOT_FOUND", message: "Remote not found" });
      const input = await body(request);
      const mergedOptions = {
        ...(remote.options || {}), ...(input.options || {}),
        ...(input.kind !== undefined ? { kind: String(input.kind).toUpperCase() } : {}),
        ...(input.bt !== undefined ? { bt: input.bt } : {}),
        ...(input.ir !== undefined ? { ir: input.ir } : {}),
        ...(input.options?.ir ? { ir: { ...(remote.options?.ir || {}), ...input.options.ir } } : {})
      };
      const value = db.updateConfiguredEntity(params.id, { ...input, options: mergedOptions });
      this.platform.events.publish("entity.updated", value);
      return json(response, 200, coreEntity(value));
    }
    if (params && method === "DELETE") {
      const remote = db.getConfiguredEntity(params.id);
      if (!remote || remote.entity_type !== "remote") return json(response, 404, { code: "NOT_FOUND", message: "Remote not found" });
      db.deleteConfiguredEntity(params.id);
      this.platform.events.publish("entity.deleted", { id: params.id });
      return ok(response);
    }

    params = match(pathname, "/ir/convert/:format");
    if (params && method === "GET") {
      return json(response, 200, convertIrCode(params.format, url.searchParams.get("code"), {
        to: url.searchParams.get("to") || "RAW", repeat: url.searchParams.get("repeat") || 0
      }));
    }

    // IR database, emitters and learning
    if (pathname === "/ir/emitters" && ["GET", "HEAD"].includes(method)) {
      const items = this.platform.docks.emitters();
      return method === "HEAD" ? paginatedHead(response, items, url) : paginated(response, items, url);
    }
    params = match(pathname, "/ir/emitters/:id");
    if (params && method === "GET") { const item = this.platform.docks.emitter(params.id); return item ? json(response, 200, item) : json(response, 404, { code: "NOT_FOUND", message: "IR emitter not found" }); }
    params = match(pathname, "/ir/emitters/:id/send");
    if (params && method === "PUT") return json(response, 200, this.platform.docks.sendIr(params.id, await body(request)));
    params = match(pathname, "/ir/emitters/:id/stop_send");
    if (params && method === "PUT") { const item = this.platform.docks.stopIr(params.id, await body(request)); return item ? json(response, 200, item) : json(response, 404, { code: "NOT_FOUND", message: "IR emitter not found" }); }
    params = match(pathname, "/ir/emitters/:id/learn/result");
    if (params && method === "POST") return json(response, 200, this.platform.docks.injectLearned(params.id, await body(request)));
    params = match(pathname, "/ir/emitters/:id/learn");
    if (params && method === "GET") return json(response, 200, this.platform.docks.learnStatus(params.id));
    if (params && method === "PUT") return json(response, 200, this.platform.docks.startLearn(params.id, url.searchParams.get("timeout") || 60));
    if (params && method === "DELETE") return json(response, 200, this.platform.docks.stopLearn(params.id));
    if (pathname === "/ir/codes/manufacturers" && ["GET", "HEAD"].includes(method)) {
      const items = this.platform.docks.manufacturers(url.searchParams.get("q") || "");
      return method === "HEAD" ? paginatedHead(response, items, url) : paginated(response, items, url);
    }
    params = match(pathname, "/ir/codes/manufacturers/:manufacturer/:set");
    if (params && method === "GET") { const item = this.platform.docks.codeSet(params.set); return item && item.manufacturer_id === params.manufacturer ? json(response, 200, Object.keys(item.codes)) : json(response, 404, { code: "NOT_FOUND", message: "IR code set not found" }); }
    params = match(pathname, "/ir/codes/manufacturers/:manufacturer");
    if (params && ["GET", "HEAD"].includes(method)) {
      const items = this.platform.docks.codeSets(params.manufacturer, url.searchParams.get("q") || "");
      return method === "HEAD" ? paginatedHead(response, items, url) : paginated(response, items, url);
    }
    if (pathname === "/ir/codes/custom" && ["GET", "HEAD"].includes(method)) {
      const sets = this.platform.docks.customCodeSets();
      if (method === "HEAD") return paginatedHead(response, sets, url);
      const wantsCsv = /text\/csv/i.test(String(request.headers.accept || request.headers["content-type"] || "")) || url.searchParams.get("format") === "csv";
      if (!wantsCsv) return paginated(response, sets.map((set) => ({ code_set_id: set.code_set_id, name: set.name, manufacturer: set.metadata?.manufacturer || "custom", device_type: set.metadata?.device_type })), url);
      const csv = ["manufacturer,device,key,format,code", ...sets.flatMap((set) => Object.entries(set.codes).map(([command, value]) => `${JSON.stringify(set.metadata?.manufacturer || "custom")},${JSON.stringify(set.name)},${command},${typeof value === "object" ? value.format || "PRONTO" : "PRONTO"},${JSON.stringify(typeof value === "string" ? value : value.code || "")}`))].join("\n");
      return text(response, 200, csv, "text/csv; charset=utf-8", { "Content-Disposition": 'attachment; filename="uc-ir-codes.csv"' });
    }
    if (pathname === "/ir/codes/custom" && method === "POST") {
      const input = await body(request);
      const id = input.code_set_id || input.id || input.name;
      if (!id) return json(response, 400, { code: "INV_ARGUMENT", message: "code_set_id or name is required" });
      return json(response, 201, this.platform.docks.saveCodeSet(id, {
        name: input.name || id,
        metadata: { manufacturer: input.manufacturer || "custom", device_type: input.device_type, ...(input.metadata || {}) },
        codes: input.codes || {}
      }, false));
    }
    if (pathname === "/ir/codes/custom" && method === "DELETE") return json(response, 200, this.platform.docks.deleteAllCustomCodeSets());
    params = match(pathname, "/ir/codes/custom/:set/:key");
    if (params && method === "GET") { const set = this.platform.docks.codeSet(params.set); return set?.codes?.[params.key] ? json(response, 200, set.codes[params.key]) : json(response, 404, { code: "NOT_FOUND", message: "IR code not found" }); }
    if (params && ["POST", "PUT", "PATCH"].includes(method)) { const result = this.platform.docks.saveCode(params.set, params.key, await body(request)); return result ? json(response, method === "POST" ? 201 : 200, result) : json(response, 404, { code: "NOT_FOUND", message: "Code set not found" }); }
    if (params && method === "DELETE") return this.platform.docks.deleteCode(params.set, params.key) ? ok(response) : json(response, 404, { code: "NOT_FOUND", message: "IR code not found" });
    params = match(pathname, "/ir/codes/custom/:set");
    if (params && method === "GET") {
      const set = this.platform.docks.codeSet(params.set);
      if (!set) return json(response, 404, { code: "NOT_FOUND", message: "Code set not found" });
      const wantsCsv = /text\/csv/i.test(String(request.headers.accept || request.headers["content-type"] || "")) || url.searchParams.get("format") === "csv";
      if (!wantsCsv) return json(response, 200, set);
      const csv = ["key,format,code", ...Object.entries(set.codes).map(([command, value]) => `${command},${typeof value === "object" ? value.format || "PRONTO" : "PRONTO"},${JSON.stringify(typeof value === "string" ? value : value.code || "")}`)].join("\n");
      return text(response, 200, csv, "text/csv; charset=utf-8", { "Content-Disposition": `attachment; filename="${params.set}.csv"` });
    }
    if (params && method === "POST") {
      const upload = await multipartFile(request);
      const lines = upload.buffer.toString("utf8").split(/\r?\n/).filter(Boolean);
      const headers = String(lines[0] || "").split(",").map((item) => item.trim().toLowerCase());
      const keyIndex = Math.max(0, headers.indexOf("key") >= 0 ? headers.indexOf("key") : headers.indexOf("command"));
      const formatIndex = headers.indexOf("format");
      const codeIndex = headers.indexOf("code") >= 0 ? headers.indexOf("code") : Math.max(2, headers.length - 1);
      const existing = this.platform.docks.codeSet(params.set);
      const codes = { ...(existing?.codes || {}) };
      for (const line of lines.slice(1)) {
        const fields = line.split(",");
        const command = String(fields[keyIndex] || "").trim().replace(/[^a-zA-Z0-9\-_.]/g, "_");
        const code = fields.slice(codeIndex).join(",").replace(/^"|"$/g, "");
        if (command && code) codes[command] = { format: String(fields[formatIndex] || "PRONTO").trim() || "PRONTO", code };
      }
      return json(response, existing ? 200 : 201, this.platform.docks.saveCodeSet(params.set, { name: existing?.name || params.set, metadata: { ...(existing?.metadata || {}), comment: url.searchParams.get("comment") || existing?.metadata?.comment || "" }, codes }, true));
    }
    if (params && method === "PATCH") return json(response, 200, this.platform.docks.saveCodeSet(params.set, await body(request), true));
    if (params && method === "DELETE") return this.platform.docks.deleteCodeSet(params.set) ? ok(response) : json(response, 404, { code: "NOT_FOUND", message: "Code set not found" });

    // System information, custom components, application updates, backup and power
    if (pathname === "/system/install" && method === "GET") {
      const web = this.platform.webConfigurator.status();
      const ui = db.getSetting("custom_component_ui", { installed: false, active: false });
      return json(response, 200, [
        { component: "ui", installed: Boolean(ui.installed), active: Boolean(ui.active), ...(ui.installation_date ? { installation_date: ui.installation_date, release: ui.release } : {}) },
        { component: "web_configurator", installed: Boolean(web.installed), active: Boolean(web.installed), immutable: true, bundled: true, ...(web.installed ? { installation_date: web.published_at, release: { name: { en: "Unfolded.Tools community Web Configurator" }, version: web.version, description: { en: "Unofficial source-built community edition based on the public Web Configurator 2.3.3 source" } } } : {}) }
      ]);
    }
    params = match(pathname, "/system/install/:component");
    if (params) {
      if (!["ui", "web_configurator"].includes(params.component)) return json(response, 404, { code: "NOT_FOUND", message: "Custom component not found" });
      if (method === "GET") {
        if (params.component === "web_configurator") {
          const status = this.platform.webConfigurator.status();
          return json(response, 200, {
            component: params.component,
            installed: status.installed,
            active: status.installed,
            immutable: true,
            bundled: true,
            release: status.installed ? {
              name: { en: "Unfolded.Tools community Web Configurator" },
              version: status.version,
              source: status.source,
              upstream_version: status.upstream_version
            } : undefined
          });
        }
        const state = db.getSetting("custom_component_ui", { installed: false, active: false });
        return json(response, 200, { component: "ui", ...state });
      }
      if (["POST", "PUT", "DELETE"].includes(method) && params.component === "web_configurator") {
        response.setHeader("Allow", "GET");
        return json(response, 405, {
          code: "IMMUTABLE_COMPONENT",
          message: "The bundled community Web Configurator cannot be uploaded, replaced, or removed at runtime."
        });
      }
      if (["POST", "PUT"].includes(method)) {
        const upload = await multipartFile(request, MAX_CONFIGURATOR_ARCHIVE);
        const directory = path.join(this.platform.dataDir, "custom-components");
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, "ui.zip"), upload.buffer);
        const state = { installed: true, active: method === "PUT", installation_date: new Date().toISOString(), release: { name: { en: upload.filename || "Custom Remote UI" }, version: "custom" } };
        db.setSetting("custom_component_ui", state);
        return json(response, 200, { component: "ui", ...state });
      }
      if (method === "DELETE") {
        fs.rmSync(path.join(this.platform.dataDir, "custom-components", "ui.zip"), { force: true });
        db.setSetting("custom_component_ui", { installed: false, active: false });
        return ok(response);
      }
    }

    if (pathname === "/system/update" && ["GET", "PUT"].includes(method)) {
      return json(response, 200, await this.platform.systemUpdate.check(method === "PUT"));
    }
    params = match(pathname, "/system/update/:id");
    if (params && method === "GET") {
      const progress = this.platform.systemUpdate.progress(params.id);
      return progress ? json(response, 200, progress) : json(response, 404, { code: "NOT_FOUND", message: "System update not found" });
    }
    if (params && method === "POST") return json(response, 201, await this.platform.systemUpdate.action(params.id));
    if (pathname === "/system" && method === "GET") return json(response, 200, {
      model_name: "Virtual Unfolded Circle Remote", model_number: "UCR3-VIRTUAL",
      serial_number: this.platform.id, hw_revision: "virtual-1", version: this.platform.version
    });
    if (pathname === "/system" && method === "POST") {
      const command = String(url.searchParams.get("cmd") || "").toUpperCase();
      if (command === "REBOOT") {
        setTimeout(() => {
          log.info("Configurator requested application restart");
          this.platform.events.publish("system.restart", { reason: "configurator_reboot", exit_code: 75 });
        }, 100);
      }
      return noContent(response);
    }
    if (pathname === "/system/logs/boots" && method === "GET") return json(response, 200, logBoots());
    if (pathname === "/system/logs/services" && method === "GET") return json(response, 200, logServices(this.platform.externalIntegrations.services()));
    if (pathname === "/system/logs" && method === "GET") {
      const query = Object.fromEntries(url.searchParams.entries());
      const externalRecords = await this.platform.externalIntegrations.logRecords(query);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      return text(response, 200, queryLogs(query, externalRecords), "text/plain; charset=utf-8", {
        "Content-Disposition": `attachment; filename="virtual-remote-core-logs-${stamp}.txt"`
      });
    }
    if (pathname === "/system/factory_reset" && method === "GET") return json(response, 200, this.platform.factoryReset.issueToken());
    if (pathname === "/system/factory_reset" && method === "POST") {
      const input = await body(request).catch(() => ({}));
      return json(response, 202, this.platform.factoryReset.schedule(input.token || url.searchParams.get("token")));
    }
    if (pathname === "/system/backup/snapshots" && method === "GET") return json(response, 200, this.platform.systemBackup.listSnapshots());
    if (pathname === "/system/backup/snapshots" && method === "POST") return json(response, 201, this.platform.systemBackup.createSnapshot());
    if (pathname === "/system/backup/snapshots" && method === "DELETE") {
      const deleted = this.platform.systemBackup.deleteAllSnapshots();
      return ok(response, { deleted });
    }
    params = match(pathname, "/system/backup/snapshots/:id");
    if (params && method === "GET") {
      const item = this.platform.systemBackup.getSnapshot(params.id);
      if (!item) return json(response, 404, { code: "NOT_FOUND", message: "Backup snapshot not found" });
      if (/application\/octet-stream/i.test(String(request.headers.accept || "")) || url.searchParams.get("download") === "true") {
        return text(response, 200, fs.readFileSync(item.path), "application/octet-stream", { "Content-Disposition": `attachment; filename="${item.id}.backup"` });
      }
      return json(response, 200, this.platform.systemBackup.snapshotMetadata(params.id));
    }
    if (params && method === "PUT") return json(response, 200, { code: "OK", restored: true, ...this.platform.systemBackup.restoreSnapshot(params.id, { merge: url.searchParams.get("merge") === "true" }) });
    if (params && method === "DELETE") return this.platform.systemBackup.deleteSnapshot(params.id) ? ok(response) : json(response, 404, { code: "NOT_FOUND", message: "Backup snapshot not found" });

    if (pathname === "/system/backup/export" && method === "GET") {
      const archive = this.platform.systemBackup.exportArchive();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      return text(response, 200, archive, "application/octet-stream", {
        "Content-Disposition": `attachment; filename="UCR3_${stamp}.backup"`
      });
    }
    if (pathname === "/system/backup/restore" && method === "PUT") {
      const upload = await multipartFile(request, 512 * 1024 * 1024);
      const result = this.platform.systemBackup.restore(upload.buffer, { merge: url.searchParams.get("merge") === "true", filename: upload.filename });
      return json(response, 200, { code: "OK", restored: true, format: result.format });
    }
    if (pathname === "/system/power" && method === "GET") return json(response, 200, db.getSetting("power_mode", {
      mode: "ON", battery: { capacity: 100, status: "CHARGING" }
    }));
    if (pathname === "/system/power" && method === "PUT") {
      const input = await body(request);
      const value = { ...db.getSetting("power_mode", {}), ...input };
      db.setSetting("power_mode", value);
      return json(response, 200, value);
    }
    if (pathname === "/system/power/standby_inhibitors" && method === "GET") return json(response, 200, db.getSetting("standby_inhibitors", []));
    if (pathname === "/system/power/standby_inhibitors" && method === "DELETE") { db.setSetting("standby_inhibitors", []); return ok(response); }
    if (pathname === "/system/power/standby_inhibitors" && method === "POST") {
      const input = await body(request);
      const values = db.getSetting("standby_inhibitors", []);
      const inhibitorId = String(input.id || crypto.randomUUID());
      const existingIndex = values.findIndex((item) => item.id === inhibitorId);
      const previous = existingIndex >= 0 ? values[existingIndex] : null;
      const item = {
        ...(previous || {}),
        id: inhibitorId, who: String(input.who || previous?.who || "REST API client"), why: String(input.why ?? previous?.why ?? ""),
        mode: Number(input.delay) > 0 ? "DELAY" : "BLOCK",
        ...(Number(input.delay) > 0 ? { delay: Number(input.delay) } : {}),
        created: previous?.created ?? 0, created_at: previous?.created_at || new Date().toISOString(),
        refreshed_at: new Date().toISOString()
      };
      if (item.mode !== "DELAY") delete item.delay;
      if (existingIndex >= 0) values[existingIndex] = item;
      else values.push(item);
      db.setSetting("standby_inhibitors", values);
      return json(response, existingIndex >= 0 ? 200 : 201, item);
    }
    params = match(pathname, "/system/power/standby_inhibitors/:id");
    if (params && method === "DELETE") {
      const values = db.getSetting("standby_inhibitors", []).filter((item) => item.id !== params.id);
      db.setSetting("standby_inhibitors", values);
      return ok(response);
    }
    if (pathname === "/system/power/battery" && method === "GET") return json(response, 200, { capacity: 100, status: "CHARGING" });
    if (pathname === "/system/sensors/ambient_light" && method === "GET") return json(response, 200, { intensity: Math.max(0, Math.min(65535, Number(db.getSetting("ambient_light", 0)) || 0)) });
    if (pathname === "/system/wifi" && method === "GET") return json(response, 200, await this.platform.hardware.wifiStatus());
    if (pathname === "/system/wifi" && method === "PUT") return json(response, 200, await this.platform.hardware.wifiCommand(url.searchParams.get("cmd")));
    if (pathname === "/system/wifi/scan" && method === "GET") return json(response, 200, this.platform.hardware.wifiScanStatus());
    if (pathname === "/system/wifi/scan" && method === "PUT") {
      this.platform.hardware.scanWifi().catch((error) => log.warn("Wi-Fi scan failed:", error.message));
      return json(response, 200, this.platform.hardware.wifiScanStatus());
    }
    if (pathname === "/system/wifi/scan" && method === "DELETE") return json(response, 200, this.platform.hardware.stopWifiScan());
    if (pathname === "/system/wifi/networks" && method === "GET") return json(response, 200, this.platform.hardware.savedWifiNetworks().map(({ password: _password, ...item }) => item));
    if (pathname === "/system/wifi/networks" && method === "POST") return json(response, 201, await this.platform.hardware.addWifiNetwork(await body(request)));
    if (pathname === "/system/wifi/networks" && method === "DELETE") { await this.platform.hardware.deleteAllWifiNetworks(); return ok(response); }
    params = match(pathname, "/system/wifi/networks/:id");
    if (params && method === "GET") {
      const item = this.platform.hardware.getWifiNetwork(params.id);
      return item ? json(response, 200, item) : json(response, 404, { code: "NOT_FOUND", message: "Wi-Fi network not found" });
    }
    if (params && method === "PATCH") {
      const item = await this.platform.hardware.updateWifiNetwork(params.id, await body(request));
      return item ? ok(response) : json(response, 404, { code: "NOT_FOUND", message: "Wi-Fi network not found" });
    }
    if (params && method === "PUT") {
      const item = await this.platform.hardware.wifiNetworkCommand(params.id, url.searchParams.get("cmd"));
      return item ? ok(response) : json(response, 404, { code: "NOT_FOUND", message: "Wi-Fi network not found" });
    }
    if (params && method === "DELETE") return await this.platform.hardware.deleteWifiNetwork(params.id) ? ok(response) : json(response, 404, { code: "NOT_FOUND", message: "Wi-Fi network not found" });

    return json(response, 404, { error: "Not found" });
  }

  #webConfiguratorStatic(response, pathname) {
    const status = this.platform.webConfigurator.status();
    if (!status.installed) {
      const payload = Buffer.from(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Community Web Configurator unavailable</title><style>body{font:16px system-ui;background:#141719;color:#eef2f1;max-width:760px;margin:10vh auto;padding:24px}code{background:#252a2c;padding:.2em .4em;border-radius:5px}a{color:#80b8aa}</style></head><body><h1>Bundled Web Configurator unavailable</h1><p>This UC Virtual Remote image is expected to include the Unfolded.Tools community build based on the public Web Configurator 2.3.3 source.</p><p>Reinstall or rebuild the application image. Runtime bundle uploads are intentionally unsupported.</p><p><a href="https://unfolded.tools/remote-simulator/licensing/source/">Corresponding source and build information</a></p></body></html>`);
      response.writeHead(503, { "Content-Type": "text/html; charset=utf-8", "Content-Length": payload.length, "Cache-Control": "no-store" });
      return response.end(payload);
    }
    const relative = pathname.replace(/^\/configurator\/?/, "");
    const target = this.platform.webConfigurator.resolve(relative || "index.html");
    if (!target) return json(response, 404, { error: "Configurator asset not found" });
    const payload = fs.readFileSync(target);
    response.writeHead(200, {
      "Content-Type": mime(target),
      "Content-Length": payload.length,
      "Cache-Control": "no-store, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
      "X-UCVR-Web-Configurator": "bundled-community-build",
      "X-UCVR-Web-Configurator-Version": status.version,
      "X-UCVR-Web-Configurator-Upstream": status.upstream_version,
      "X-UCVR-Configurator-Patch": "source-build"
    });
    response.end(payload);
  }

  #static(response, pathname) {
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filename = path.resolve(this.publicDir, relative);
    const root = path.resolve(this.publicDir);
    if (!filename.startsWith(`${root}${path.sep}`) && filename !== path.join(root, "index.html")) return json(response, 403, { error: "Forbidden" });
    let target = filename;
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target = path.join(root, "index.html");
    const payload = fs.readFileSync(target);
    response.writeHead(200, {
      "Content-Type": mime(target),
      "Content-Length": payload.length,
      // The management page is a tightly coupled ES-module bundle.
      // Never allow an upgrade to combine fresh HTML with stale JavaScript or CSS.
      "Cache-Control": "no-store, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
      "X-UCVR-Frontend-Version": this.platform.version
    });
    response.end(payload);
  }
}
