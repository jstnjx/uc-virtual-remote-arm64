import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sha256 } from "../shared/util.js";
import { logger } from "../shared/logger.js";

const log = logger("sync-mode");
const SETTING_KEY = "sync_mode";
const SECRET_KEY = "sync_mode_secrets";
const ENTRY_ID = "uc-remote-sync";
const DRIVER_ID = "remote_sync";
const IMAGE = "ghcr.io/jstnjx/uc-remote-sync";
const DEFAULT_SECTIONS = [
  "resources",
  "entities",
  "activities",
  "activity_groups",
  "macros",
  "remotes",
  "profiles",
  "docks"
];

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function bool(value, fallback = false) {
  return value === undefined ? fallback : Boolean(value);
}

function integer(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function list(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[\n,]+/);
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function tokenMap(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, token]) => [String(key).trim(), String(token || "").trim()])
        .filter(([key, token]) => key && token)
    );
  }
  return Object.fromEntries(
    list(value)
      .map((item) => {
        const index = item.indexOf("=");
        return index > 0 ? [item.slice(0, index).trim(), item.slice(index + 1).trim()] : ["", ""];
      })
      .filter(([key, token]) => key && token)
  );
}

function atomicJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filename);
}

function safeJson(filename, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch {
    return fallback;
  }
}

function publicValue(value) {
  if (value === null || value === undefined) return null;
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  return JSON.stringify(value);
}

function flatten(prefix, value, output = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    output.push({ key: prefix, value: publicValue(value) });
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    flatten(prefix ? `${prefix}.${key}` : key, child, output);
  }
  return output;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class SyncModeService {
  constructor(platform) {
    this.platform = platform;
    this.applying = false;
    this.lastError = null;
  }

  defaults() {
    return {
      enabled: false,
      integration: {
        image: IMAGE,
        version: "latest"
      },
      primary: {
        node_name: `${this.platform.name} Primary`,
        agent_port: 11081,
        agent_public_url: "",
        virtual_dock_port: 11083,
        network_interface: "",
        network_mac: "",
        network_broadcasts: [],
        physical_dock_default_token: "",
        physical_dock_tokens: {}
      },
      sync: {
        sections: [...DEFAULT_SECTIONS],
        interval_seconds: 3600,
        auto_sync: true,
        prune: false,
        use_standby_inhibitor: true,
        verify_existing_resource_hashes: false
      },
      hardware: {
        enforce_wifi_enabled: true,
        keep_wifi_connected_during_standby: true,
        disable_standby: false,
        simulator_battery_level: 82,
        simulator_charging: false,
        simulator_wifi_state: "CONNECTED"
      }
    };
  }

  settings() {
    const defaults = this.defaults();
    const stored = object(this.platform.db.getSetting(SETTING_KEY, {}));
    return this.#normalize({
      ...defaults,
      ...stored,
      integration: { ...defaults.integration, ...object(stored.integration) },
      primary: { ...defaults.primary, ...object(stored.primary) },
      sync: { ...defaults.sync, ...object(stored.sync) },
      hardware: { ...defaults.hardware, ...object(stored.hardware) }
    });
  }

  update(patch = {}) {
    const current = this.settings();
    const next = this.#normalize({
      ...current,
      ...object(patch),
      integration: { ...current.integration, ...object(patch.integration) },
      primary: { ...current.primary, ...object(patch.primary) },
      sync: { ...current.sync, ...object(patch.sync) },
      hardware: { ...current.hardware, ...object(patch.hardware) }
    });
    this.platform.db.setSetting(SETTING_KEY, next);
    this.platform.events.publish("sync_mode.change", {
      event_type: "CHANGE",
      new_state: { sync_mode: next }
    });
    return next;
  }

  summary() {
    const settings = this.settings();
    const managed = this.platform.externalIntegrations?.managedRecord?.(DRIVER_ID) || null;
    const integration = this.#integrationRecord();
    return {
      enabled: settings.enabled,
      applying: this.applying,
      configured: fs.existsSync(this.configPath()),
      integration_id: integration?.id || null,
      integration_state: integration?.status || "NOT_INSTALLED",
      container: managed?.container || null,
      last_error: this.lastError
    };
  }

  async start() {
    if (!this.settings().enabled) return;
    setImmediate(() => {
      this.apply({}, { startup: true }).catch((error) => {
        this.lastError = error.message;
        log.error("Automatic Sync Mode startup failed:", error);
      });
    });
  }

  async stop() {}

  configPath() {
    return path.join(
      this.platform.dataDir,
      "external-integrations",
      "config",
      "ucvr-intg-uc-remote-sync",
      "remote-sync.json"
    );
  }

  async status(refresh = false) {
    const settings = this.settings();
    const secrets = object(this.platform.db.getSetting(SECRET_KEY, {}));
    const integration = this.#integrationRecord();
    const managed = this.platform.externalIntegrations?.managedRecord?.(DRIVER_ID) || null;
    const jobs = this.platform.externalIntegrations?.setupJobs?.() || [];
    const job = jobs.find((item) => item.driver_id === DRIVER_ID) || null;
    const [hardware, agent] = await Promise.all([
      this.platform.hardware.status(refresh).catch(() => this.platform.hardware.cached || {}),
      settings.enabled
        ? this.#agentSnapshot(settings, secrets)
        : Promise.resolve({ health: null, status: null, satellites: [] })
    ]);

    const warnings = [];
    if (
      settings.sync.sections.includes("docks")
      && !settings.primary.physical_dock_default_token
      && !Object.keys(settings.primary.physical_dock_tokens).length
    ) {
      warnings.push("Dock synchronization is enabled but no physical Dock API token is configured.");
    }
    if (!secrets.api_key) {
      warnings.push("The dedicated Remote Sync Core API key has not been provisioned yet.");
    }
    if (settings.enabled && !managed && !job) {
      warnings.push("Remote Sync is enabled but its managed container is not installed.");
    }
    if (this.lastError) warnings.push(this.lastError);

    return {
      settings,
      applying: this.applying,
      configured: fs.existsSync(this.configPath()),
      credentials: {
        api_key_provisioned: Boolean(secrets.api_key),
        api_key_id: secrets.api_key_id || null,
        agent_token_provisioned: Boolean(secrets.agent_token)
      },
      integration: integration
        ? {
            id: integration.id,
            driver_id: integration.driver_id || integration.metadata?.driver_id || DRIVER_ID,
            name: integration.name,
            status: integration.status,
            device_state: integration.device_state,
            version: integration.driver_version,
            enabled: integration.enabled,
            configured: integration.configured,
            error: integration.last_error || null
          }
        : null,
      managed,
      job,
      agent,
      warnings,
      catalog: this.catalog(hardware)
    };
  }

  async apply(patch = {}, options = {}) {
    if (this.applying) {
      throw Object.assign(new Error("Sync Mode is already being applied"), { status: 409 });
    }
    this.applying = true;
    this.lastError = null;
    try {
      const settings = this.update({ ...patch, enabled: true });
      await this.#applyPrerequisites(settings);
      const existing = safeJson(this.configPath(), {});
      const secrets = this.#ensureCredentials(Boolean(options.rotate_credentials), existing);
      atomicJson(this.configPath(), await this.#remoteSyncConfig(settings, secrets, existing));

      await this.platform.externalIntegrations.addGhcrIntegration({
        id: ENTRY_ID,
        driver_id: DRIVER_ID,
        name: "Remote Sync",
        description: "Managed Primary synchronization service for UC Virtual Remote.",
        author: "jstnjx",
        image: settings.integration.image,
        version: settings.integration.version,
        websocket_path: "/intg",
        preconfigured: true,
        environment: {
          UC_MDNS_HOSTNAME: "ucvr-remote-sync",
          ...(settings.primary.network_mac
            ? { REMOTE_SYNC_PRIMARY_MAC: settings.primary.network_mac }
            : {}),
          ...(settings.primary.network_broadcasts.length
            ? { REMOTE_SYNC_PRIMARY_BROADCASTS: settings.primary.network_broadcasts.join(",") }
            : {})
        }
      });

      const managed = this.platform.externalIntegrations.managedRecord(DRIVER_ID);
      let job = null;
      if (options.startup && managed) {
        await this.platform.externalIntegrations.setRunning(DRIVER_ID, true);
        const integration = this.#integrationRecord();
        if (integration) {
          await this.platform.integrations.connect(integration.id).catch(() => {});
        }
      } else {
        job = await this.platform.externalIntegrations.startSetup(DRIVER_ID, {
          input_values: {
            ucvr_install_source: "image",
            ucvr_install_version: settings.integration.version
          }
        });
      }

      this.platform.events.publish("sync_mode.change", {
        event_type: "APPLY",
        new_state: { sync_mode: this.summary() }
      });
      const state = await this.status(true);
      return { ...state, job: job || state.job };
    } catch (error) {
      this.lastError = error.message;
      throw error;
    } finally {
      this.applying = false;
    }
  }

  async disable() {
    const settings = this.update({ enabled: false });
    const integration = this.#integrationRecord();
    if (integration) {
      await this.platform.integrations.disconnect(integration.id, { disable: true }).catch(() => {});
    }
    await this.platform.externalIntegrations.setRunning(DRIVER_ID, false).catch(() => {});
    this.platform.events.publish("sync_mode.change", {
      event_type: "DISABLE",
      new_state: { sync_mode: this.summary() }
    });
    return { settings, ...(await this.status(false)) };
  }

  async rotateCredentials() {
    const settings = this.settings();
    const existing = safeJson(this.configPath(), {});
    const secrets = this.#ensureCredentials(true, existing);
    atomicJson(this.configPath(), await this.#remoteSyncConfig(settings, secrets, existing));

    if (this.platform.externalIntegrations.managedRecord(DRIVER_ID)) {
      const integration = this.#integrationRecord();
      if (integration) await this.platform.integrations.disconnect(integration.id).catch(() => {});
      await this.platform.externalIntegrations.setRunning(DRIVER_ID, false).catch(() => {});
      await this.platform.externalIntegrations.setRunning(DRIVER_ID, true);
      await delay(750);
      if (integration) await this.platform.integrations.connect(integration.id).catch(() => {});
    }
    return this.status(true);
  }

  async sync(dryRun = false) {
    const settings = this.settings();
    const secrets = object(this.platform.db.getSetting(SECRET_KEY, {}));
    return this.#agentRequest(settings, secrets, "/v1/sync", {
      method: "POST",
      body: JSON.stringify({ force: true, dry_run: Boolean(dryRun) })
    });
  }

  async satelliteAction(peerId, action) {
    const allowed = new Set([
      "sync",
      "preview",
      "enable",
      "disable",
      "rediscover",
      "rotate",
      "unpair",
      "remove"
    ]);
    if (!allowed.has(action)) {
      throw Object.assign(new Error(`Unsupported Satellite action ${action}`), { status: 400 });
    }
    const settings = this.settings();
    const secrets = object(this.platform.db.getSetting(SECRET_KEY, {}));
    return this.#agentRequest(
      settings,
      secrets,
      `/v1/satellites/${encodeURIComponent(peerId)}/actions/${encodeURIComponent(action)}`,
      { method: "POST" }
    );
  }

  catalog(hardware = {}) {
    const configuration = this.platform.configuration.getAll();
    const apiOnly = new Set([
      "bt.advertisement_name",
      "bt.enable_debug_port",
      "bt.version",
      "network.bt.address",
      "network.wake_on_wlan.enabled",
      "network.wifi.bands",
      "network.wifi.ipv4_type",
      "software_update.ota_window_start",
      "software_update.ota_window_end",
      "restart_required"
    ]);

    const configurationItems = [];
    for (const [section, value] of Object.entries(configuration)) {
      for (const item of flatten(section, value)) {
        configurationItems.push({
          ...item,
          source: "core-configuration",
          availability: apiOnly.has(item.key)
            ? "api-or-physical-remote"
            : "default-web-configurator",
          default_web_configurator: !apiOnly.has(item.key)
        });
      }
    }

    const hardwareItems = flatten("native_hardware", hardware).map((item) => ({
      ...item,
      source: "host-hardware",
      availability: "physical-remote-or-management-api",
      default_web_configurator: false
    }));

    const identityItems = [
      ["remote.id", this.platform.id],
      ["remote.name", this.platform.name],
      ["remote.model", "UCR3"],
      ["remote.hostname", this.platform.hostname],
      ["remote.rest_port", this.platform.restPort],
      ["remote.websocket_port", this.platform.websocketPort],
      ["remote.timezone", this.platform.timezone]
    ].map(([key, value]) => ({
      key,
      value,
      source: "core-runtime",
      availability: "api-only",
      default_web_configurator: false
    }));

    return [
      { id: "identity", title: "Remote identity and API", items: identityItems },
      { id: "configuration", title: "Remote configuration", items: configurationItems },
      { id: "hardware", title: "Physical and host hardware", items: hardwareItems }
    ];
  }

  #normalize(value) {
    const defaults = this.defaults();
    const integration = object(value.integration);
    const primary = object(value.primary);
    const sync = object(value.sync);
    const hardware = object(value.hardware);
    const sections = list(sync.sections).filter((item) => DEFAULT_SECTIONS.includes(item));

    return {
      enabled: bool(value.enabled, defaults.enabled),
      integration: {
        image: /^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_./-]+$/i.test(String(integration.image || ""))
          ? String(integration.image)
          : IMAGE,
        version: String(integration.version || "latest").trim() || "latest"
      },
      primary: {
        node_name:
          String(primary.node_name || defaults.primary.node_name).trim().slice(0, 80)
          || defaults.primary.node_name,
        agent_port: integer(primary.agent_port, 1, 65535, defaults.primary.agent_port),
        agent_public_url: String(primary.agent_public_url || "").trim(),
        virtual_dock_port: integer(
          primary.virtual_dock_port,
          1,
          65535,
          defaults.primary.virtual_dock_port
        ),
        network_interface: String(primary.network_interface || "").trim(),
        network_mac: String(primary.network_mac || "").trim().toUpperCase(),
        network_broadcasts: list(primary.network_broadcasts),
        physical_dock_default_token: String(primary.physical_dock_default_token || "").trim(),
        physical_dock_tokens: tokenMap(primary.physical_dock_tokens)
      },
      sync: {
        sections: sections.length ? sections : [...DEFAULT_SECTIONS],
        interval_seconds: integer(
          sync.interval_seconds,
          300,
          86400,
          defaults.sync.interval_seconds
        ),
        auto_sync: bool(sync.auto_sync, defaults.sync.auto_sync),
        prune: bool(sync.prune, defaults.sync.prune),
        use_standby_inhibitor: bool(
          sync.use_standby_inhibitor,
          defaults.sync.use_standby_inhibitor
        ),
        verify_existing_resource_hashes: bool(
          sync.verify_existing_resource_hashes,
          defaults.sync.verify_existing_resource_hashes
        )
      },
      hardware: {
        enforce_wifi_enabled: bool(
          hardware.enforce_wifi_enabled,
          defaults.hardware.enforce_wifi_enabled
        ),
        keep_wifi_connected_during_standby: bool(
          hardware.keep_wifi_connected_during_standby,
          defaults.hardware.keep_wifi_connected_during_standby
        ),
        disable_standby: bool(hardware.disable_standby, defaults.hardware.disable_standby),
        simulator_battery_level: integer(
          hardware.simulator_battery_level,
          0,
          100,
          defaults.hardware.simulator_battery_level
        ),
        simulator_charging: bool(
          hardware.simulator_charging,
          defaults.hardware.simulator_charging
        ),
        simulator_wifi_state: ["CONNECTED", "DISCONNECTED", "CONNECTING"].includes(
          String(hardware.simulator_wifi_state)
        )
          ? String(hardware.simulator_wifi_state)
          : defaults.hardware.simulator_wifi_state
      }
    };
  }

  #integrationRecord() {
    return (
      this.platform.db.listIntegrations().find(
        (item) =>
          String(item.driver_id || item.metadata?.driver_id || item.id) === DRIVER_ID
          && !item.metadata?.instance_alias
      ) || null
    );
  }

  #ensureCredentials(rotate, existing = {}) {
    const current = object(this.platform.db.getSetting(SECRET_KEY, {}));
    if (rotate && current.api_key_id) this.platform.db.deleteApiKey(current.api_key_id);

    let apiKey = !rotate ? String(current.api_key || existing?.remote?.api_key || "") : "";
    let apiKeyId = !rotate ? current.api_key_id : null;
    if (!apiKey || !apiKeyId || !this.platform.db.getApiKey(apiKeyId)) {
      apiKey = crypto.randomBytes(32).toString("base64url");
      const record = this.platform.db.createApiKey(
        "UC Remote Sync Primary",
        sha256(apiKey),
        ["admin"],
        { description: "Managed automatically by Sync Mode" }
      );
      apiKeyId = record.id;
    }

    const next = {
      api_key: apiKey,
      api_key_id: apiKeyId,
      api_key_created_at: new Date().toISOString(),
      agent_token: !rotate ? String(current.agent_token || existing?.agent_token || "") : ""
    };
    if (next.agent_token.length < 32) {
      next.agent_token = crypto.randomBytes(32).toString("base64url");
    }
    this.platform.db.setSetting(SECRET_KEY, next);
    return next;
  }

  async #applyPrerequisites(settings) {
    const network = this.platform.configuration.get("network");
    this.platform.configuration.update("network", {
      ...network,
      ...(settings.hardware.enforce_wifi_enabled ? { wifi_enabled: true } : {}),
      wake_on_wlan: {
        ...object(network.wake_on_wlan),
        enabled: settings.hardware.keep_wifi_connected_during_standby
      }
    });

    if (settings.hardware.disable_standby) {
      this.platform.configuration.update("power_saving", {
        ...this.platform.configuration.get("power_saving"),
        standby_sec: 0
      });
    }

    this.platform.db.setSetting("simulator", {
      ...object(this.platform.db.getSetting("simulator", {})),
      battery_level: settings.hardware.simulator_battery_level,
      charging: settings.hardware.simulator_charging,
      wifi_state: settings.hardware.simulator_wifi_state
    });
  }

  async #remoteSyncConfig(settings, secrets, existing = {}) {
    const hardware = await this.platform.hardware
      .status(false)
      .catch(() => this.platform.hardware.cached || {});
    const selectedInterface =
      settings.primary.network_interface
      || hardware?.selection?.wifi_adapter
      || hardware?.current?.wifi?.adapter
      || null;
    const mac =
      settings.primary.network_mac
      || hardware?.current?.wifi?.mac
      || hardware?.current?.wifi?.address_mac
      || null;

    const existingPhysical = object(existing.physical_docks);
    const configuredTokens = settings.primary.physical_dock_tokens;
    const physicalTokens = Object.keys(configuredTokens).length
      ? configuredTokens
      : object(existingPhysical.tokens);

    return {
      schema_version: 6,
      role: "master",
      node_id: `ucvr-${String(this.platform.id || "primary")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}`,
      node_name: settings.primary.node_name,
      pairing_identifier: null,
      pairing: {
        ready_to_pair: false,
        paired_master_id: null,
        paired_master_name: null,
        paired_at: null,
        master_agent_url: null,
        master_command_token: null,
        master_mac: null,
        master_broadcasts: []
      },
      remote: {
        host: "127.0.0.1",
        api_key: secrets.api_key,
        scheme: "http",
        port: this.platform.restPort,
        mac,
        broadcasts: settings.primary.network_broadcasts,
        interface: selectedInterface,
        network_source: "uc-virtual-remote-sync-mode",
        verify_tls: false
      },
      network_overrides: {
        mac: settings.primary.network_mac || null,
        broadcasts: settings.primary.network_broadcasts
      },
      agent_token: secrets.agent_token,
      agent_port: settings.primary.agent_port,
      agent_public_url: settings.primary.agent_public_url || null,
      virtual_dock_port: settings.primary.virtual_dock_port,
      physical_docks: {
        default_token:
          settings.primary.physical_dock_default_token
          || existingPhysical.default_token
          || "",
        tokens: physicalTokens
      },
      peers: Array.isArray(existing.peers) ? existing.peers : [],
      sync: { ...settings.sync }
    };
  }

  async #agentSnapshot(settings, secrets) {
    const [health, status, satellites] = await Promise.all([
      this.#agentRequest(settings, secrets, "/healthz", {}, false).catch(() => null),
      this.#agentRequest(settings, secrets, "/v1/status").catch(() => null),
      this.#agentRequest(settings, secrets, "/v1/satellites").catch(() => [])
    ]);
    return {
      health,
      status,
      satellites: Array.isArray(satellites) ? satellites : satellites?.satellites || []
    };
  }

  async #agentRequest(settings, secrets, endpoint, options = {}, authenticated = true) {
    if (authenticated && !secrets.agent_token) {
      throw Object.assign(new Error("Remote Sync agent token is unavailable"), { status: 409 });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(
        `http://127.0.0.1:${settings.primary.agent_port}${endpoint}`,
        {
          ...options,
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(authenticated ? { Authorization: `Bearer ${secrets.agent_token}` } : {}),
            ...(options.headers || {})
          }
        }
      );
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }
      if (!response.ok) {
        throw Object.assign(
          new Error(
            payload?.message
            || payload?.error
            || `Remote Sync returned HTTP ${response.status}`
          ),
          { status: response.status }
        );
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export { DEFAULT_SECTIONS as SYNC_MODE_SECTIONS };
