const DEFAULT_API_BASE = "http://supervisor";

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
    this.token = String(options.token || process.env.SUPERVISOR_TOKEN || "").trim();
    this.installedVersion = null;
    this.latestVersion = null;
  }

  #headers(json = false) {
    if (!this.token) throw Object.assign(new Error("Home Assistant Supervisor API token is unavailable. Ensure the add-on has hassio_api enabled"), { status: 503 });
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      ...(json ? { "Content-Type": "application/json" } : {})
    };
  }

  async #request(pathname, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || 15_000));
    try {
      const response = await fetch(`${this.apiBase}${pathname}`, {
        method: options.method || "GET",
        headers: this.#headers(options.body !== undefined),
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal
      });
      let payload = null;
      try { payload = await response.json(); } catch {}
      if (!response.ok || payload?.result === "error") {
        const message = payload?.message || payload?.error || `Home Assistant Supervisor request failed with HTTP ${response.status}`;
        throw Object.assign(new Error(String(message)), { status: response.status || 502 });
      }
      return supervisorPayload(payload);
    } finally {
      clearTimeout(timer);
    }
  }

  async check(force = false) {
    if (force) await this.#request("/store/reload", { method: "POST" });
    const info = await this.#request("/addons/self/info");
    this.installedVersion = normalizedVersion(info?.version || info?.installed);
    this.latestVersion = normalizedVersion(info?.version_latest);
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
    return await this.#request("/store/addons/self/update", {
      method: "POST",
      body: { backup: false, background: true },
      timeoutMs: 30_000
    });
  }
}
