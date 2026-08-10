import { IntegrationConnection } from "./connection.js";
import { discoverIntegrations } from "./mdns.js";
import { displayName, localEntityId, qualifiedEntityId, sleep } from "../shared/util.js";
import { logger } from "../shared/logger.js";
import { entityCommandMetadata } from "../core/device-metadata.js";

const log = logger("integration-manager");

function commandDefinition(entity, commandId) {
  const type = String(entity?.entity_type || "");
  return entityCommandMetadata().find((item) =>
    item.entity_type === type && (item.id === commandId || item.cmd_id === commandId)
  ) || null;
}

function selectionFallback(entity, metadata) {
  const items = metadata?.items || {};
  const source = items.source === "options" ? entity?.options : entity?.attributes;
  const values = Array.isArray(source?.[items.field]) ? source[items.field].map(String) : [];
  const currentField = { source_list: "source", sound_mode_list: "sound_mode", options: "current_option" }[items.field];
  const current = currentField ? source?.[currentField] : undefined;
  if (current !== undefined && current !== null && String(current).length) return String(current);
  return values[0];
}

function completeCommandParams(entity, definition, input) {
  if (!definition?.params?.length) return input && typeof input === "object" ? { ...input } : undefined;
  const params = input && typeof input === "object" ? { ...input } : {};

  // Older configurator builds could serialize array-backed metadata with
  // numeric keys. Convert those values back to the declared parameter names.
  definition.params.forEach((metadata, index) => {
    const numericKey = String(index);
    if (!(metadata.param in params) && numericKey in params) params[metadata.param] = params[numericKey];
    delete params[numericKey];
  });

  for (const metadata of definition.params) {
    const current = params[metadata.param];
    if (current !== undefined && current !== null && current !== "") continue;
    if (metadata.optional === true) { delete params[metadata.param]; continue; }

    let value = metadata.default;
    if (value === undefined && metadata.type === "selection") value = selectionFallback(entity, metadata);
    if (value === undefined && metadata.type === "enum") value = metadata.values?.[0];
    if (value === undefined && metadata.type === "bool") value = false;
    if (value === undefined && metadata.type === "number") value = metadata.min ?? 0;

    if (value === undefined || value === null || value === "") {
      const error = new Error(`Command ${definition.id} requires parameter ${metadata.param}`);
      error.status = 422;
      throw error;
    }
    params[metadata.param] = value;
  }
  return params;
}

function setupAction(data) {
  const action = data?.require_user_action;
  if (!action || typeof action !== "object") return null;
  // Preserve the Integration API object exactly. The official configurator
  // expects {input:{...}} or {confirmation:{...}}, not the simplified custom
  // UI representation used by early Virtual Remote releases.
  return action;
}

function statePayload(data) {
  const entity = data?.entity && typeof data.entity === "object" ? data.entity : data;
  const id = entity?.entity_id || data?.entity_id;
  const attributes = entity?.attributes || data?.attributes || {};
  return { id, attributes, entity_type: entity?.entity_type || data?.entity_type };
}

export class IntegrationManager {
  constructor(platform) {
    this.platform = platform;
    this.connections = new Map();
    this.reconnectTimers = new Map();
    this.backgroundTasks = new Set();
    this.stopping = false;
  }

  async start() {
    this.stopping = false;
    const enabled = this.platform.db.listIntegrations().filter((item) => item.enabled && !this.platform.demo?.isIntegration(item.id));
    for (const integration of enabled) {
      this.connect(integration.id).catch((error) => log.warn(`Initial connection ${integration.id} failed:`, error.message));
      await sleep(100);
    }
  }

  async stop() {
    this.stopping = true;
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    await Promise.allSettled([...this.backgroundTasks]);
    await Promise.allSettled([...this.connections.values()].map((connection) => connection.disconnect()));
    this.connections.clear();
  }

  async discover(timeoutMs = 3000) {
    return discoverIntegrations(timeoutMs);
  }

  resolveIntegration(id) {
    const requestedId = String(id || "");
    const exact = this.platform.db.getIntegration(requestedId);
    if (exact) {
      const connectionRecordId = exact.metadata?.connection_record_id;
      const connectionDriverId = exact.metadata?.connection_driver_id;
      const connectionRecord = (connectionRecordId ? this.platform.db.getIntegration(connectionRecordId) : null)
        || (connectionDriverId ? this.platform.db.listIntegrations().find((item) =>
          String(item.driver_id || item.metadata?.driver_id || item.id) === String(connectionDriverId)
          && !item.metadata?.instance_alias
        ) : null);
      if (connectionRecord) {
        return {
          requested_id: requestedId,
          namespace_record: exact,
          record_id: connectionRecord.id,
          record: connectionRecord,
          aliased: true
        };
      }
      return { requested_id: requestedId, namespace_record: exact, record_id: exact.id, record: exact, aliased: false };
    }

    // The official Core model separates a driver id (for example
    // `remote_sync`) from its default integration instance
    // (`remote_sync.main`). Managed integrations in UC Virtual Remote are
    // initially stored as one driver record, so resolve the conventional
    // `.main` namespace back to that live driver without changing the public
    // entity namespace expected by integrations and clients.
    if (requestedId.endsWith(".main")) {
      const driverId = requestedId.slice(0, -5);
      const record = this.platform.db.listIntegrations().find((item) =>
        String(item.driver_id || item.metadata?.driver_id || item.id) === driverId
        && (item.id === driverId || item.configured === false)
      ) || this.platform.db.listIntegrations().find((item) =>
        String(item.driver_id || item.metadata?.driver_id || item.id) === driverId
      );
      if (record) return { requested_id: requestedId, namespace_record: null, record_id: record.id, record, aliased: true };
    }
    return null;
  }

  ensureIntegrationNamespace(id) {
    const requestedId = String(id || "");
    const resolved = this.resolveIntegration(requestedId);
    if (!resolved || resolved.namespace_record || !resolved.aliased || !requestedId.endsWith(".main")) return resolved;

    const driver = resolved.record;
    const instance = this.platform.db.saveIntegration({
      id: requestedId,
      // This is an internal namespace anchor for foreign-key-backed entity
      // storage, not a second managed driver. Keep its driver id distinct so
      // installer/update lookups continue to select the real driver record.
      driver_id: requestedId,
      name: `${driver.name} (${requestedId})`,
      url: driver.url,
      token: driver.token,
      enabled: false,
      status: driver.status,
      device_state: driver.device_state,
      driver_version: driver.driver_version,
      driver_type: "INTERNAL",
      auth_method: driver.auth_method,
      setup_data: {},
      configured: false,
      metadata: {
        connection_record_id: driver.id,
        connection_driver_id: driver.driver_id || driver.metadata?.driver_id || driver.id,
        instance_alias: true
      }
    });
    return {
      requested_id: requestedId,
      namespace_record: instance,
      record_id: driver.id,
      record: this.platform.db.getIntegration(driver.id) || driver,
      aliased: true
    };
  }

  async register(input) {
    if (!input.url) throw new Error("Integration URL is required");
    let url = String(input.url).trim();
    if (!/^wss?:\/\//i.test(url)) url = `ws://${url}`;
    const record = this.platform.db.saveIntegration({ ...input, url, configured: input.configured ?? false });
    this.platform.events.publish("integration.driver_created", record);
    if (record.enabled) await this.connect(record.id);
    return this.platform.db.getIntegration(record.id);
  }

  async connect(id) {
    if (this.platform.demo?.isIntegration(id)) return this.platform.demo.connect();
    const resolved = this.resolveIntegration(id);
    if (!resolved) throw new Error(`Integration ${id} not found`);
    const { record, record_id: recordId } = resolved;
    const existing = this.connections.get(recordId);
    if (existing?.connected) return record;
    if (existing) await existing.disconnect().catch(() => {});
    clearTimeout(this.reconnectTimers.get(recordId));
    this.reconnectTimers.delete(recordId);

    this.platform.db.updateIntegration(recordId, { status: "CONNECTING", last_error: null });
    this.platform.events.publish("integration.status", { id: recordId, status: "CONNECTING" });
    const connection = new IntegrationConnection(record, this.platform);
    this.connections.set(recordId, connection);
    connection.on("event", (message) => this.#event(recordId, message));
    connection.on("error", (error) => log.warn(`${recordId} WebSocket error:`, error.message));
    connection.on("disconnected", ({ user }) => this.#disconnected(recordId, user));

    try {
      await connection.connect();
      const info = await connection.initialize();
      const metadata = info.metadata || {};
      const version = info.version?.version?.driver || info.version?.version || info.version?.driver || null;
      const name = displayName(metadata.name, record.name || id);
      const updated = this.platform.db.updateIntegration(recordId, {
        name,
        status: "CONNECTED",
        device_state: "UNKNOWN",
        driver_version: typeof version === "string" ? version : JSON.stringify(version || ""),
        metadata,
        last_error: null
      });
      this.platform.events.publish("integration.status", updated);
      const configured = this.#configuredForConnection(recordId);
      if (configured.length) {
        const localIds = [...new Set(configured.map((entity) => entity.local_id))];
        await connection.subscribe(localIds).catch((error) => log.warn(`${id} subscribe failed:`, error.message));
        const states = await connection.getEntityStates(localIds).catch(() => []);
        for (const state of states) this.#applyState(recordId, state);
      }
      return updated;
    } catch (error) {
      this.connections.delete(recordId);
      await connection.disconnect().catch(() => {});
      const updated = this.platform.db.updateIntegration(recordId, { status: "ERROR", last_error: error.message });
      this.platform.events.publish("integration.status", updated);
      this.#scheduleReconnect(recordId);
      throw error;
    }
  }

  async disconnect(id, { disable = false } = {}) {
    if (this.platform.demo?.isIntegration(id)) return this.platform.demo.disconnect();
    clearTimeout(this.reconnectTimers.get(id));
    this.reconnectTimers.delete(id);
    const connection = this.connections.get(id);
    this.connections.delete(id);
    await connection?.disconnect();
    const updated = this.platform.db.updateIntegration(id, {
      enabled: disable ? false : this.platform.db.getIntegration(id)?.enabled,
      status: "DISCONNECTED",
      device_state: "DISCONNECTED"
    });
    this.platform.events.publish("integration.status", updated);
    return updated;
  }

  async remove(id) {
    if (this.platform.demo?.isIntegration(id)) {
      this.platform.configuration.update("features", { id: "demo_mode", enabled: false });
      return true;
    }
    await this.disconnect(id).catch(() => {});
    const aliases = this.platform.db.listIntegrations().filter((item) => item.metadata?.connection_record_id === id);
    for (const alias of aliases) this.platform.db.deleteIntegration(alias.id);
    const deleted = this.platform.db.deleteIntegration(id);
    if (deleted) this.platform.events.publish("integration.deleted", { id });
    return deleted;
  }

  async fetchAvailable(id) {
    if (this.platform.demo?.isIntegration(id)) return this.platform.demo.availableEntities();
    const namespaceId = String(id);
    this.ensureIntegrationNamespace(namespaceId);
    const connection = await this.#connection(namespaceId);
    const entities = await connection.getAvailableEntities();
    const stored = this.platform.db.replaceAvailableEntities(namespaceId, entities);
    this.platform.events.publish("entities.available", { integration_id: namespaceId, count: stored.length });
    return stored;
  }

  async configureEntity(integrationId, localId, overrides = {}) {
    this.ensureIntegrationNamespace(integrationId);
    if (this.platform.demo?.isIntegration(integrationId)) {
      const source = this.platform.db.getAvailableEntity(integrationId, localId);
      if (!source) throw Object.assign(new Error(`Entity ${integrationId}/${localId} is not available`), { status: 404 });
      const id = qualifiedEntityId(integrationId, localId);
      const existing = source.entity_type === "activity"
        ? this.platform.db.getActivity(id)
        : source.entity_type === "macro"
          ? this.platform.db.getMacro(id)
          : this.platform.db.getConfiguredEntity(id);
      if (existing) return existing;
    }
    const entity = this.platform.db.configureEntity(integrationId, localId, overrides);
    if (this.platform.demo?.isIntegration(integrationId)) {
      this.platform.events.publish("entity.created", entity);
      return entity;
    }
    const resolved = this.resolveIntegration(integrationId);
    const connection = resolved ? this.connections.get(resolved.record_id) : null;
    if (connection?.connected) {
      const ids = [...new Set(this.#configuredForConnection(resolved.record_id).map((item) => item.local_id))];
      try {
        await connection.subscribe(ids);
      } catch (error) {
        // Some integrations temporarily return SERVICE_UNAVAILABLE while a
        // reconfiguration flow is closing. The entity is already persisted;
        // do not turn that transient subscription failure into a failed
        // entity-add request. Retry asynchronously once the driver returns to
        // RUNNING mode.
        log.warn(`${resolved.record_id} subscription update failed after configuring ${localId}:`, error.message);
        this.#background(this.#syncConfiguredSubscriptions(resolved.record_id, { initialDelayMs: 500 }));
      }
      const states = await connection.getEntityStates([localId]).catch(() => []);
      for (const state of states) this.#applyState(resolved.record_id, state);
    }
    this.platform.events.publish("entity.created", entity);
    return entity;
  }

  async unconfigureEntity(id) {
    const entity = this.platform.db.getConfiguredEntity(id);
    if (!entity) return false;
    const removed = this.platform.db.deleteConfiguredEntity(id);
    const resolved = this.resolveIntegration(entity.integration_id);
    const connection = resolved ? this.connections.get(resolved.record_id) : null;
    if (connection?.connected) await connection.unsubscribe([entity.local_id]).catch(() => {});
    if (removed) this.platform.events.publish("entity.deleted", { id });
    return removed;
  }

  async command(entityId, commandId, params = undefined) {
    const entity = this.platform.db.getConfiguredEntity(entityId);
    if (!entity) throw new Error(`Configured entity ${entityId} not found`);
    const definition = commandDefinition(entity, commandId);
    const driverCommandId = definition?.cmd_id || commandId;
    const completedParams = completeCommandParams(entity, definition, params);
    if (this.platform.demo?.isIntegration(entity.integration_id)) {
      return this.platform.demo.command(entityId, driverCommandId, completedParams);
    }
    const connection = await this.#connection(entity.integration_id);
    const result = await connection.command(
      entity.local_id,
      driverCommandId,
      completedParams,
      entity.entity_type
    );
    this.platform.events.publish("entity.command", {
      entity_id: entityId,
      command_id: commandId,
      driver_command_id: driverCommandId,
      params: completedParams || null
    });
    return result?.msg_data || { code: result?.code || 200 };
  }

  async browseMedia(entityId, parameters = {}) {
    const entity = this.platform.db.getConfiguredEntity(entityId);
    if (!entity) throw Object.assign(new Error(`Configured entity ${entityId} not found`), { status: 404 });
    if (entity.entity_type !== "media_player") throw Object.assign(new Error(`${entityId} is not a media player`), { status: 422 });
    if (this.platform.demo?.isIntegration(entity.integration_id)) return this.platform.demo.browseMedia(entityId, parameters);
    const connection = await this.#connection(entity.integration_id);
    return connection.browseMedia(entity.local_id, parameters);
  }

  async searchMedia(entityId, parameters = {}) {
    const entity = this.platform.db.getConfiguredEntity(entityId);
    if (!entity) throw Object.assign(new Error(`Configured entity ${entityId} not found`), { status: 404 });
    if (entity.entity_type !== "media_player") throw Object.assign(new Error(`${entityId} is not a media player`), { status: 422 });
    if (this.platform.demo?.isIntegration(entity.integration_id)) return this.platform.demo.searchMedia(entityId, parameters);
    const connection = await this.#connection(entity.integration_id);
    return connection.searchMedia(entity.local_id, parameters);
  }

  async startSetup(id, reconfigure = false, setupData = {}) {
    const connection = await this.#connection(id);
    const record = this.platform.db.updateIntegration(id, { setup_state: "SETUP", setup_action: null, last_error: null });
    this.platform.events.publish("integration.setup", {
      id,
      driver_id: record.driver_id || record.metadata?.driver_id || id,
      event_type: "START",
      state: "SETUP"
    });
    await connection.startSetup(reconfigure, setupData);
    return this.platform.db.getIntegration(id);
  }

  async submitSetup(id, input) {
    const connection = await this.#connection(id);
    this.platform.db.updateIntegration(id, { setup_state: "SETUP", setup_action: null });
    await connection.submitSetup(input);
    return this.platform.db.getIntegration(id);
  }

  async abortSetup(id) {
    const current = this.platform.db.getIntegration(id);
    const state = String(current?.setup_state || "IDLE").toUpperCase();
    const connection = this.connections.get(id);

    // The configurator calls stop_integration_setup as cleanup after receiving
    // driver_setup_change: OK. That is not an aborted setup. Forwarding
    // abort_driver_setup at this point makes the Home Assistant integration
    // transition from Running back to RequireSetup, after which every normal
    // request returns 503. Only forward a real abort while setup is active.
    const activeSetup = !["IDLE", "OK"].includes(state);
    if (activeSetup) connection?.abortSetup();

    this.platform.events.publish("integration.setup", {
      id,
      driver_id: current?.driver_id || current?.metadata?.driver_id || id,
      event_type: "STOP",
      state: activeSetup ? "ERROR" : "OK",
      ...(activeSetup ? { error: "OTHER" } : {})
    });
    return this.platform.db.updateIntegration(id, { setup_state: "IDLE", setup_action: null });
  }

  async #connection(id) {
    const resolved = this.resolveIntegration(id);
    if (!resolved) throw new Error(`Integration ${id} not found`);
    let connection = this.connections.get(resolved.record_id);
    if (!connection?.connected) {
      await this.connect(resolved.record_id);
      connection = this.connections.get(resolved.record_id);
    }
    if (!connection?.connected) throw new Error(`Integration ${id} is not connected`);
    return connection;
  }

  #configuredForConnection(recordId) {
    return this.platform.db.listConfiguredEntities().filter((entity) =>
      this.resolveIntegration(entity.integration_id)?.record_id === recordId
    );
  }

  #namespacesForConnection(recordId) {
    const namespaces = new Set([recordId]);
    for (const entity of this.platform.db.listConfiguredEntities()) {
      if (this.resolveIntegration(entity.integration_id)?.record_id === recordId) namespaces.add(entity.integration_id);
    }
    for (const entity of this.platform.db.listAvailableEntities()) {
      if (this.resolveIntegration(entity.integration_id)?.record_id === recordId) namespaces.add(entity.integration_id);
    }
    return namespaces;
  }

  #event(id, message) {
    const data = message.msg_data || {};
    switch (message.msg) {
      case "device_state": {
        const state = String(data.state || data.device_state || "UNKNOWN");
        const updated = this.platform.db.updateIntegration(id, { device_state: state });
        this.platform.events.publish("integration.device_state", updated);
        break;
      }
      case "driver_setup_change": {
        const state = String(data.state || "SETUP");
        const action = state === "WAIT_USER_ACTION" ? setupAction(data) : null;
        const patch = { setup_state: state, setup_action: action };
        if (state === "ERROR") patch.last_error = String(data.error || "Integration setup failed");
        if (state === "OK") {
          patch.configured = true;
          patch.last_error = null;
        }
        const updated = this.platform.db.updateIntegration(id, patch);
        const driverId = updated.driver_id || updated.metadata?.driver_id || id;
        this.platform.events.publish("integration.setup", {
          id,
          driver_id: driverId,
          event_type: ["OK", "ERROR"].includes(state) ? "STOP" : "SETUP",
          state,
          ...(action ? { require_user_action: action } : {}),
          ...(state === "ERROR" ? { error: String(data.error || "OTHER") } : {})
        });
        if (state === "OK") {
          this.platform.events.publish("integration.created", updated);
          this.#background(this.fetchAvailable(id));
          this.#background(this.#syncConfiguredSubscriptions(id, { initialDelayMs: 250 }));
        }
        break;
      }
      case "entity_change":
        this.#applyState(id, data);
        break;
      case "entity_available": {
        const entity = data.entity || data;
        try {
          for (const namespaceId of this.#namespacesForConnection(id)) {
            const stored = this.platform.db.upsertAvailableEntity(namespaceId, entity);
            this.platform.events.publish("entity.available", stored);
          }
        } catch (error) { log.warn(`${id} invalid entity_available:`, error.message); }
        break;
      }
      case "entity_removed": {
        const localId = String(data.entity_id || data.id || "");
        if (localId) {
          for (const namespaceId of this.#namespacesForConnection(id)) {
            this.platform.db.removeAvailableEntity(namespaceId, localEntityId(namespaceId, localId));
          }
          this.platform.events.publish("entity.removed", { integration_id: id, local_id: localId });
        }
        break;
      }
      case "assistant_event": {
        const value = this.platform.media.session({ ...data, integration_id: id, kind: "ASSISTANT", source_event: message.msg });
        this.platform.events.publish("assistant.event", value);
        break;
      }
      case "media_event":
      case "media_session":
      case "media_session_event":
      case "media_queue_change": {
        const value = this.platform.media.session({ ...data, integration_id: id, source_event: message.msg });
        if (data.entity_id && Array.isArray(data.queue)) this.platform.media.setQueue(qualifiedEntityId(id, data.entity_id), { items: data.queue, position: data.position });
        this.platform.events.publish("media.session", value);
        break;
      }
      default:
        this.platform.events.publish("integration.event", { integration_id: id, message });
    }
  }

  #applyState(integrationId, data) {
    const normalized = statePayload(data);
    if (!normalized.id) return;
    const localId = localEntityId(integrationId, normalized.id);
    const targets = this.#configuredForConnection(integrationId).filter((entity) =>
      entity.local_id === localId || entity.entity_id === qualifiedEntityId(entity.integration_id, normalized.id)
    );
    for (const configured of targets) {
      const updated = this.platform.db.updateEntityAttributes(configured.entity_id, normalized.attributes);
      this.platform.events.publish("entity.change", updated);
    }
  }

  #background(promise) {
    const task = Promise.resolve(promise).catch((error) => {
      if (!this.stopping) log.warn("Background integration task failed:", error.message);
    }).finally(() => this.backgroundTasks.delete(task));
    this.backgroundTasks.add(task);
    return task;
  }

  async #syncConfiguredSubscriptions(recordId, { attempts = 5, initialDelayMs = 0 } = {}) {
    if (initialDelayMs > 0) await sleep(initialDelayMs);
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (this.stopping) return false;
      const connection = this.connections.get(recordId);
      if (!connection?.connected) return false;
      const ids = [...new Set(this.#configuredForConnection(recordId).map((item) => item.local_id))];
      try {
        await connection.subscribe(ids);
        return true;
      } catch (error) {
        lastError = error;
        if (attempt + 1 < attempts) await sleep(Math.min(3000, 500 * (2 ** attempt)));
      }
    }
    throw lastError || new Error(`Unable to synchronize subscriptions for ${recordId}`);
  }

  #disconnected(id, user) {
    this.connections.delete(id);
    if (this.stopping) return;
    const record = this.platform.db.getIntegration(id);
    if (!record) return;
    const updated = this.platform.db.updateIntegration(id, {
      status: user ? "DISCONNECTED" : "RECONNECTING",
      device_state: "DISCONNECTED"
    });
    this.platform.events.publish("integration.status", updated);
    if (!user) this.#scheduleReconnect(id);
  }

  #scheduleReconnect(id) {
    if (this.stopping || this.reconnectTimers.has(id)) return;
    const record = this.platform.db.getIntegration(id);
    if (!record?.enabled) return;
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(id);
      this.connect(id).catch((error) => {
        log.warn(`Reconnect ${id} failed:`, error.message);
        this.#scheduleReconnect(id);
      });
    }, 5000);
    timer.unref?.();
    this.reconnectTimers.set(id, timer);
  }
}
