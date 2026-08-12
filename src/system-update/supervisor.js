const DEFAULT_API_BASE = "http://supervisor";
const DEFAULT_HOME_ASSISTANT_UPDATE_ENTITY = "update.uc_virtual_remote_update";

function normalizedVersion(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

function enabledFlag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function supervisorPayload(payload) {
  if (payload && typeof payload === "object" && payload.result === "ok" && Object.prototype.hasOwnProperty.call(payload, "data")) {
    return payload.data;
  }
  return payload;
}

export function supervisorManagedEnvironment(env = process.env) {
  return enabledFlag(env.UCVR_SUPERVISOR_MANAGED);
}

export class SupervisorUpdateAdapter {
  constructor(options = {}) {
    this.apiBase = String(options.apiBase || process.env.UCVR_SUPERVISOR_API_BASE || DEFAULT_API_BASE).replace(/\/$/, "");
    this.homeAssistantApiBase = String(
      options.homeAssistantApiBase
      || process.env.UCVR_HOME_ASSISTANT_API_BASE
      || `${this.apiBase}/core/api`
    ).replace(/\/$/, "");
    this.token = String(options.token || process.env.SUPERVISOR_TOKEN || "").trim();
    this.installedVersion = null;
    this.latestVersion = null;
    this.addonSlug = null;
    this.addonName = null;
  }

  #headers(json = false) {
    if (!this.token) throw Object.assign(new Error("Home Assistant Supervisor API token is unavailable. Ensure the add-on has hassio_api enabled"), { status: 503 });
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      ...(json ? { "Content-Type": "application/json" } : {})
    };
  }

  async #requestBase(base, pathname, options = {}, unwrapSupervisor = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || 15_000));
    try {
      const response = await fetch(`${base}${pathname}`, {
        method: options.method || "GET",
        headers: this.#headers(options.body !== undefined),
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal
      });
      let payload = null;
      try { payload = await response.json(); } catch {}
      if (!response.ok || payload?.result === "error") {
        const message = payload?.message || payload?.error || `Home Assistant request failed with HTTP ${response.status}`;
        throw Object.assign(new Error(String(message)), { status: response.status || 502 });
      }
      return unwrapSupervisor ? supervisorPayload(payload) : payload;
    } finally {
      clearTimeout(timer);
    }
  }

  async #request(pathname, options = {}) {
    return await this.#requestBase(this.apiBase, pathname, options, true);
  }

  async #coreRequest(pathname, options = {}) {
    try {
      return await this.#requestBase(this.homeAssistantApiBase, pathname, options, false);
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        throw Object.assign(
          new Error("Home Assistant Core API access is unavailable. Ensure the add-on has homeassistant_api enabled"),
          { status: error.status }
        );
      }
      throw error;
    }
  }

  #rememberAddonInfo(info) {
    this.addonSlug = String(info?.slug || "").trim() || this.addonSlug;
    this.addonName = String(info?.name || "").trim() || this.addonName || "UC Virtual Remote";
    this.installedVersion = normalizedVersion(info?.version || info?.installed) || this.installedVersion;
    this.latestVersion = normalizedVersion(info?.version_latest) || this.latestVersion;
  }

  async #resolveHomeAssistantUpdateEntity() {
    const states = await this.#coreRequest("/states");
    if (!Array.isArray(states)) {
      throw Object.assign(new Error("Home Assistant returned an invalid state list while resolving the add-on update entity"), { status: 502 });
    }

    const updateStates = states.filter((state) => String(state?.entity_id || "").startsWith("update."));
    const preferred = updateStates.find((state) => state.entity_id === DEFAULT_HOME_ASSISTANT_UPDATE_ENTITY);
    if (preferred) return preferred.entity_id;

    const expectedName = String(this.addonName || "UC Virtual Remote").trim().toLowerCase();
    const installedVersion = normalizedVersion(this.installedVersion);
    const latestVersion = normalizedVersion(this.latestVersion);
    const nameMatches = (state) => String(state?.attributes?.friendly_name || "").toLowerCase().includes(expectedName);
    const versionMatches = (state) => {
      const installed = normalizedVersion(state?.attributes?.installed_version);
      const latest = normalizedVersion(state?.attributes?.latest_version);
      return Boolean(
        (!installedVersion || installed === installedVersion)
        && (!latestVersion || latest === latestVersion)
      );
    };

    const matched = updateStates.find((state) => nameMatches(state) && versionMatches(state))
      || updateStates.find(nameMatches)
      || updateStates.find((state) => String(state.entity_id).includes("uc_virtual_remote"));
    if (matched) return matched.entity_id;

    throw Object.assign(
      new Error("Unable to find the Home Assistant update entity for UC Virtual Remote. Ensure the Supervisor integration is loaded and the add-on has homeassistant_api enabled"),
      { status: 503 }
    );
  }

  async check(force = false) {
    if (force) await this.#request("/store/reload", { method: "POST" });
    const info = await this.#request("/addons/self/info");
    this.#rememberAddonInfo(info);
    const available = Boolean(info?.update_available)
      || (this.latestVersion && this.installedVersion && this.latestVersion !== this.installedVersion);
    if (!available || !this.latestVersion) return null;
    return {
      id: `supervisor-addon-${this.latestVersion.replace(/[^a-zA-Z0-9._-]+/g, "-")}`,
      version: this.latestVersion,
      title: { en: `UC Virtual Remote ${this.latestVersion}` },
      description: {
        en: `Home Assistant Supervisor will update the complete UC Virtual Remote add-on from ${this.installedVersion || "the installed version"} to ${this.latestVersion}.`
      },
      release_date: new Date().toISOString(),
      channel: "DEFAULT",
      source: "HOME_ASSISTANT_SUPERVISOR",
      supervisor_managed: true
    };
  }

  async install() {
    if (!this.addonSlug || !this.addonName) {
      const info = await this.#request("/addons/self/info");
      this.#rememberAddonInfo(info);
    }
    if (!this.addonSlug) {
      throw Object.assign(new Error("Unable to determine Home Assistant add-on slug"), { status: 500 });
    }

    // Supervisor deliberately forbids an add-on from calling its own Store update
    // endpoint. Delegate the update to Home Assistant Core's Supervisor update entity
    // instead; Core then performs the Store update under its own trusted identity.
    const entityId = await this.#resolveHomeAssistantUpdateEntity();
    return await this.#coreRequest("/services/update/install", {
      method: "POST",
      body: { entity_id: entityId, backup: false },
      timeoutMs: 300_000
    });
  }
}
