import crypto from "node:crypto";
import { localEntityId, nowIso, sha256 } from "../shared/util.js";
import { entityCommandMetadata } from "./device-metadata.js";
import { normalizeActivityAction } from "../engine/activity-command.js";
import {
  availableEntity,
  coreEntity,
  coreGroup,
  corePage,
  coreProfile,
  integrationDriver,
  integrationInstance,
  integrationStatus,
  isInternalIntegration,
  pageSlice,
  uniqueDrivers,
  visibleIntegrations
} from "./models.js";

function send(peer, payload) {
  if (peer.readyState === peer.constructor.OPEN) peer.send(JSON.stringify(payload));
}

function response(peer, reqId, msg, data = undefined, code = 200) {
  const payload = { kind: "resp", req_id: Number(reqId), msg, code };
  if (data !== undefined) payload.msg_data = data;
  send(peer, payload);
}

function errorResponse(peer, reqId, error) {
  const code = Number(error?.status || error?.code) || 500;
  response(peer, reqId, "result", {
    code: error?.errorCode || (code === 404 ? "NOT_FOUND" : code === 401 ? "AUTH_FAILED" : "ERROR"),
    message: error?.message || "Core request failed"
  }, code);
}

function event(peer, msg, cat, data) {
  send(peer, { kind: "event", msg, cat, ts: nowIso(), msg_data: data });
}

function requestedIntegration(data) {
  return data?.filter?.integration_id || data?.integration_id || null;
}

function entityFilter(items, filter = {}) {
  return items.filter((item) => {
    if (filter.integration_id && item.integration_id !== filter.integration_id) return false;
    if (filter.entity_type && item.entity_type !== filter.entity_type) return false;
    if (Array.isArray(filter.entities) && filter.entities.length && !filter.entities.includes(item.entity_type)) return false;
    if (filter.entity_id && item.entity_id !== filter.entity_id) return false;
    return true;
  });
}

function successMessage(message = "") {
  return message ? { message } : {};
}

function normalizePowerMode(value) {
  const mode = String(value || "NORMAL").trim().toUpperCase();
  return ({ ON: "NORMAL", NORMAL: "NORMAL", IDLE: "IDLE", LOW_POWER: "LOW_POWER", STANDBY: "SUSPEND", SUSPEND: "SUSPEND", OFF: "SUSPEND" })[mode] || "NORMAL";
}

function normalizeBattery(value = {}) {
  const capacity = Math.max(0, Math.min(100, Math.round(Number(value.capacity ?? 100) || 0)));
  const candidate = String(value.status || "FULL").toUpperCase();
  const status = ["CHARGING", "DISCHARGING", "NOT_CHARGING", "FULL"].includes(candidate) ? candidate : capacity >= 100 ? "FULL" : "NOT_CHARGING";
  return { capacity, status, ...(value.power_supply === undefined ? {} : { power_supply: Boolean(value.power_supply) }) };
}

function normalizeWifiEvent(value = {}) {
  const direct = String(value.event || "").toUpperCase();
  if (["CONNECTED", "DISCONNECTED", "SCAN_STARTED", "SCAN_COMPLETED", "SCAN_FAILED", "NETWORK_NOT_FOUND", "WRONG_KEY", "NETWORK_ADDED", "NETWORK_REMOVED"].includes(direct)) return { event: direct };
  const status = String(value.status?.wpa_state || value.wpa_state || "").toUpperCase();
  if (status === "COMPLETED" || status === "CONNECTED") return { event: "CONNECTED" };
  if (status === "DISCONNECTED") return { event: "DISCONNECTED" };
  if (value.error) return { event: "SCAN_FAILED" };
  return { event: "SCAN_COMPLETED" };
}

const CFG_MESSAGES = new Map([
  ["get_button_cfg", ["button", "button_cfg"]], ["set_button_cfg", ["button", "button_cfg"]],
  ["get_bt_cfg", ["bt", "bt_cfg"]], ["set_bt_cfg", ["bt", "bt_cfg"]],
  ["get_device_cfg", ["device", "device_cfg"]], ["set_device_cfg", ["device", "device_cfg"]],
  ["get_display_cfg", ["display", "display_cfg"]], ["set_display_cfg", ["display", "display_cfg"]],
  ["get_features_cfg", ["features", "features_cfg"]], ["set_features_cfg", ["features", "features_cfg"]],
  ["get_haptic_cfg", ["haptic", "haptic_cfg"]], ["set_haptic_cfg", ["haptic", "haptic_cfg"]],
  ["get_localization_cfg", ["localization", "localization_cfg"]], ["set_localization_cfg", ["localization", "localization_cfg"]],
  ["get_network_cfg", ["network", "network_cfg"]], ["set_network_cfg", ["network", "network_cfg"]],
  ["get_power_saving_cfg", ["power_saving", "power_saving_cfg"]], ["set_power_saving_cfg", ["power_saving", "power_saving_cfg"]],
  ["get_profile_cfg", ["profile", "profile_cfg"]], ["set_profile_cfg", ["profile", "profile_cfg"]],
  ["get_software_update_cfg", ["software_update", "software_update_cfg"]], ["set_software_update_cfg", ["software_update", "software_update_cfg"]],
  ["get_sound_cfg", ["sound", "sound_cfg"]], ["set_sound_cfg", ["sound", "sound_cfg"]],
  ["get_voice_control_cfg", ["voice_control", "voice_control_cfg"]], ["set_voice_control_cfg", ["voice_control", "voice_control_cfg"]]
]);

const EVENT_CHANNELS = Object.freeze([
  "all", "configuration", "entities", "entity_button", "entity_switch", "entity_climate", "entity_cover",
  "entity_light", "entity_media_player", "entity_sensor", "entity_activity", "entity_macro", "entity_remote",
  "activity_groups", "integrations", "profiles", "emitters", "docks", "software_update", "power_mode", "battery_status",
  "ambient_light", "wifi", "media", "assistant"
]);

export class CoreWebSocketFacade {
  constructor(platform) {
    this.platform = platform;
    this.peers = new Set();
    this.discovery = { active: false, drivers: [] };
  }

  close() {
    for (const client of this.peers) client.peer.close(1001, "Server shutdown");
    this.peers.clear();
  }

  attach(peer, { token = null, authenticated = false } = {}) {
    const preAuthenticated = Boolean(authenticated);
    const client = {
      peer,
      authenticated: preAuthenticated || this.#validToken(token),
      channels: new Set(),
      subscriptionsExplicit: false
    };
    this.peers.add(client);
    const eventListener = (platformEvent) => {
      if (!client.authenticated) return;
      const mapped = this.#mapEvent(platformEvent);
      const messages = Array.isArray(mapped) ? mapped : mapped ? [mapped] : [];
      for (const item of messages) {
        if (!this.#subscribed(client, item.channel)) continue;
        event(peer, item.msg, item.cat, item.data);
      }
    };
    this.platform.events.on("event", eventListener);
    peer.on("message", (raw) => this.#message(client, raw));
    peer.on("close", () => {
      this.peers.delete(client);
      this.platform.events.off("event", eventListener);
    });
    peer.on("error", () => {});

    if (!client.authenticated) {
      setImmediate(() => event(peer, "auth_required", "AUTH", {
        api: { name: "Remote Core WebSocket API", version: this.platform.coreWebSocketApiVersion }
      }));
    } else if (preAuthenticated) {
      setImmediate(() => response(peer, 0, "authentication", { core: this.platform.version }));
    }
  }

  #validToken(token) {
    if (!token) return false;
    if (this.platform.adminToken && token === this.platform.adminToken) return true;
    if (this.platform.coreToken && token === this.platform.coreToken) return true;
    return Boolean(this.platform.db.findApiKey(sha256(String(token))));
  }

  #subscribed(client, channel) {
    if (!client.subscriptionsExplicit) return true;
    return client.channels.has("all") || client.channels.has(channel);
  }

  async #message(client, raw) {
    let message;
    try { message = JSON.parse(raw.toString()); }
    catch { return; }
    if (message.kind !== "req" || !Number.isInteger(Number(message.id)) || !message.msg) return;
    const id = Number(message.id);
    const data = message.msg_data && typeof message.msg_data === "object" ? message.msg_data : {};

    if (message.msg === "auth") {
      if (this.#validToken(data.token)) {
        client.authenticated = true;
        response(client.peer, id, "authentication", { core: this.platform.version });
      } else {
        response(client.peer, id, "authentication", { code: "AUTH_FAILED", message: "Invalid Core API token" }, 401);
        setTimeout(() => client.peer.close(1008, "Authentication failed"), 25).unref?.();
      }
      return;
    }
    if (!client.authenticated) {
      response(client.peer, id, "result", { code: "AUTH_REQUIRED", message: "Authentication required" }, 401);
      return;
    }

    try {
      await this.#dispatch(client, id, String(message.msg).trim().toLowerCase(), data);
    } catch (error) {
      errorResponse(client.peer, id, error);
    }
  }

  async #dispatch(client, id, msg, data) {
    const db = this.platform.db;
    const integrations = () => visibleIntegrations(db.listIntegrations());
    const peer = client.peer;

    if (CFG_MESSAGES.has(msg)) {
      const [section, responseName] = CFG_MESSAGES.get(msg);
      let value;
      if (msg.startsWith("set_")) {
        const previous = this.platform.configuration.get(section);
        value = this.platform.configuration.update(section, data);
        if (section === "bt" && Object.prototype.hasOwnProperty.call(data, "enable_hci_log")) {
          await this.platform.hardware.setHciLogging(value.enable_hci_log);
        }
        if (section === "network") {
          if (Object.prototype.hasOwnProperty.call(data, "wifi_enabled") && Boolean(previous.wifi_enabled) !== Boolean(value.wifi_enabled)) {
            await this.platform.hardware.setWifiPower(value.wifi_enabled);
          }
          if (Object.prototype.hasOwnProperty.call(data, "bt_enabled") && Boolean(previous.bt_enabled) !== Boolean(value.bt_enabled)) {
            await this.platform.hardware.setBluetoothPower(value.bt_enabled);
          }
        }
      } else {
        value = this.platform.configuration.get(section);
      }
      return response(peer, id, responseName, value);
    }

    switch (msg) {
      case "ping": return response(peer, id, "pong", data);
      case "get_event_channels": return response(peer, id, "event_channels", { channels: [...EVENT_CHANNELS] });
      case "get_event_subscriptions": return response(peer, id, "event_subscriptions", { channels: [...client.channels] });
      case "subscribe_events": {
        client.subscriptionsExplicit = true;
        client.channels = new Set(Array.isArray(data.channels) ? data.channels : ["all"]);
        return response(peer, id, "event_subscriptions", { channels: [...client.channels] });
      }
      case "unsubscribe_events": {
        const channels = Array.isArray(data.channels) ? data.channels : [];
        if (!channels.length) client.channels.clear();
        else for (const channel of channels) client.channels.delete(channel);
        client.subscriptionsExplicit = true;
        return response(peer, id, "event_subscriptions", { channels: [...client.channels] });
      }
      case "version":
        return response(peer, id, "version_info", {
          device_name: this.platform.name,
          hostname: this.platform.hostname,
          address: this.platform.id,
          api: this.platform.coreWebSocketApiVersion,
          core: this.platform.version,
          ui: this.platform.remoteUiCompatibilityVersion,
          os: `Node.js ${process.version}`,
          integrations: Object.fromEntries(integrations().map((item) => [item.name, item.driver_version || "unknown"]))
        });
      case "system":
        return response(peer, id, "result", {
          model_name: "Virtual Unfolded Circle Remote",
          model_number: "UCR3-VIRTUAL",
          serial_number: this.platform.id,
          hw_revision: "virtual-1"
        });
      case "system_cmd":
      case "service_cmd": {
        const command = String(data.command || data.cmd_id || "").toUpperCase();
        if (!["STANDBY", "REBOOT", "POWER_OFF", "RESTART", "RESTART_UI", "RESTART_CORE"].includes(command)) {
          throw Object.assign(new Error(`Unsupported system command ${command || "UNKNOWN"}`), { status: 400 });
        }
        if (command === "STANDBY" || command === "POWER_OFF") {
          const current = db.getSetting("power_mode", { mode: "NORMAL", battery: { capacity: 100, status: "FULL", power_supply: true } });
          const next = { ...current, mode: command === "STANDBY" ? "SUSPEND" : "LOW_POWER", battery: normalizeBattery(current.battery) };
          db.setSetting("power_mode", next);
          this.platform.events.publish("power.mode", next);
        } else if (command === "RESTART_UI") {
          this.platform.events.publish("system.ui_restart", { reason: "core_websocket" });
        } else {
          this.platform.events.publish("system.restart", { reason: command.toLowerCase(), exit_code: 75 });
        }
        return response(peer, id, "result", successMessage(`Virtual system command ${command} accepted`));
      }
      case "check_system_update":
        return response(peer, id, "system_update_info", await this.platform.systemUpdate.check(Boolean(data.force_update)));
      case "update_system": {
        const updateId = data.update_id || "latest";
        if (updateId === "latest") {
          const available = await this.platform.systemUpdate.check(false);
          const latest = available.available?.[0];
          if (!latest) throw Object.assign(new Error("No system update is available"), { status: 404 });
          return response(peer, id, "update_system_result", await this.platform.systemUpdate.action(latest.id), 201);
        }
        return response(peer, id, "update_system_result", await this.platform.systemUpdate.action(updateId), 201);
      }
      case "get_system_update_progress": {
        const progress = this.platform.systemUpdate.progress(data.update_id);
        if (!progress) throw Object.assign(new Error(`System update ${data.update_id} not found`), { status: 404 });
        return response(peer, id, "system_update_progress", progress);
      }
      case "get_api_access":
        return response(peer, id, "api_access", { web_configurator: db.getSetting("api_access", { enabled: true }) });
      case "set_api_access": {
        db.setSetting("api_access", data.web_configurator || data);
        return response(peer, id, "result", successMessage());
      }
      case "get_power_mode": {
        const current = db.getSetting("power_mode", { mode: "NORMAL", battery: { capacity: 100, status: "FULL", power_supply: true } });
        return response(peer, id, "power_mode", { mode: normalizePowerMode(current.mode), battery: normalizeBattery(current.battery) });
      }
      case "set_power_mode": {
        const current = db.getSetting("power_mode", { mode: "NORMAL", battery: { capacity: 100, status: "FULL", power_supply: true } });
        const next = { ...current, mode: normalizePowerMode(data.mode), battery: normalizeBattery(current.battery) };
        db.setSetting("power_mode", next);
        this.platform.events.publish("power.mode", next);
        return response(peer, id, "result", successMessage());
      }
      case "get_ambient_light": return response(peer, id, "ambient_light", { intensity: Math.max(0, Math.min(65535, Number(db.getSetting("ambient_light", 0)) || 0)) });
      case "get_standby_inhibitors": return response(peer, id, "standby_inhibitors", db.getSetting("standby_inhibitors", []));
      case "get_factory_reset_token": {
        const issued = this.platform.factoryReset.issueToken();
        return response(peer, id, "factory_reset_token", issued);
      }
      case "factory_reset": {
        this.platform.factoryReset.schedule(data.token);
        return response(peer, id, "result", successMessage("Factory reset scheduled"));
      }

      case "get_configuration": return response(peer, id, "configuration", this.platform.configuration.getAll());
      case "reset_configuration": {
        this.platform.configuration.reset();
        return response(peer, id, "result", successMessage());
      }
      case "get_timezone_names": return response(peer, id, "timezone_names", Intl.supportedValuesOf?.("timeZone") || ["UTC"]);
      case "get_localization_countries": return response(peer, id, "localization_countries", [
        { code: "DE", name_en: "Germany" }, { code: "GB", name_en: "United Kingdom" }, { code: "US", name_en: "United States" }
      ]);
      case "get_localization_languages":
      case "localization_languages": return response(peer, id, "localization_languages", { version: "1", translations: [{ code: "en_US", name: "English" }] });
      case "reset_software_update_cfg": return response(peer, id, "software_update_cfg", this.platform.configuration.reset("software_update"));
      case "get_voice_assistants": return response(peer, id, "voice_assistants", []);

      case "get_profiles": return response(peer, id, "profiles", db.listProfiles().map(coreProfile));
      case "get_profile": {
        const value = db.getProfile(data.profile_id);
        if (!value) throw Object.assign(new Error(`Profile ${data.profile_id} not found`), { status: 404 });
        return response(peer, id, "profile", coreProfile(value));
      }
      case "get_active_profile": {
        const value = db.listProfiles().find((item) => item.active);
        return response(peer, id, "profile", coreProfile(value));
      }
      case "switch_profile": {
        const value = db.setActiveProfile(data.profile_id);
        this.platform.events.publish("profile.change", { event_type: "CHANGE", profile_id: value.id, new_state: { profile: coreProfile(value) } });
        return response(peer, id, "result", successMessage());
      }
      case "add_profile": {
        const value = db.saveProfile(data);
        this.platform.events.publish("profile.change", { event_type: "NEW", profile_id: value.id, new_state: { profile: coreProfile(value) } });
        return response(peer, id, "result", coreProfile(value), 201);
      }
      case "update_profile": {
        const value = db.saveProfile(data);
        if (Array.isArray(data.pages)) this.#reorderPages(value.id, data.pages);
        this.platform.events.publish("profile.change", { event_type: "CHANGE", profile_id: value.id, new_state: { profile: coreProfile(value) } });
        return response(peer, id, "profile", coreProfile(value));
      }
      case "delete_profile": {
        const deleted = db.deleteProfile(data.profile_id);
        if (!deleted) throw Object.assign(new Error(`Profile ${data.profile_id} not found`), { status: 404 });
        this.platform.events.publish("profile.change", { event_type: "DELETE", profile_id: data.profile_id });
        return response(peer, id, "result", successMessage());
      }
      case "delete_all_profiles": {
        db.deleteAllProfiles();
        this.platform.events.publish("profile.change", { event_type: "CHANGE", profile_id: "default" });
        return response(peer, id, "result", successMessage());
      }

      case "get_pages": return response(peer, id, "pages", db.listPages(data.profile_id).map(corePage));
      case "get_page": {
        const value = db.getPage(data.page_id);
        if (!value) throw Object.assign(new Error(`Page ${data.page_id} not found`), { status: 404 });
        return response(peer, id, "page", corePage(value));
      }
      case "add_page": {
        const value = db.savePage(data);
        this.platform.events.publish("profile.change", { event_type: "NEW", profile_id: value.profile_id, page_id: value.id, new_state: { page: corePage(value) } });
        return response(peer, id, "result", corePage(value), 201);
      }
      case "update_page": {
        const value = db.savePage(data);
        this.platform.events.publish("profile.change", { event_type: "CHANGE", profile_id: value.profile_id, page_id: value.id, new_state: { page: corePage(value) } });
        return response(peer, id, "page", corePage(value));
      }
      case "delete_page": {
        const existing = db.getPage(data.page_id);
        if (!existing || !db.deletePage(data.page_id)) throw Object.assign(new Error(`Page ${data.page_id} not found`), { status: 404 });
        this.platform.events.publish("profile.change", { event_type: "DELETE", profile_id: existing.profile_id, page_id: data.page_id });
        return response(peer, id, "result", successMessage());
      }
      case "delete_pages_in_profile":
      case "delete_all_pages": {
        db.deletePagesInProfile(data.profile_id);
        this.platform.events.publish("profile.change", { event_type: "CHANGE", profile_id: data.profile_id });
        return response(peer, id, "result", successMessage());
      }

      case "get_groups": return response(peer, id, "groups", db.listGroups(data.profile_id).map(coreGroup));
      case "get_group": {
        const value = db.getGroup(data.group_id);
        if (!value) throw Object.assign(new Error(`Group ${data.group_id} not found`), { status: 404 });
        return response(peer, id, "group", coreGroup(value));
      }
      case "add_group": {
        const value = db.saveGroup(data);
        this.platform.events.publish("profile.change", { event_type: "NEW", profile_id: value.profile_id, group_id: value.id, new_state: { group: coreGroup(value) } });
        return response(peer, id, "result", coreGroup(value), 201);
      }
      case "update_group": {
        const value = db.saveGroup(data);
        this.platform.events.publish("profile.change", { event_type: "CHANGE", profile_id: value.profile_id, group_id: value.id, new_state: { group: coreGroup(value) } });
        return response(peer, id, "group", coreGroup(value));
      }
      case "delete_group": {
        // The supplied AsyncAPI payload for delete_groups_in_profile uses the
        // same wire message name as delete_group. Distinguish the two by their
        // documented identifiers.
        if (data.profile_id && !data.group_id) {
          db.deleteGroupsInProfile(data.profile_id);
          this.platform.events.publish("profile.change", { event_type: "CHANGE", profile_id: data.profile_id });
          return response(peer, id, "result", successMessage());
        }
        const existing = db.getGroup(data.group_id);
        if (!existing || !db.deleteGroup(data.group_id)) throw Object.assign(new Error(`Group ${data.group_id} not found`), { status: 404 });
        this.platform.events.publish("profile.change", { event_type: "DELETE", profile_id: existing.profile_id, group_id: data.group_id });
        return response(peer, id, "result", successMessage());
      }
      case "delete_groups_in_profile": {
        db.deleteGroupsInProfile(data.profile_id);
        this.platform.events.publish("profile.change", { event_type: "CHANGE", profile_id: data.profile_id });
        return response(peer, id, "result", successMessage());
      }

      case "get_entity_types": return response(peer, id, "entity_types", this.platform.supportedEntityTypes);
      case "get_entities": {
        const filter = data.filter || {};
        const values = entityFilter(this.#allEntities(), filter).map(coreEntity);
        const page = pageSlice(values, data.paging);
        return response(peer, id, "entities", { filter, paging: page.paging, entities: page.items });
      }
      case "get_entity": {
        const value = this.#findEntity(data.entity_id);
        if (!value) throw Object.assign(new Error(`Entity ${data.entity_id} not found`), { status: 404 });
        return response(peer, id, "entity", coreEntity(value));
      }
      case "get_available_entities": {
        const integrationId = requestedIntegration(data);
        const integration = integrationId ? this.platform.integrations.resolveIntegration(String(integrationId)) : null;
        // Core's force_reload contract requires querying the live integration.
        // The requested namespace may be a conventional instance id such as
        // `remote_sync.main` while the managed driver connection is stored as
        // `remote_sync`; IntegrationManager keeps the public namespace and
        // resolves it to the live driver connection.
        if (data.force_reload === true && integration?.record?.enabled) {
          await this.platform.integrations.fetchAvailable(String(integrationId));
        }
        let values = db.listAvailableEntities(integrationId);
        if (data.filter?.entity_type) values = values.filter((item) => item.entity_type === data.filter.entity_type);
        const page = pageSlice(values.map(availableEntity), data.paging);
        return response(peer, id, "available_entities", {
          filter: data.filter || (integrationId ? { integration_id: integrationId } : {}),
          paging: page.paging,
          available_entities: page.items
        });
      }
      case "get_entity_command_metadata": return response(peer, id, "entity_command_metadata", entityCommandMetadata());
      case "get_entity_features": {
        const value = this.#findEntity(data.entity_id);
        return response(peer, id, "entity_features", { entity_id: data.entity_id, features: value?.features || [] });
      }
      case "get_entity_commands": {
        const value = this.#findEntity(data.entity_id);
        return response(peer, id, "entity_commands", {
          entity_id: data.entity_id,
          entity_type: value?.entity_type,
          commands: this.#commands(value)
        });
      }
      case "configure_entities_from_integration": {
        const integrationId = String(data.integration_id || "");
        const entityIds = (data.entity_ids || []).map((entityId) => localEntityId(integrationId, entityId));
        const integration = this.platform.integrations.resolveIntegration(integrationId);
        if (integration?.record?.enabled && entityIds.some((entityId) => !db.getAvailableEntity(integrationId, entityId))) {
          await this.platform.integrations.fetchAvailable(integrationId);
        }
        const configured = [];
        for (const entityId of entityIds) configured.push(await this.platform.integrations.configureEntity(integrationId, entityId));
        return response(peer, id, "result", { entities: configured.map(coreEntity), paging: { page: 1, limit: configured.length || 100, count: configured.length } }, 201);
      }
      case "configure_entity_from_integration": {
        const integrationId = String(data.integration_id || "");
        const entityId = localEntityId(integrationId, data.entity_id);
        const integration = this.platform.integrations.resolveIntegration(integrationId);
        if (integration?.record?.enabled && !db.getAvailableEntity(integrationId, entityId)) {
          await this.platform.integrations.fetchAvailable(integrationId);
        }
        const configured = await this.platform.integrations.configureEntity(integrationId, entityId);
        return response(peer, id, "entity", coreEntity(configured), 201);
      }
      case "update_entity": {
        const value = db.updateConfiguredEntity(data.entity_id, data);
        if (!value) throw Object.assign(new Error(`Entity ${data.entity_id} not found or not editable`), { status: 404 });
        this.platform.events.publish("entity.updated", value);
        return response(peer, id, "entity", coreEntity(value));
      }
      case "delete_entity": {
        const deleted = await this.platform.integrations.unconfigureEntity(data.entity_id);
        if (!deleted) throw Object.assign(new Error(`Entity ${data.entity_id} not found`), { status: 404 });
        return response(peer, id, "result", successMessage());
      }
      case "delete_entities": {
        const items = db.listConfiguredEntities(data.integration_id).filter((item) => !data.entity_ids || data.entity_ids.includes(item.entity_id));
        for (const item of items) await this.platform.integrations.unconfigureEntity(item.entity_id);
        return response(peer, id, "result", successMessage());
      }
      case "browse_media": {
        const result = await this.platform.media.browse(data.entity_id, data);
        return response(peer, id, "media_browse", { media: result.media, paging: result.pagination });
      }
      case "search_media": {
        const result = await this.platform.media.search(data.entity_id, data);
        return response(peer, id, "media_search", { items: result.items, paging: result.pagination });
      }
      case "get_media_queue": return response(peer, id, "media_queue", this.platform.media.getQueue(data.entity_id));
      case "set_media_queue": return response(peer, id, "media_queue", this.platform.media.setQueue(data.entity_id, data));
      case "execute_entity_command": {
        await this.#command(data.entity_id, data.cmd_id, data.params);
        return response(peer, id, "result", successMessage());
      }

      case "get_integration_driver_count": return response(peer, id, "integration_driver_count", { count: uniqueDrivers(integrations()).length });
      case "get_integration_drivers": {
        const page = pageSlice(uniqueDrivers(integrations()), data.paging);
        return response(peer, id, "integration_drivers", { paging: page.paging, drivers: page.items });
      }
      case "get_integration_driver": {
        const record = integrations().find((item) => (item.driver_id || item.id) === data.driver_id);
        if (!record) throw Object.assign(new Error(`Integration driver ${data.driver_id} not found`), { status: 404 });
        return response(peer, id, "integration_driver", integrationDriver(record));
      }
      case "register_integration_driver": {
        const connection = data.connection || data;
        const value = await this.platform.integrations.register({
          id: data.driver_id, driver_id: data.driver_id, name: data.name?.en || data.name || data.driver_id,
          url: connection.driver_url || data.driver_url, token: connection.token || data.token,
          enabled: data.enabled !== false, metadata: data
        });
        return response(peer, id, "integration_driver", integrationDriver(value), 201);
      }
      case "update_integration_driver": {
        const records = integrations().filter((item) => (item.driver_id || item.id) === data.driver_id);
        if (!records.length) throw Object.assign(new Error(`Integration driver ${data.driver_id} not found`), { status: 404 });
        for (const record of records) db.updateIntegration(record.id, {
          url: data.driver_url || data.connection?.driver_url || record.url,
          token: data.token ?? data.connection?.token ?? record.token,
          enabled: data.enabled ?? record.enabled,
          metadata: { ...record.metadata, ...data }
        });
        return response(peer, id, "integration_driver", integrationDriver(db.getIntegration(records[0].id)));
      }
      case "delete_integration_driver": {
        const records = integrations().filter((item) => (item.driver_id || item.id) === data.driver_id);
        for (const record of records) await this.platform.integrations.remove(record.id);
        return response(peer, id, "result", successMessage());
      }
      case "integration_driver_cmd": {
        const records = integrations().filter((item) => !data.driver_id || (item.driver_id || item.id) === data.driver_id);
        const start = String(data.cmd_id || "").toUpperCase() === "START";
        for (const record of records) {
          if (start) await this.platform.integrations.connect(record.id);
          else await this.platform.integrations.disconnect(record.id);
        }
        return response(peer, id, "result", successMessage());
      }
      case "get_integration_count": return response(peer, id, "integration_driver_count", { count: integrations().filter((item) => item.configured !== false).length, filter: data.filter || {} });
      case "get_integrations": {
        let values = integrations().filter((item) => item.configured !== false);
        if (data.filter?.driver_id) values = values.filter((item) => (item.driver_id || item.id) === data.filter.driver_id);
        if (typeof data.filter?.enabled === "boolean") values = values.filter((item) => item.enabled === data.filter.enabled);
        const page = pageSlice(values.map(integrationInstance), data.paging);
        return response(peer, id, "integrations", { filter: data.filter || {}, paging: page.paging, integrations: page.items });
      }
      case "get_integration": {
        const value = db.getIntegration(data.integration_id);
        if (!value || isInternalIntegration(value)) throw Object.assign(new Error(`Integration ${data.integration_id} not found`), { status: 404 });
        return response(peer, id, "integration", integrationInstance(value));
      }
      case "create_integration": {
        const driver = integrations().find((item) => (item.driver_id || item.id) === data.driver_id);
        if (!driver) throw Object.assign(new Error(`Integration driver ${data.driver_id} not found`), { status: 404 });
        const value = db.saveIntegration({ ...driver, ...data, id: data.integration_id, name: data.name?.en || data.name || data.integration_id, setup_data: data.setup_data, configured: true });
        return response(peer, id, "integration", integrationInstance(value), 201);
      }
      case "update_integration": {
        const existing = db.getIntegration(data.integration_id);
        if (!existing || isInternalIntegration(existing)) throw Object.assign(new Error(`Integration ${data.integration_id} not found`), { status: 404 });
        const value = db.updateIntegration(data.integration_id, {
          name: data.name?.en || data.name,
          enabled: data.enabled,
          setup_data: data.setup_data
        });
        if (!value) throw Object.assign(new Error(`Integration ${data.integration_id} not found`), { status: 404 });
        return response(peer, id, "integration", integrationInstance(value));
      }
      case "delete_integration": {
        const existing = db.getIntegration(data.integration_id);
        if (!existing || isInternalIntegration(existing)) throw Object.assign(new Error(`Integration ${data.integration_id} not found`), { status: 404 });
        const deleted = await this.platform.integrations.remove(data.integration_id);
        if (!deleted) throw Object.assign(new Error(`Integration ${data.integration_id} not found`), { status: 404 });
        return response(peer, id, "result", successMessage());
      }
      case "get_integration_status": {
        const values = integrations().filter((item) => item.configured !== false).map(integrationStatus);
        const page = pageSlice(values, data.paging);
        return response(peer, id, "integration_status", { filter: data.filter || {}, paging: page.paging, status: page.items });
      }
      case "integration_cmd": {
        const record = db.getIntegration(data.integration_id);
        if (!record || isInternalIntegration(record)) throw Object.assign(new Error(`Integration ${data.integration_id} not found`), { status: 404 });
        const idValue = data.integration_id;
        const command = String(data.cmd_id || "").toUpperCase();
        if (command === "CONNECT") await this.platform.integrations.connect(idValue);
        else if (command === "DISCONNECT") await this.platform.integrations.disconnect(idValue);
        else throw Object.assign(new Error(`Unsupported integration command ${command}`), { status: 400 });
        return response(peer, id, "result", successMessage());
      }
      case "start_integration_discovery": {
        this.discovery.active = true;
        this.platform.events.publish("integration.discovery", { event_type: "START" });
        this.discovery.drivers = await this.platform.integrations.discover(Number(data.timeout || 3) * 1000);
        for (const driver of this.discovery.drivers) this.platform.events.publish("integration.discovery", { event_type: "DISCOVER", integration: driver });
        this.discovery.active = false;
        this.platform.events.publish("integration.discovery", { event_type: "STOP" });
        return response(peer, id, "result", successMessage());
      }
      case "stop_integration_discovery": {
        this.discovery.active = false;
        this.platform.events.publish("integration.discovery", { event_type: "STOP" });
        return response(peer, id, "result", successMessage());
      }
      case "get_integration_discovery_status": return response(peer, id, "integration_discovery_status", { active: this.discovery.active });
      case "get_discovered_integration_driver": {
        const value = this.discovery.drivers.find((item) => item.driver_id === data.driver_id || item.id === data.driver_id);
        if (!value) throw Object.assign(new Error(`Discovered driver ${data.driver_id} not found`), { status: 404 });
        return response(peer, id, "discovered_integration_driver", value);
      }
      case "get_discovered_intg_driver_metadata":
      case "get_discovered_integration_driver_metadata": {
        const value = this.discovery.drivers.find((item) => item.driver_id === data.driver_id || item.id === data.driver_id) || {};
        return response(peer, id, "integration_driver", integrationDriver(value));
      }
      case "configure_discovered_integration_driver": {
        const connection = data.connection || {};
        const discovered = this.discovery.drivers.find((item) => item.driver_id === data.driver_id || item.id === data.driver_id) || {};
        const value = await this.platform.integrations.register({
          id: data.driver_id, driver_id: data.driver_id, name: data.name?.en || data.name || discovered.name || data.driver_id,
          url: connection.driver_url || discovered.url || discovered.driver_url, token: connection.token
        });
        return response(peer, id, "integration_driver", integrationDriver(value), 201);
      }
      case "setup_integration": {
        const record = integrations().find((item) => (item.driver_id || item.id) === data.driver_id);
        if (!record) throw Object.assign(new Error(`Integration driver ${data.driver_id} not found`), { status: 404 });
        await this.platform.integrations.startSetup(record.id, false, data.setup_data || {});
        return response(peer, id, "integration_setup_info", this.#setupInfo(db.getIntegration(record.id)));
      }
      case "set_integration_user_data": {
        const record = integrations().find((item) => (item.driver_id || item.id) === data.driver_id);
        if (!record) throw Object.assign(new Error(`Integration driver ${data.driver_id} not found`), { status: 404 });
        await this.platform.integrations.submitSetup(record.id, data);
        return response(peer, id, "integration_setup_info", this.#setupInfo(db.getIntegration(record.id)));
      }
      case "stop_integration_setup": {
        const record = integrations().find((item) => (item.driver_id || item.id) === data.driver_id);
        if (record) await this.platform.integrations.abortSetup(record.id);
        return response(peer, id, "result", successMessage());
      }
      case "stop_all_integration_setups": {
        for (const record of integrations().filter((item) => item.setup_state !== "IDLE")) await this.platform.integrations.abortSetup(record.id).catch(() => {});
        return response(peer, id, "result", successMessage());
      }
      case "get_integration_setup_status": {
        const record = integrations().find((item) => (item.driver_id || item.id) === data.driver_id);
        return response(peer, id, "integration_setup_info", this.#setupInfo(record));
      }
      case "get_integration_setup_processes": return response(peer, id, "integration_setup_processes", integrations()
        .filter((item) => item.setup_state !== "IDLE")
        .map((item) => item.id));

      case "get_dock_count": return response(peer, id, "dock_count", { count: this.platform.docks.list().length });
      case "get_docks": {
        let values = this.platform.docks.list(typeof data.filter?.active === "boolean" ? data.filter.active : undefined);
        const page = pageSlice(values, data.paging);
        return response(peer, id, "docks", { filter: data.filter || {}, paging: page.paging, docks: page.items });
      }
      case "create_dock": return response(peer, id, "dock", this.platform.docks.save(data), 201);
      case "delete_all_docks": this.platform.docks.removeAll(); return response(peer, id, "result", successMessage());
      case "get_dock": {
        const value = this.platform.docks.get(data.dock_id);
        if (!value) throw Object.assign(new Error(`Dock ${data.dock_id} not found`), { status: 404 });
        return response(peer, id, "dock", value);
      }
      case "update_dock": {
        const value = this.platform.docks.update(data.dock_id, data);
        if (!value) throw Object.assign(new Error(`Dock ${data.dock_id} not found`), { status: 404 });
        return response(peer, id, "dock", value);
      }
      case "dock_connection_command": {
        const value = data.dock_id
          ? this.platform.docks.connectionCommand(data.dock_id, data.cmd || data.command)
          : this.platform.docks.connectionCommandAll(data.cmd || data.command);
        if (!value) throw Object.assign(new Error(`Dock ${data.dock_id} not found`), { status: 404 });
        return response(peer, id, "result", successMessage());
      }
      case "delete_dock": {
        if (!this.platform.docks.remove(data.dock_id)) throw Object.assign(new Error(`Dock ${data.dock_id} not found`), { status: 404 });
        return response(peer, id, "result", successMessage());
      }
      case "dock_command": {
        const value = this.platform.docks.command(data.dock_id, data);
        if (!value) throw Object.assign(new Error(`Dock ${data.dock_id} not found`), { status: 404 });
        return response(peer, id, "result", successMessage());
      }
      case "get_dock_discovery_status": return response(peer, id, "dock_discovery_status", this.platform.docks.discovery());
      case "start_dock_discovery": this.platform.docks.startDiscovery(); return response(peer, id, "result", successMessage());
      case "stop_dock_discovery": this.platform.docks.stopDiscovery(); return response(peer, id, "dock_discovery_status", this.platform.docks.discovery());
      case "get_dock_discovery_device": {
        const value = this.platform.docks.discovery().docks.find((item) => item.id === data.dock_id || item.id === data.id);
        if (!value) throw Object.assign(new Error(`Discovered dock not found`), { status: 404 });
        return response(peer, id, "dock_discovery_device", value);
      }
      case "exec_cmd_on_discovered_dock": {
        const value = this.platform.docks.discoveryCommand(data.dock_id || data.id, data.cmd || data.command);
        if (!value) throw Object.assign(new Error("Discovered dock not found"), { status: 404 });
        return response(peer, id, "dock_system_info", value);
      }
      case "get_dock_setup_processes": return response(peer, id, "dock_setup_processes", { sessions: this.platform.docks.setupSessions() });
      case "create_dock_setup": return response(peer, id, "dock_setup_status", this.platform.docks.startSetup(data), 201);
      case "get_dock_setup_status": {
        const value = this.platform.docks.setupInfo(data.dock_id || data.id);
        if (!value) throw Object.assign(new Error(`Dock setup not found`), { status: 404 });
        return response(peer, id, "dock_setup_status", value);
      }
      case "start_dock_setup": return response(peer, id, "dock_setup_status", this.platform.docks.setupInfo(data.dock_id || data.id) || this.platform.docks.startSetup({ manually: data }));
      case "stop_dock_setup": this.platform.docks.stopSetup(data.dock_id || data.id); return response(peer, id, "result", successMessage());
      case "stop_all_dock_setups": for (const setupId of this.platform.docks.setupSessions()) this.platform.docks.stopSetup(setupId); return response(peer, id, "result", successMessage());

      case "get_wifi_status": return response(peer, id, "wifi_status", await this.platform.hardware.wifiStatus());
      case "get_all_wifi_networks": {
        const saved = this.platform.hardware.savedWifiNetworks().map(({ password: _password, ...item }) => item);
        // Remote UI releases before the saved-network REST split used this
        // message for visible scan results. Preserve that compatibility when
        // no configured profiles exist.
        const networks = saved.length > 0 ? saved : this.platform.hardware.wifiScanStatus().scan;
        return response(peer, id, "wifi_networks", networks);
      }
      case "get_wifi_network": {
        const value = this.platform.hardware.getWifiNetwork(data.wifi_id ?? data.id);
        if (!value) throw Object.assign(new Error(`WiFi network ${data.wifi_id ?? data.id} not found`), { status: 404 });
        return response(peer, id, "wifi_network", value);
      }
      case "add_wifi_network": return response(peer, id, "wifi_network", await this.platform.hardware.addWifiNetwork(data), 201);
      case "update_wifi_network": {
        const value = await this.platform.hardware.updateWifiNetwork(data.wifi_id ?? data.id, data);
        if (!value) throw Object.assign(new Error("WiFi network not found"), { status: 404 });
        return response(peer, id, "result", value);
      }
      case "del_wifi_network": {
        if (!await this.platform.hardware.deleteWifiNetwork(data.wifi_id ?? data.id)) throw Object.assign(new Error("WiFi network not found"), { status: 404 });
        return response(peer, id, "result", successMessage());
      }
      case "del_all_wifi_networks": await this.platform.hardware.deleteAllWifiNetworks(); return response(peer, id, "result", successMessage());
      case "get_wifi_scan_status": return response(peer, id, "wifi_scan_status", this.platform.hardware.wifiScanStatus());
      case "wifi_scan_start": {
        void this.platform.hardware.scanWifi().catch(() => {});
        return response(peer, id, "result", successMessage());
      }
      case "wifi_scan_stop": return response(peer, id, "wifi_scan_status", this.platform.hardware.stopWifiScan());
      case "wifi_command": await this.platform.hardware.wifiCommand(data.cmd || data.command); return response(peer, id, "result", successMessage());
      case "wifi_network_command": {
        const value = await this.platform.hardware.wifiNetworkCommand(data.wifi_id ?? data.id, data.cmd || data.command);
        if (!value) throw Object.assign(new Error("WiFi network not found"), { status: 404 });
        return response(peer, id, "result", successMessage());
      }

      case "create_standby_inhibitor": {
        const values = db.getSetting("standby_inhibitors", []);
        const inhibitorId = String(data.id || crypto.randomUUID());
        const existingIndex = values.findIndex((entry) => entry.id === inhibitorId);
        const previous = existingIndex >= 0 ? values[existingIndex] : null;
        const item = {
          ...(previous || {}),
          id: inhibitorId,
          who: String(data.who || previous?.who || "Core WebSocket client"),
          why: String(data.why ?? previous?.why ?? ""),
          mode: Number(data.delay) > 0 ? "DELAY" : "BLOCK",
          ...(Number(data.delay) > 0 ? { delay: Number(data.delay) } : {}),
          created: previous?.created ?? 0,
          created_at: previous?.created_at || nowIso(),
          refreshed_at: nowIso()
        };
        if (item.mode !== "DELAY") delete item.delay;
        if (existingIndex >= 0) values[existingIndex] = item;
        else values.push(item);
        db.setSetting("standby_inhibitors", values);
        return response(peer, id, "standby_inhibitor", item, existingIndex >= 0 ? 200 : 201);
      }
      case "delete_standby_inhibitor": case "del_standby_inhibitor": {
        const inhibitorId = data.inhibitor_id || data.id;
        db.setSetting("standby_inhibitors", db.getSetting("standby_inhibitors", []).filter((item) => item.id !== inhibitorId));
        return response(peer, id, "result", successMessage());
      }
      case "del_all_standby_inhibitors": db.setSetting("standby_inhibitors", []); return response(peer, id, "result", successMessage());
      default:
        throw Object.assign(new Error(`Unsupported Core WebSocket request: ${msg}`), { status: 501, errorCode: "NOT_IMPLEMENTED" });
    }
  }

  #allEntities() {
    return [
      ...this.platform.db.listConfiguredEntities(),
      ...this.platform.db.listActivities(),
      ...this.platform.db.listMacros()
    ];
  }

  #findEntity(id) {
    return this.platform.db.getConfiguredEntity(id) || this.platform.db.getActivity(id) || this.platform.db.getMacro(id);
  }

  #commands(entity) {
    if (!entity) return [];
    if (entity.entity_type === "activity") return ["on", "off"].map((cmd_id) => ({ cmd_id }));
    if (entity.entity_type === "macro") return [{ cmd_id: "start" }];
    return (entity.commands || entity.features || []).map((item) => typeof item === "string" ? { cmd_id: item } : item);
  }

  async #command(entityId, commandId, params) {
    const activity = this.platform.db.getActivity(entityId);
    if (activity) {
      if (this.platform.demo?.isIntegration(activity.integration_id)) return this.platform.demo.command(entityId, commandId, params);
      return this.platform.engine.runActivity(entityId, normalizeActivityAction(commandId));
    }
    const macro = this.platform.db.getMacro(entityId);
    if (macro) {
      if (this.platform.demo?.isIntegration(macro.integration_id)) return this.platform.demo.command(entityId, commandId || "start", params);
      return this.platform.engine.runMacro(entityId);
    }
    return this.platform.integrations.command(entityId, commandId, params);
  }

  #setupInfo(record) {
    if (!record) return { id: "", state: "IDLE" };
    return {
      id: record.driver_id || record.metadata?.driver_id || record.id,
      state: record.setup_state || "IDLE",
      require_user_action: record.setup_action || undefined,
      error: record.last_error || undefined
    };
  }

  #reorderPages(profileId, ids) {
    ids.forEach((pageRef, index) => {
      const pageId = typeof pageRef === "object" && pageRef
        ? String(pageRef.page_id || pageRef.id || "")
        : String(pageRef || "");
      const page = pageId ? this.platform.db.getPage(pageId) : null;
      if (page && page.profile_id === profileId) this.platform.db.savePage({ ...page, pos: index });
    });
  }

  #mapEvent(platformEvent) {
    const data = platformEvent.data || {};
    if (["entity.change", "entity.created", "entity.updated", "entity.deleted"].includes(platformEvent.type)) {
      const value = data.entity_id ? data : data.id ? data : {};
      // Current Remote firmware and integration clients use the uppercase
      // CREATE/CHANGE/DELETE values even though an older beta schema lists
      // lowercase new/change/delete values.
      const eventType = platformEvent.type.endsWith("deleted") ? "DELETE" : platformEvent.type.endsWith("created") ? "CREATE" : "CHANGE";
      const entity = coreEntity(value);
      return {
        channel: `entity_${value.entity_type || "entities"}`,
        msg: "entity_change", cat: "ENTITY",
        data: {
          event_type: eventType,
          entity_id: value.entity_id || value.id,
          entity_type: value.entity_type,
          ...(eventType === "DELETE" ? {} : {
            attributes: entity?.attributes || {},
            ...(typeof entity?.attributes?.state === "string" ? { state: entity.attributes.state } : {}),
            new_state: entity
          })
        }
      };
    }
    if (platformEvent.type === "activity.change") {
      const entity = coreEntity(data);
      return {
        channel: "entity_activity", msg: "entity_change", cat: "ENTITY",
        data: {
          event_type: "CHANGE", entity_id: data.entity_id || data.id, entity_type: "activity",
          attributes: entity?.attributes || {},
          ...(typeof entity?.attributes?.state === "string" ? { state: entity.attributes.state } : {}),
          new_state: entity
        }
      };
    }
    if (platformEvent.type === "activity_group.change") return { channel: "activity_groups", msg: "activity_group_change", cat: "ENTITY", data };
    if (platformEvent.type === "profile.change") return {
      channel: "profiles", msg: "profile_change", cat: "UI",
      data: { event_type: data.event_type || "CHANGE", profile_id: data.profile_id || data.id || "default", ...data }
    };
    if (platformEvent.type === "configuration.change") return {
      channel: "configuration", msg: "configuration_change", cat: "REMOTE",
      data: data.new_state ? { new_state: data.new_state } : { new_state: data }
    };
    if (platformEvent.type === "integration.setup") {
      return {
        channel: "integrations", msg: "integration_setup_change", cat: "DEVICE",
        data: {
          event_type: data.event_type || "SETUP",
          driver_id: data.driver_id || data.id,
          state: data.state || "SETUP",
          ...(data.error ? { error: data.error } : {}),
          ...(data.require_user_action ? { require_user_action: data.require_user_action } : {})
        }
      };
    }
    if (["integration.status", "integration.device_state"].includes(platformEvent.type)) {
      const record = data.id ? data : this.platform.db.getIntegration(data.integration_id);
      if (!record) return null;
      const rawDriverState = String(record.status || data.status || "IDLE").toUpperCase();
      const driverState = ({ CONNECTED: "ACTIVE", DISCONNECTED: "IDLE", UNKNOWN: "IDLE" })[rawDriverState] ||
        (["NOT_CONFIGURED", "IDLE", "CONNECTING", "ACTIVE", "RECONNECTING", "ERROR"].includes(rawDriverState) ? rawDriverState : "IDLE");
      const rawDeviceState = String(record.device_state || data.device_state || "UNKNOWN").toUpperCase();
      const deviceState = ["UNKNOWN", "CONNECTING", "CONNECTED", "DISCONNECTED", "ERROR"].includes(rawDeviceState) ? rawDeviceState : "UNKNOWN";
      return {
        channel: "integrations", msg: "integration_state", cat: "DEVICE",
        data: {
          driver_id: record.driver_id || record.metadata?.driver_id || data.driver_id || record.id,
          integration_id: record.id || data.integration_id,
          driver_state: driverState,
          device_state: deviceState,
          // Compatibility alias used by earlier integrations.
          state: driverState
        }
      };
    }
    if (platformEvent.type === "integration.discovery") return {
      channel: "integrations", msg: "integration_discovery", cat: "DEVICE",
      data: {
        event_type: ["START", "STOP", "DISCOVER"].includes(String(data.event_type || "").toUpperCase()) ? String(data.event_type).toUpperCase() : "DISCOVER",
        ...(data.integration || data.driver || data.new_state ? { integration: data.integration || data.driver || data.new_state } : {})
      }
    };
    if (platformEvent.type.startsWith("integration.driver_")) {
      const record = data.id ? data : this.platform.db.getIntegration(data.integration_id);
      return {
        channel: "integrations", msg: "integration_driver_change", cat: "DEVICE",
        data: {
          event_type: platformEvent.type.endsWith("deleted") ? "DELETE" : platformEvent.type.endsWith("created") ? "NEW" : "CHANGE",
          driver_id: record?.driver_id || record?.metadata?.driver_id || data.driver_id || data.id,
          ...(platformEvent.type.endsWith("deleted") ? {} : { new_state: integrationDriver(record) })
        }
      };
    }
    if (platformEvent.type.startsWith("integration.")) {
      const record = data.id ? data : this.platform.db.getIntegration(data.integration_id);
      if (!record && !platformEvent.type.endsWith("deleted")) return null;
      return {
        channel: "integrations", msg: "integration_change", cat: "DEVICE",
        data: {
          event_type: platformEvent.type.endsWith("deleted") ? "DELETE" : platformEvent.type.endsWith("created") ? "NEW" : "CHANGE",
          integration_id: data.id || data.integration_id,
          driver_id: record?.driver_id || record?.metadata?.driver_id || data.driver_id,
          ...(platformEvent.type.endsWith("deleted") ? {} : { new_state: integrationInstance(record) })
        }
      };
    }
    if (platformEvent.type === "wifi.change") return { channel: "wifi", msg: "wifi_change", cat: "REMOTE", data: normalizeWifiEvent(data) };
    if (platformEvent.type === "hardware.wifi_scan_error") return { channel: "wifi", msg: "wifi_change", cat: "REMOTE", data: { event: "SCAN_FAILED" } };
    if (platformEvent.type === "bluetooth.pairing") {
      const message = String(data.msg || "bt_pairing_started");
      const mappedMessage = message === "bt_pairing_auth" ? "bt_pairing_auth_request" : message;
      const { msg: _msg, ...messageData } = data;
      return {
        // The native configurator already subscribes to configuration events;
        // keeping Bluetooth pairing on that channel avoids requiring a new
        // firmware-specific subscription while preserving the native message
        // names it listens for.
        channel: "configuration",
        msg: mappedMessage,
        cat: "DEVICE",
        data: messageData
      };
    }
    if (platformEvent.type === "power.mode") {
      const mode = normalizePowerMode(data.mode);
      const battery = normalizeBattery(data.battery || {});
      return [
        { channel: "power_mode", msg: "power_mode_change", cat: "REMOTE", data: { mode } },
        { channel: "battery_status", msg: "battery_status", cat: "REMOTE", data: battery }
      ];
    }
    if (platformEvent.type === "battery.status") return { channel: "battery_status", msg: "battery_status", cat: "REMOTE", data: normalizeBattery(data) };
    if (platformEvent.type === "ambient.light") return {
      channel: "ambient_light", msg: "ambient_light_change", cat: "REMOTE",
      data: { intensity: Math.max(0, Math.min(65535, Math.round(Number(data.intensity ?? data.value ?? 0) || 0))) }
    };
    if (platformEvent.type === "ir.learn") return {
      channel: "emitters", msg: "ir_learning", cat: "DEVICE",
      data: { device_id: data.device_id || data.id || "virtual-ir", event_type: data.event_type || "CODE", ...(data.code ? { code: data.code } : {}) }
    };
    if (platformEvent.type === "system.warning") return {
      channel: "all", msg: "warning", cat: "REMOTE",
      data: { event: data.event || "LOW_BATTERY", ...(data.shutdown === undefined ? {} : { shutdown: Boolean(data.shutdown) }), ...(data.message ? { message: String(data.message) } : {}) }
    };
    if (platformEvent.type === "software.update") return { channel: "software_update", msg: "software_update", cat: "REMOTE", data };
    if (platformEvent.type === "dock.change") return { channel: "docks", msg: "dock_change", cat: "DEVICE", data };
    if (platformEvent.type === "dock.port") return { channel: "docks", msg: "dock_change", cat: "DEVICE", data: { event_type: "CHANGE", dock_id: data.dock_id, new_state: this.platform.docks.get(data.dock_id) || data } };
    if (platformEvent.type === "dock.state") return { channel: "docks", msg: "dock_state", cat: "DEVICE", data };
    if (platformEvent.type === "dock.discovery") return { channel: "docks", msg: "dock_discovery", cat: "DEVICE", data };
    if (platformEvent.type === "dock.setup") return { channel: "docks", msg: "dock_setup_change", cat: "DEVICE", data };
    if (platformEvent.type === "dock.update") return { channel: "docks", msg: "dock_update_change", cat: "DEVICE", data };
    if (platformEvent.type === "assistant.event") return { channel: "assistant", msg: "assistant_event", cat: "ENTITY", data };
    if (["media.session", "media.queue"].includes(platformEvent.type)) return { channel: "media", msg: platformEvent.type === "media.queue" ? "media_queue_change" : "media_session_event", cat: "ENTITY", data };
    return null;
  }}
