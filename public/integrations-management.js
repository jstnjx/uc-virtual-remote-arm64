import { appUrl } from "./management-base.js";
const integrationRefresh = document.querySelector("#installed-integrations-refresh");
const integrationSummary = document.querySelector("#installed-integrations-summary");
const integrationList = document.querySelector("#installed-integrations-list");
const integrationResult = document.querySelector("#installed-integrations-result");
let loading = false;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function setResult(state, message) {
  if (!integrationResult) return;
  integrationResult.className = `upload-result ${state}`;
  integrationResult.textContent = message;
}

async function management(path, options = {}) {
  const response = await fetch(appUrl(`management/installed-integrations${path}`), {
    cache: "no-store",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || `Request returned HTTP ${response.status}`);
  return payload;
}

export function integrationState(item) {
  const runtime = item?.managed?.runtime;
  if (runtime?.restarting || runtime?.state === "restarting") return { tone: "warning", label: "Restarting" };
  if (runtime?.paused || runtime?.state === "paused") return { tone: "warning", label: "Paused" };
  if (runtime?.running) return { tone: "online", label: "Running" };
  if (runtime && ["missing", "dead", "unavailable"].includes(runtime.state)) return { tone: "error", label: runtime.state === "missing" ? "Missing" : "Unavailable" };
  if (runtime && ["exited", "created"].includes(runtime.state)) return { tone: "pending", label: "Stopped" };
  const status = String(item?.status || "DISCONNECTED").toUpperCase();
  if (status === "CONNECTED") return { tone: "online", label: "Connected" };
  if (status === "ERROR") return { tone: "error", label: "Error" };
  if (status === "CONNECTING") return { tone: "warning", label: "Connecting" };
  return { tone: "pending", label: "Disconnected" };
}

export function integrationActions(item) {
  const runtime = item?.managed?.runtime;
  const running = item?.managed ? Boolean(runtime?.running || runtime?.restarting) : String(item?.status || "").toUpperCase() === "CONNECTED";
  const actions = [
    { id: running ? "stop" : "start", label: running ? "Stop" : "Start", primary: true },
    { id: item?.managed ? "restart" : "reconnect", label: item?.managed ? "Restart" : "Reconnect" },
    { id: "refresh-entities", label: "Refresh entities" },
    { id: "reconfigure", label: "Reconfigure" }
  ];
  if (item?.update?.available) {
    actions.splice(1, 0, {
      id: "update",
      label: item.update.available_version ? `Update to ${item.update.available_version}` : "Update"
    });
  }
  return actions;
}

function statusPill(item) {
  const state = integrationState(item);
  return `<span class="status-pill ${state.tone}"><i></i><b>${escapeHtml(state.label)}</b></span>`;
}

function formatDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function renderAction(action, item) {
  const className = action.primary ? "button button-primary" : "button button-secondary";
  return `<button class="${className}" type="button" data-integration-action="${escapeHtml(action.id)}" data-integration-id="${escapeHtml(item.id)}">${escapeHtml(action.label)}</button>`;
}

function renderIntegration(item) {
  const managed = item.managed;
  const runtime = managed?.runtime;
  const metadata = [
    `<span><b>${escapeHtml(item.version || "unknown")}</b> version</span>`,
    `<span><b>${Number(item.entities || 0).toLocaleString()}</b> configured entities</span>`,
    `<span><b>${Number(item.available_entities || 0).toLocaleString()}</b> available entities</span>`
  ];
  if (managed?.source) metadata.push(`<span><b>${escapeHtml(managed.source)}</b> source</span>`);
  if (item.update?.available) metadata.push(`<span class="update-available"><b>${escapeHtml(item.update.available_version || "New version")}</b> update available</span>`);

  const details = [
    `<div><dt>Driver ID</dt><dd><code>${escapeHtml(item.driver_id)}</code></dd></div>`,
    `<div><dt>Endpoint</dt><dd>${item.url ? `<code>${escapeHtml(item.url)}</code><button class="inline-copy" type="button" data-copy-value="${escapeHtml(item.url)}" aria-label="Copy endpoint">Copy</button>` : "Unavailable"}</dd></div>`,
    managed ? `<div><dt>Container</dt><dd><code>${escapeHtml(managed.container)}</code></dd></div>` : "",
    managed ? `<div><dt>Image</dt><dd><code>${escapeHtml(managed.image || "Unknown")}</code></dd></div>` : "",
    managed ? `<div><dt>Runtime</dt><dd>${escapeHtml(runtime?.state || "unknown")}${runtime?.exit_code !== null && runtime?.exit_code !== undefined ? ` · exit ${escapeHtml(runtime.exit_code)}` : ""}</dd></div>` : "",
    managed ? `<div><dt>Installed</dt><dd>${escapeHtml(formatDate(managed.installed_at))}</dd></div>` : "",
    item.update?.supported ? `<div><dt>Update check</dt><dd>${escapeHtml(item.update.error || formatDate(item.update.checked_at))}</dd></div>` : ""
  ].filter(Boolean).join("");

  const actions = integrationActions(item).map((action) => renderAction(action, item)).join("");
  const logAction = managed ? `<button class="button button-secondary" type="button" data-integration-log="${escapeHtml(managed.container)}">Logs</button>` : "";

  return `<article class="installed-integration-item" data-integration-card="${escapeHtml(item.id)}">
    <div class="installed-integration-header">
      <div>
        <div class="installed-integration-title"><h3>${escapeHtml(item.name || item.driver_id)}</h3><span class="integration-kind">${managed ? "Managed container" : "External integration"}</span></div>
        <code>${escapeHtml(item.driver_id)}</code>
      </div>
      ${statusPill(item)}
    </div>
    <div class="installed-integration-meta">${metadata.join("")}</div>
    <dl class="installed-integration-details">${details}</dl>
    ${runtime?.error ? `<p class="installed-integration-error">${escapeHtml(runtime.error)}</p>` : ""}
    <div class="button-row installed-integration-actions">
      ${actions}
      ${logAction}
      <button class="icon-button danger installed-integration-remove" type="button" data-integration-remove="${escapeHtml(item.id)}" aria-label="Uninstall ${escapeHtml(item.name || item.driver_id)}" title="Uninstall integration">×</button>
    </div>
  </article>`;
}

function render(items) {
  const managed = items.filter((item) => item.managed).length;
  const running = items.filter((item) => integrationState(item).label === "Running" || integrationState(item).label === "Connected").length;
  const updates = items.filter((item) => item.update?.available).length;
  integrationSummary.innerHTML = `<span><strong>${items.length}</strong> installed</span><span><strong>${managed}</strong> managed containers</span><span><strong>${running}</strong> active</span><span><strong>${updates}</strong> updates available</span>`;
  integrationList.innerHTML = items.length
    ? items.map(renderIntegration).join("")
    : '<p class="installed-integrations-empty">No external integrations are installed. Add one in the Web Configurator or from an integration source above.</p>';
}

export async function refreshInstalledIntegrations() {
  if (!integrationList || loading) return;
  loading = true;
  if (integrationRefresh) integrationRefresh.disabled = true;
  try {
    const payload = await management("");
    render(Array.isArray(payload.integrations) ? payload.integrations : []);
    setResult("success", `Updated ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    integrationList.innerHTML = `<p class="installed-integrations-empty error-message">Unable to retrieve installed integrations: ${escapeHtml(error.message)}</p>`;
    setResult("error", error.message);
  } finally {
    loading = false;
    if (integrationRefresh) integrationRefresh.disabled = false;
  }
}

async function runAction(button, id, action) {
  const card = button.closest("[data-integration-card]");
  const buttons = [...(card?.querySelectorAll("button") || [])];
  buttons.forEach((item) => { item.disabled = true; });
  setResult("working", `${button.textContent.trim()} in progress…`);
  try {
    await management(`/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, { method: "POST", body: "{}" });
    const message = action === "reconfigure"
      ? "Reconfiguration started. Complete any requested setup in the Web Configurator."
      : `${button.textContent.trim()} completed.`;
    setResult("success", message);
    await refreshInstalledIntegrations();
    document.querySelector("#refresh-button")?.click();
  } catch (error) {
    setResult("error", error.message);
    buttons.forEach((item) => { item.disabled = false; });
  }
}

async function removeIntegration(button, id) {
  const card = button.closest("[data-integration-card]");
  const name = card?.querySelector("h3")?.textContent?.trim() || id;
  if (!window.confirm(`Uninstall ${name}? The managed container and its persistent integration data will be removed.`)) return;
  const buttons = [...(card?.querySelectorAll("button") || [])];
  buttons.forEach((item) => { item.disabled = true; });
  setResult("working", `Uninstalling ${name}…`);
  try {
    await management(`/${encodeURIComponent(id)}`, { method: "DELETE" });
    setResult("success", `${name} was uninstalled.`);
    await refreshInstalledIntegrations();
    document.querySelector("#refresh-button")?.click();
  } catch (error) {
    setResult("error", error.message);
    buttons.forEach((item) => { item.disabled = false; });
  }
}

function openLogs(container) {
  window.UCVRManagementNavigation?.open("diagnostics", "logs-heading");
  const source = document.querySelector("#logs-source");
  const logs = document.querySelector("#logs-heading");
  const value = `integration:${container}`;
  if (!source || ![...source.options].some((option) => option.value === value)) {
    setResult("error", "The integration log source is not available yet. Refresh the logs section and try again.");
    return;
  }
  source.value = value;
  source.dispatchEvent(new Event("change", { bubbles: true }));
  logs?.scrollIntoView({ behavior: "smooth", block: "start" });
}

integrationRefresh?.addEventListener("click", refreshInstalledIntegrations);
integrationList?.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-integration-action]");
  const remove = event.target.closest("[data-integration-remove]");
  const logs = event.target.closest("[data-integration-log]");
  const copy = event.target.closest("[data-copy-value]");
  if (action) return runAction(action, action.dataset.integrationId, action.dataset.integrationAction);
  if (remove) return removeIntegration(remove, remove.dataset.integrationRemove);
  if (logs) return openLogs(logs.dataset.integrationLog);
  if (copy) {
    try {
      await navigator.clipboard.writeText(copy.dataset.copyValue || "");
      setResult("success", "Endpoint copied to the clipboard.");
    } catch (error) { setResult("error", `Unable to copy endpoint: ${error.message}`); }
  }
});

if (integrationList) {
  refreshInstalledIntegrations();
  setInterval(() => {
    if (document.visibilityState === "visible") refreshInstalledIntegrations();
  }, 10_000);
}
