import { EventEmitter } from "node:events";
import { connectWebSocket, WebSocketPeer } from "../protocol/websocket.js";
import { logger } from "../shared/logger.js";
import { localEntityId } from "../shared/util.js";

const log = logger("integration-connection");

function normalizeList(value, keys = []) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const key of [...keys, "items", "entities", "available_entities", "entity_states"]) {
      if (Array.isArray(value[key])) return value[key];
    }
  }
  return [];
}

export class IntegrationProtocolError extends Error {
  constructor(message, code = 500, data = null) {
    super(message);
    this.name = "IntegrationProtocolError";
    this.code = Number(code);
    this.status = Number(code);
    this.data = data;
  }
}

export class IntegrationConnection extends EventEmitter {
  constructor(record, platform) {
    super();
    this.record = record;
    this.platform = platform;
    this.socket = null;
    this.pending = new Map();
    this.requestId = 1;
    this.authenticated = false;
    this.authWaiter = null;
    this.closedByUser = false;
    this.subscribedEntityIds = new Set();
    this.connectEventSent = false;
    this.deviceState = "UNKNOWN";
    this.recoveryPromise = null;
  }

  get connected() {
    return this.socket?.readyState === WebSocketPeer.OPEN && this.authenticated;
  }

  async connect() {
    if (this.connected) return this;
    this.closedByUser = false;
    const headers = {};
    if (this.record.token) headers["auth-token"] = this.record.token;
    const url = new URL(this.record.url);
    if (!url.pathname || url.pathname === "/") url.pathname = "/intg";
    log.info(`Connecting ${this.record.id} to ${url}`);
    this.socket = await connectWebSocket(url.toString(), {
      headers,
      timeoutMs: 10_000,
      rejectUnauthorized: process.env.UCVR_TLS_VERIFY !== "false"
    });
    this.socket.on("message", (raw) => this.#handle(raw));
    this.socket.on("close", () => this.#closed());
    this.socket.on("error", (error) => this.emit("error", error));
    await this.#waitForAuthentication();
    this.emit("connected");
    return this;
  }

  async disconnect() {
    this.closedByUser = true;
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    this.authenticated = false;
    this.subscribedEntityIds.clear();
    this.connectEventSent = false;
    this.deviceState = "DISCONNECTED";
    if (socket.readyState === WebSocketPeer.OPEN) {
      try { this.sendEvent("disconnect", {}); } catch {}
      socket.close();
    }
  }

  async initialize() {
    const [version, metadata] = await Promise.all([
      this.request("get_driver_version").catch(() => null),
      this.request("get_driver_metadata")
    ]);
    return {
      version: version?.msg_data || version || null,
      metadata: metadata?.msg_data || metadata || {}
    };
  }

  async getAvailableEntities(filter = undefined) {
    const response = await this.request("get_available_entities", filter ? { filter } : undefined, 30_000);
    return normalizeList(response.msg_data, ["available_entities"]);
  }

  async getEntityStates(entityIds = undefined) {
    const data = entityIds?.length ? { entity_ids: entityIds } : undefined;
    const response = await this.request("get_entity_states", data, 20_000);
    return normalizeList(response.msg_data, ["entity_states"]);
  }

  async subscribe(entityIds) {
    const desired = [...new Set((entityIds || []).map(String).filter(Boolean))];
    // Integration drivers enter their normal RUNNING state when the Core emits
    // the connect event. It must be delivered before subscribe_events; sending
    // it afterwards leaves Home Assistant in setup-required mode and causes all
    // subsequent subscriptions and entity commands to return HTTP 503.
    await this.#announceConnect(desired);
    const additions = desired.filter((id) => !this.subscribedEntityIds.has(id));
    if (!additions.length) return;
    try {
      await this.request("subscribe_events", { entity_ids: additions });
    } catch (error) {
      if (Number(error?.code || error?.status) !== 503) throw error;
      if (this.#isRecoverableSessionError(error)) {
        await this.#recoverDriverSession(desired);
        return;
      }
      await this.#announceConnect(desired, true);
      await this.request("subscribe_events", { entity_ids: additions });
    }
    for (const id of additions) this.subscribedEntityIds.add(id);
  }

  async unsubscribe(entityIds) {
    const removals = [...new Set((entityIds || []).map(String).filter((id) => this.subscribedEntityIds.has(id)))];
    if (!removals.length) return;
    await this.request("unsubscribe_events", { entity_ids: removals });
    for (const id of removals) this.subscribedEntityIds.delete(id);
  }

  async command(entityId, commandId, params = undefined, entityType = undefined) {
    // Configured entities can live below an integration-instance namespace
    // (for example `hass_external.main`) while this WebSocket connection is
    // owned by the underlying driver record (`hass_external`). Looking the
    // entity up only by the connection record therefore loses its type. The
    // Integration API requires entity_type in every entity_command payload,
    // so prefer the exact type supplied by IntegrationManager.
    const configured = entityType
      ? null
      : this.platform.db?.getConfiguredEntityByLocal?.(this.record.id, entityId);
    const resolvedEntityType = entityType || configured?.entity_type;
    if (!resolvedEntityType) {
      const error = new Error(`Unable to resolve entity type for ${entityId}`);
      error.status = 422;
      throw error;
    }
    const data = { entity_id: entityId, entity_type: resolvedEntityType, cmd_id: commandId };
    if (params && typeof params === "object") data.params = params;
    const desiredEntityIds = [...new Set([...this.subscribedEntityIds, entityId])];
    await this.#announceConnect(desiredEntityIds);
    try {
      return await this.request("entity_command", data, 30_000);
    } catch (error) {
      if (Number(error?.code || error?.status) !== 503) throw error;

      if (!this.#isRecoverableSessionError(error)) throw error;

      // A successful setup was previously followed by abort_driver_setup during
      // configurator cleanup. Home Assistant then stays in RequireSetup while its
      // HA socket can still report Connected. A plain connect event is ignored in
      // that state. Force a real HA disconnect/reconnect cycle so Connected is
      // consumed by the driver's state machine, then restore subscriptions.
      await this.#recoverDriverSession(desiredEntityIds);
      return this.request("entity_command", data, 30_000);
    }
  }

  #isRecoverableSessionError(error) {
    const detail = String(error?.data?.message || error?.data?.error || error?.message || "");
    return /setup required|home\s*assistant.*not connected|not connected/i.test(detail);
  }

  async #recoverDriverSession(entityIds = []) {
    if (this.recoveryPromise) return this.recoveryPromise;
    const desired = [...new Set((entityIds || []).map(String).filter(Boolean))];
    this.recoveryPromise = (async () => {
      log.warn(`${this.record.id} is not accepting normal requests; resetting its device session`);
      this.sendEvent("disconnect", {});
      this.connectEventSent = false;
      await this.#waitForDeviceState(["DISCONNECTED"], 5_000).catch((error) => {
        log.warn(`${this.record.id} did not confirm disconnect before reconnect:`, error.message);
      });

      this.sendEvent("connect", { entity_ids: desired });
      this.connectEventSent = true;
      await this.#waitForDeviceState(["CONNECTED"], 20_000);

      if (desired.length) {
        await this.request("subscribe_events", { entity_ids: desired }, 20_000);
        for (const id of desired) this.subscribedEntityIds.add(id);
      }
    })().finally(() => { this.recoveryPromise = null; });
    return this.recoveryPromise;
  }

  #waitForDeviceState(states, timeoutMs) {
    const accepted = new Set((states || []).map((state) => String(state).toUpperCase()));
    if (accepted.has(String(this.deviceState || "").toUpperCase())) return Promise.resolve(this.deviceState);
    return new Promise((resolve, reject) => {
      const onState = (state) => {
        const normalized = String(state?.state || state?.device_state || state || "UNKNOWN").toUpperCase();
        if (!accepted.has(normalized)) return;
        clearTimeout(timer);
        this.off("device_state", onState);
        resolve(normalized);
      };
      const timer = setTimeout(() => {
        this.off("device_state", onState);
        const error = new Error(`Timed out waiting for integration device state ${[...accepted].join(" or ")}; current state is ${this.deviceState}`);
        error.status = 503;
        reject(error);
      }, timeoutMs);
      this.on("device_state", onState);
    });
  }

  async #announceConnect(entityIds = [], force = false) {
    if (this.connectEventSent && !force) return;
    const ids = [...new Set((entityIds || []).map(String).filter(Boolean))];
    this.sendEvent("connect", { entity_ids: ids });
    this.connectEventSent = true;
    // Preserve WebSocket ordering and give actor-based integrations a brief
    // turn to consume the state transition before the following request.
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  async browseMedia(entityId, parameters = {}) {
    return this.request("browse_media", { entity_id: entityId, ...parameters }, 60_000);
  }

  async searchMedia(entityId, parameters = {}) {
    return this.request("search_media", { entity_id: entityId, ...parameters }, 60_000);
  }

  async startSetup(reconfigure = false, setupData = {}) {
    return this.request("setup_driver", { reconfigure: Boolean(reconfigure), setup_data: setupData }, 30_000);
  }

  async submitSetup(input) {
    const data = input?.input_values !== undefined
      ? { input_values: input.input_values }
      : { confirm: Boolean(input?.confirm) };
    return this.request("set_driver_user_data", data, 30_000);
  }

  abortSetup(error = "USER_ABORT") {
    this.sendEvent("abort_driver_setup", { error });
  }

  sendEvent(name, data = {}, category = "DEVICE") {
    if (!this.socket || this.socket.readyState !== WebSocketPeer.OPEN) throw new Error("Integration connection is not open");
    this.socket.send(JSON.stringify({ kind: "event", msg: name, msg_data: data, cat: category }));
  }

  request(name, data = undefined, timeoutMs = 10_000) {
    if (!this.socket || this.socket.readyState !== WebSocketPeer.OPEN) return Promise.reject(new Error("Integration connection is not open"));
    const id = this.requestId++;
    const payload = { kind: "req", id, msg: name };
    if (data !== undefined) payload.msg_data = data;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Integration request ${name} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, name });
      this.socket.send(JSON.stringify(payload));
    });
  }

  #waitForAuthentication() {
    if (this.authenticated) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.authWaiter = null;
        reject(new Error("Integration authentication timed out"));
      }, 10_000);
      this.authWaiter = {
        resolve: () => { clearTimeout(timer); this.authWaiter = null; resolve(); },
        reject: (error) => { clearTimeout(timer); this.authWaiter = null; reject(error); }
      };
    });
  }

  async #handle(raw) {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.kind === "resp") {
      if (message.msg === "authentication" || Number(message.req_id) === 0) {
        const pendingAuth = this.pending.get(message.req_id);
        if (pendingAuth) { clearTimeout(pendingAuth.timer); this.pending.delete(message.req_id); }
        if (Number(message.code) >= 200 && Number(message.code) < 300) {
          this.authenticated = true;
          this.authWaiter?.resolve();
        } else {
          this.authWaiter?.reject(new IntegrationProtocolError("Integration authentication failed", message.code, message.msg_data));
        }
        return;
      }
      const pending = this.pending.get(message.req_id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.req_id);
      if (Number(message.code) >= 200 && Number(message.code) < 300) pending.resolve(message);
      else {
        const detail = message.msg_data?.message || message.msg_data?.error || message.msg_data?.code;
        pending.reject(new IntegrationProtocolError(
          `${pending.name} failed${detail ? `: ${detail}` : ""}`,
          message.code,
          message.msg_data
        ));
      }
      return;
    }

    if (message.kind === "event") {
      if (message.msg === "auth_required") {
        const id = this.requestId++;
        const payload = { kind: "req", id, msg: "auth", msg_data: { token: this.record.token || "" } };
        this.pending.set(id, {
          name: "auth",
          timer: setTimeout(() => this.authWaiter?.reject(new Error("Authentication request timed out")), 10_000),
          resolve: () => {},
          reject: (error) => this.authWaiter?.reject(error)
        });
        this.socket.send(JSON.stringify(payload));
        return;
      }
      if (message.msg === "device_state") {
        const state = String(message.msg_data?.state || message.msg_data?.device_state || "UNKNOWN").toUpperCase();
        this.deviceState = state;
        this.emit("device_state", state, message.msg_data || {});
      }
      this.emit("event", message);
      this.emit(message.msg, message.msg_data || {});
      return;
    }

    if (message.kind === "req") await this.#handleDriverRequest(message);
  }

  async #handleDriverRequest(message) {
    const id = message.id;
    const configured = this.platform.db.listConfiguredEntities(this.record.id).map((item) => localEntityId(this.record.id, item.entity_id));
    const responses = {
      get_version: ["version", {
        api: this.platform.integrationApiVersion,
        core: this.platform.version,
        ui: this.platform.remoteUiCompatibilityVersion,
        os: `Node.js ${process.version}`,
        integrations: {}
      }],
      get_supported_entity_types: ["supported_entity_types", this.platform.supportedEntityTypes],
      get_configured_entities: ["configured_entities", configured],
      get_localization_cfg: ["localization_cfg", {
        language_code: this.platform.locale.split("-")[0],
        country_code: this.platform.locale.split("-")[1] || "US",
        time_zone: this.platform.timezone,
        measurement_unit: "METRIC"
      }],
      get_runtime_info: ["runtime_info", {
        remote_id: this.platform.id,
        remote_name: this.platform.name,
        model: "UCR3",
        power_mode: "ON",
        software_version: this.platform.version
      }]
    };
    const result = responses[message.msg];
    if (!result) {
      this.#respond(id, "result", { message: `Unsupported Core request ${message.msg}` }, 501);
      return;
    }
    this.#respond(id, result[0], result[1], 200);
  }

  #respond(reqId, msg, data = {}, code = 200) {
    this.socket?.send(JSON.stringify({ kind: "resp", req_id: reqId, msg, code, msg_data: data }));
  }

  #closed() {
    this.authenticated = false;
    this.socket = null;
    this.subscribedEntityIds.clear();
    this.connectEventSent = false;
    this.deviceState = "DISCONNECTED";
    this.emit("device_state", this.deviceState, { state: this.deviceState });
    const error = new Error("Integration connection closed");
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.authWaiter?.reject(error);
    this.emit("disconnected", { user: this.closedByUser });
  }
}
