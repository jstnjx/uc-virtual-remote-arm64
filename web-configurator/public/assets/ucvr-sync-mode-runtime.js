(function ucvrSyncModeRuntimePage() {
  const BASE = String(window.__UCVR_BASE_PATH__ || "").replace(/\/$/, "");
  const API = `${BASE}/api/cfg/sync_mode`;
  const ROOT_ID = "ucvr-sync-mode-runtime";
  const MENU_ATTRIBUTE = "data-ucvr-sync-mode-menu";
  const ROUTE_QUERY = "ucvr_sync_mode=1";
  const SECTIONS = [
    "resources",
    "entities",
    "activities",
    "activity_groups",
    "macros",
    "remotes",
    "profiles",
    "docks",
  ];

  let status = null;
  let busy = false;
  let refreshTimer = null;

  function active() {
    return String(window.location.hash || "").includes(ROUTE_QUERY);
  }

  function escapeHtml(value) {
    const span = document.createElement("span");
    span.textContent = String(value ?? "");
    return span.innerHTML;
  }

  function checked(value) {
    return value ? " checked" : "";
  }

  function selected(value, expected) {
    return String(value) === String(expected) ? " selected" : "";
  }

  async function request(payload = null) {
    const response = await fetch(API, {
      method: payload ? "PATCH" : "GET",
      credentials: "same-origin",
      headers: payload ? { "Content-Type": "application/json" } : {},
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok) {
      throw new Error(data?.message || data?.error || text || `HTTP ${response.status}`);
    }
    return data;
  }

  function settings() {
    return status?.settings || {
      enabled: false,
      integration: {
        image: "ghcr.io/jstnjx/uc-remote-sync",
        version: "latest",
      },
      primary: {
        node_name: "UC Virtual Remote Primary",
        agent_port: 11081,
        agent_public_url: "",
        virtual_dock_port: 11083,
        network_interface: "",
        network_mac: "",
        network_broadcasts: [],
        physical_dock_default_token: "",
        physical_dock_tokens: {},
      },
      sync: {
        sections: [...SECTIONS],
        interval_seconds: 3600,
        auto_sync: true,
        prune: false,
        use_standby_inhibitor: true,
        verify_existing_resource_hashes: false,
      },
      hardware: {
        enforce_wifi_enabled: true,
        keep_wifi_connected_during_standby: true,
        disable_standby: false,
        simulator_battery_level: 82,
        simulator_charging: false,
        simulator_wifi_state: "CONNECTED",
      },
    };
  }

  function stateLabel() {
    if (busy || status?.applying) return "Applying";
    if (!status?.enabled) return "Disabled";
    if (status?.integration?.status === "CONNECTED") return "Primary connected";
    return status?.job?.message || status?.integration?.status || "Enabled";
  }

  function menu() {
    const container = document.querySelector(".page-settings__menu");
    if (!container) return null;
    let item = container.querySelector(`[${MENU_ATTRIBUTE}]`);
    if (!item) {
      item = document.createElement("div");
      item.className = "page-settings__menu__item";
      item.setAttribute(MENU_ATTRIBUTE, "true");
      item.innerHTML = '<i class="fa-light fa-arrows-rotate"></i> Sync Mode';
      item.addEventListener("click", () => {
        window.location.hash = `#/settings/general?${ROUTE_QUERY}`;
      });
      const development = [...container.children].find((node) =>
        String(node.textContent || "").toLowerCase().includes("development"),
      );
      container.insertBefore(item, development || null);
    }
    item.classList.toggle("page-settings__menu__item--active", active());
    return item;
  }

  function installStyles() {
    if (document.getElementById(`${ROOT_ID}-styles`)) return;
    const style = document.createElement("style");
    style.id = `${ROOT_ID}-styles`;
    style.textContent = `
      #${ROOT_ID} { padding: 0 0 28px; color: inherit; }
      #${ROOT_ID} * { box-sizing: border-box; }
      #${ROOT_ID} .ucvr-sync-header { margin-bottom: 22px; }
      #${ROOT_ID} .ucvr-sync-header h1 { margin: 0; }
      #${ROOT_ID} .ucvr-sync-content { display: grid; gap: 20px; }
      #${ROOT_ID} .ucvr-sync-card { padding: 22px; border: 1px solid rgba(255,255,255,.12); border-radius: 16px; background: rgba(255,255,255,.025); }
      #${ROOT_ID} .ucvr-sync-hero, #${ROOT_ID} .ucvr-sync-title-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
      #${ROOT_ID} h2, #${ROOT_ID} h3 { margin: 0 0 10px; }
      #${ROOT_ID} p { margin: 4px 0 0; line-height: 1.5; opacity: .78; }
      #${ROOT_ID} .ucvr-sync-eyebrow { margin-bottom: 6px; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; opacity: .65; }
      #${ROOT_ID} .ucvr-sync-actions, #${ROOT_ID} .ucvr-sync-meta { display: flex; flex-wrap: wrap; gap: 10px; }
      #${ROOT_ID} .ucvr-sync-actions { justify-content: flex-end; }
      #${ROOT_ID} .ucvr-sync-actions--left { justify-content: flex-start; margin-top: 18px; }
      #${ROOT_ID} .ucvr-sync-meta { gap: 10px 22px; margin-top: 18px; font-size: 13px; }
      #${ROOT_ID} .ucvr-sync-warning { padding: 14px 16px; border: 1px solid rgba(255,190,50,.35); border-radius: 12px; background: rgba(255,190,50,.08); }
      #${ROOT_ID} .ucvr-sync-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 14px 18px; margin-top: 16px; }
      #${ROOT_ID} label { display: grid; gap: 7px; font-size: 13px; }
      #${ROOT_ID} input[type=text], #${ROOT_ID} input[type=password], #${ROOT_ID} input[type=number], #${ROOT_ID} select, #${ROOT_ID} input[type=search] { width: 100%; min-height: 42px; padding: 8px 11px; color: inherit; border: 1px solid rgba(255,255,255,.15); border-radius: 9px; background: rgba(0,0,0,.18); }
      #${ROOT_ID} .ucvr-sync-wide { grid-column: 1/-1; }
      #${ROOT_ID} .ucvr-sync-check { display: flex; align-items: center; gap: 10px; min-height: 42px; }
      #${ROOT_ID} .ucvr-sync-check input, #${ROOT_ID} .ucvr-sync-sections input { width: 18px; height: 18px; }
      #${ROOT_ID} .ucvr-sync-sections { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 10px; margin-top: 16px; }
      #${ROOT_ID} .ucvr-sync-sections label { display: flex; align-items: center; gap: 9px; padding: 10px; text-transform: capitalize; border: 1px solid rgba(255,255,255,.1); border-radius: 9px; }
      #${ROOT_ID} .ucvr-sync-satellites { display: grid; gap: 10px; margin-top: 14px; }
      #${ROOT_ID} .ucvr-sync-satellite { display: grid; grid-template-columns: minmax(160px,1fr) auto minmax(180px,1fr); gap: 14px; padding: 12px; border-radius: 10px; background: rgba(255,255,255,.04); }
      #${ROOT_ID} .ucvr-sync-search { max-width: 260px; }
      #${ROOT_ID} .ucvr-sync-catalog { margin-top: 22px; }
      #${ROOT_ID} .ucvr-sync-catalog-head, #${ROOT_ID} .ucvr-sync-catalog-row { display: grid; grid-template-columns: minmax(220px,1.3fr) minmax(160px,1fr) minmax(180px,.8fr); gap: 14px; align-items: center; }
      #${ROOT_ID} .ucvr-sync-catalog-head { padding: 8px 10px; font-size: 12px; font-weight: 600; opacity: .65; }
      #${ROOT_ID} .ucvr-sync-catalog-row { padding: 10px; border-top: 1px solid rgba(255,255,255,.08); }
      #${ROOT_ID} .ucvr-sync-catalog-row code, #${ROOT_ID} .ucvr-sync-catalog-value { overflow-wrap: anywhere; }
      #${ROOT_ID} .ucvr-sync-catalog-value { opacity: .8; }
      #${ROOT_ID} .ucvr-sync-badge { justify-self: start; padding: 4px 8px; font-size: 11px; border-radius: 999px; background: rgba(255,255,255,.08); }
      #${ROOT_ID} .ucvr-sync-badge--api { color: #ffc76b; background: rgba(255,185,55,.14); }
      #${ROOT_ID} .ucvr-sync-error { color: #ff9b9b; }
      @media (max-width: 800px) {
        #${ROOT_ID} .ucvr-sync-hero, #${ROOT_ID} .ucvr-sync-title-row { display: grid; }
        #${ROOT_ID} .ucvr-sync-actions { justify-content: flex-start; }
        #${ROOT_ID} .ucvr-sync-grid, #${ROOT_ID} .ucvr-sync-sections { grid-template-columns: 1fr; }
        #${ROOT_ID} .ucvr-sync-wide { grid-column: auto; }
        #${ROOT_ID} .ucvr-sync-catalog-head { display: none; }
        #${ROOT_ID} .ucvr-sync-catalog-row, #${ROOT_ID} .ucvr-sync-satellite { grid-template-columns: 1fr; }
        #${ROOT_ID} .ucvr-sync-search { max-width: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function input(path, label, value, type = "text", extra = "") {
    return `<label${extra.includes("wide") ? ' class="ucvr-sync-wide"' : ""}><span>${escapeHtml(label)}</span><input data-path="${escapeHtml(path)}" type="${type}" value="${escapeHtml(value)}" ${extra.replace("wide", "")}></label>`;
  }

  function checkbox(path, label, value) {
    return `<label class="ucvr-sync-check"><input data-path="${escapeHtml(path)}" type="checkbox"${checked(value)}><span>${escapeHtml(label)}</span></label>`;
  }

  function catalogHtml(groups) {
    return (groups || [])
      .map(
        (group) => `<div class="ucvr-sync-catalog" data-catalog-group>
          <h3>${escapeHtml(group.title)}</h3>
          <div class="ucvr-sync-catalog-head"><span>Setting</span><span>Value</span><span>Availability</span></div>
          ${(group.items || [])
            .map(
              (item) => `<div class="ucvr-sync-catalog-row" data-search="${escapeHtml(`${item.key} ${item.value} ${item.source} ${item.availability}`.toLowerCase())}">
                <code>${escapeHtml(item.key)}</code>
                <span class="ucvr-sync-catalog-value">${escapeHtml(item.value)}</span>
                <span class="ucvr-sync-badge${item.default_web_configurator ? "" : " ucvr-sync-badge--api"}">${escapeHtml(item.availability)}</span>
              </div>`,
            )
            .join("")}
        </div>`,
      )
      .join("");
  }

  function render() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const value = settings();
    const warnings = [...new Set(status?.warnings || [])];
    const satellites = status?.agent?.satellites || [];
    const dockTokens = Object.entries(value.primary.physical_dock_tokens || {})
      .map(([id, token]) => `${id}=${token}`)
      .join(", ");

    root.innerHTML = `
      <div class="ucvr-sync-header"><h1>Sync Mode</h1></div>
      <div class="ucvr-sync-content">
        <section class="ucvr-sync-card ucvr-sync-hero">
          <div><div class="ucvr-sync-eyebrow">UC Remote Sync Primary</div><h2>${escapeHtml(stateLabel())}</h2><p>Runs <strong>uc-remote-sync</strong> on this virtual Core and makes it the authoritative Primary for physical Satellite remotes.</p></div>
          <div class="ucvr-sync-actions"><button class="button button--primary" data-action="apply">Save &amp; Apply</button>${status?.enabled ? '<button class="button" data-action="disable">Disable</button>' : ""}<button class="button" data-action="refresh">Refresh</button></div>
        </section>
        ${warnings.length ? `<div class="ucvr-sync-warning">${warnings.map((warning) => `<div>${escapeHtml(warning)}</div>`).join("")}</div>` : ""}
        <section class="ucvr-sync-card">
          <h2>Primary service</h2>
          <div class="ucvr-sync-grid">
            ${input("primary.node_name", "Primary name", value.primary.node_name)}
            ${input("integration.image", "Container image", value.integration.image)}
            ${input("integration.version", "Image tag", value.integration.version)}
            ${input("primary.agent_port", "Agent port", value.primary.agent_port, "number", 'min="1" max="65535"')}
            ${input("primary.virtual_dock_port", "Virtual Dock port", value.primary.virtual_dock_port, "number", 'min="1" max="65535"')}
            ${input("primary.agent_public_url", "Public agent URL override", value.primary.agent_public_url, "text", 'placeholder="Automatic"')}
            ${input("primary.network_interface", "Network interface override", value.primary.network_interface, "text", 'placeholder="Automatic"')}
            ${input("primary.network_mac", "MAC override", value.primary.network_mac, "text", 'placeholder="Automatic"')}
            ${input("primary.network_broadcasts", "WoWLAN broadcast overrides", (value.primary.network_broadcasts || []).join(", "), "text", 'wide placeholder="192.168.1.255, 10.0.0.255"')}
            ${input("primary.physical_dock_default_token", "Default physical Dock token", value.primary.physical_dock_default_token, "password")}
            ${input("primary.physical_dock_tokens", "Per-Dock tokens", dockTokens, "text", 'wide placeholder="DOCK_ID=token, OTHER_DOCK=token"')}
          </div>
          <div class="ucvr-sync-meta"><span>Core API key: <strong>${status?.credentials?.api_key_provisioned ? "Provisioned" : "Not provisioned"}</strong></span><span>Integration: <strong>${escapeHtml(status?.integration?.status || "Not installed")}</strong></span><span>Container: <strong>${escapeHtml(status?.managed?.container || "Not installed")}</strong></span><span>Agent: <strong>${escapeHtml(status?.agent?.status?.state || (status?.agent?.health ? "Healthy" : "Unavailable"))}</strong></span></div>
          <div class="ucvr-sync-actions ucvr-sync-actions--left"><button class="button" data-action="rotate-key">Rotate managed credentials</button><button class="button" data-action="preview"${status?.enabled ? "" : " disabled"}>Preview synchronization</button><button class="button" data-action="sync"${status?.enabled ? "" : " disabled"}>Synchronize now</button></div>
        </section>
        <section class="ucvr-sync-card">
          <h2>Synchronization policy</h2>
          <div class="ucvr-sync-sections">${SECTIONS.map((section) => `<label><input data-section="${section}" type="checkbox"${checked(value.sync.sections.includes(section))}><span>${escapeHtml(section.replaceAll("_", " "))}</span></label>`).join("")}</div>
          <div class="ucvr-sync-grid">
            ${input("sync.interval_seconds", "Automatic interval (seconds)", value.sync.interval_seconds, "number", 'min="300" max="86400"')}
            ${checkbox("sync.auto_sync", "Automatic synchronization", value.sync.auto_sync)}
            ${checkbox("sync.prune", "Remove deleted objects", value.sync.prune)}
            ${checkbox("sync.use_standby_inhibitor", "Use Satellite standby inhibitor", value.sync.use_standby_inhibitor)}
            ${checkbox("sync.verify_existing_resource_hashes", "Verify existing resource hashes", value.sync.verify_existing_resource_hashes)}
          </div>
        </section>
        <section class="ucvr-sync-card">
          <h2>Primary Remote requirements</h2>
          <div class="ucvr-sync-grid">
            ${checkbox("hardware.enforce_wifi_enabled", "Keep Wi-Fi enabled", value.hardware.enforce_wifi_enabled)}
            ${checkbox("hardware.keep_wifi_connected_during_standby", "Keep Wi-Fi connected during standby", value.hardware.keep_wifi_connected_during_standby)}
            ${checkbox("hardware.disable_standby", "Disable Primary standby", value.hardware.disable_standby)}
            ${input("hardware.simulator_battery_level", "Virtual battery level", value.hardware.simulator_battery_level, "number", 'min="0" max="100"')}
            ${checkbox("hardware.simulator_charging", "Virtual Remote charging", value.hardware.simulator_charging)}
            <label><span>Virtual Wi-Fi state</span><select data-path="hardware.simulator_wifi_state"><option${selected(value.hardware.simulator_wifi_state, "CONNECTED")}>CONNECTED</option><option${selected(value.hardware.simulator_wifi_state, "CONNECTING")}>CONNECTING</option><option${selected(value.hardware.simulator_wifi_state, "DISCONNECTED")}>DISCONNECTED</option></select></label>
          </div>
        </section>
        <section class="ucvr-sync-card">
          <h2>Satellite remotes</h2>
          ${satellites.length ? `<div class="ucvr-sync-satellites">${satellites.map((satellite) => `<div class="ucvr-sync-satellite"><strong>${escapeHtml(satellite.name || satellite.peer_id || satellite.id)}</strong><span>${satellite.online === false ? "Offline" : "Online"}</span><span>${escapeHtml(satellite.last_error || satellite.last_seen_at || "Ready")}</span></div>`).join("")}</div>` : "<p>No paired Satellites are currently reported by the Primary agent.</p>"}
        </section>
        <section class="ucvr-sync-card">
          <div class="ucvr-sync-title-row"><div><h2>Remote configuration catalog</h2><p>All Core configuration and native host hardware values. Settings missing from the stock Web Configurator are marked as API or physical-Remote only.</p></div><input class="ucvr-sync-search" data-catalog-filter type="search" placeholder="Filter settings"></div>
          ${catalogHtml(status?.catalog)}
        </section>
      </div>`;

    root.querySelectorAll("button[data-action]").forEach((button) => {
      button.disabled = button.disabled || busy;
      button.addEventListener("click", () => command(button.dataset.action));
    });
    root.querySelector("[data-catalog-filter]")?.addEventListener("input", (event) => {
      const query = String(event.target.value || "").trim().toLowerCase();
      root.querySelectorAll("[data-search]").forEach((row) => {
        row.hidden = Boolean(query && !row.dataset.search.includes(query));
      });
      root.querySelectorAll("[data-catalog-group]").forEach((group) => {
        group.hidden = ![...group.querySelectorAll("[data-search]")].some((row) => !row.hidden);
      });
    });
    document.dispatchEvent(new CustomEvent("ucvr:sync-mode-rendered"));
  }

  function assign(target, path, value) {
    const parts = path.split(".");
    let cursor = target;
    while (parts.length > 1) {
      const part = parts.shift();
      cursor[part] ||= {};
      cursor = cursor[part];
    }
    cursor[parts[0]] = value;
  }

  function formSettings() {
    const root = document.getElementById(ROOT_ID);
    const value = structuredClone(settings());
    root.querySelectorAll("[data-path]").forEach((field) => {
      let next;
      if (field.type === "checkbox") next = field.checked;
      else if (field.type === "number") next = Number(field.value);
      else next = field.value;
      if (field.dataset.path === "primary.network_broadcasts") {
        next = String(next).split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
      }
      if (field.dataset.path === "primary.physical_dock_tokens") {
        next = Object.fromEntries(
          String(next)
            .split(/[\n,]+/)
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => {
              const separator = item.indexOf("=");
              return separator > 0 ? [item.slice(0, separator).trim(), item.slice(separator + 1).trim()] : ["", ""];
            })
            .filter(([id, token]) => id && token),
        );
      }
      assign(value, field.dataset.path, next);
    });
    value.sync.sections = [...root.querySelectorAll("[data-section]:checked")].map((field) => field.dataset.section);
    return value;
  }

  async function load() {
    try {
      status = await request();
      render();
    } catch (error) {
      const root = document.getElementById(ROOT_ID);
      if (root) root.innerHTML = `<div class="ucvr-sync-error">${escapeHtml(error.message)}</div>`;
    }
  }

  async function command(action) {
    if (busy) return;
    busy = true;
    render();
    try {
      const payload = { action };
      if (action === "apply" || action === "save") payload.settings = formSettings();
      status = await request(payload);
      render();
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(load, 800);
    } catch (error) {
      status = status || { settings: settings(), warnings: [], catalog: [], agent: { satellites: [] } };
      status.warnings = [...new Set([...(status.warnings || []), error.message])];
      render();
    } finally {
      busy = false;
      render();
    }
  }

  function show() {
    menu();
    const content = document.querySelector(".page-settings__menu-content");
    if (!content) return;
    if (content.querySelector(".sync-mode")) return;
    [...content.children].forEach((child) => {
      if (child.id !== ROOT_ID) {
        child.dataset.ucvrSyncModePreviousDisplay = child.style.display || "";
        child.style.display = "none";
      }
    });
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      content.appendChild(root);
      installStyles();
      load();
    }
  }

  function hide() {
    document.querySelector(`[${MENU_ATTRIBUTE}]`)?.classList.remove("page-settings__menu__item--active");
    const root = document.getElementById(ROOT_ID);
    const content = root?.parentElement;
    root?.remove();
    if (content) {
      [...content.children].forEach((child) => {
        if (child.dataset.ucvrSyncModePreviousDisplay !== undefined) {
          child.style.display = child.dataset.ucvrSyncModePreviousDisplay;
          delete child.dataset.ucvrSyncModePreviousDisplay;
        }
      });
    }
  }

  function synchronize() {
    menu();
    if (active()) show();
    else hide();
  }

  const observer = new MutationObserver(synchronize);
  const start = () => {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    synchronize();
  };
  window.addEventListener("hashchange", synchronize);
  window.addEventListener("popstate", synchronize);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
