/* UC Virtual Remote management landing page — SPDX-License-Identifier: MIT */
const $ = (selector) => document.querySelector(selector);
const statusElement = $("#connection-status");
const configuratorStatus = $("#configurator-status");
const configuratorDescription = $("#configurator-description");
const configuratorMeta = $("#configurator-meta");
const healthMetrics = $("#health-metrics");
const runtimeDetails = $("#runtime-details");
const endpointDetails = $("#endpoint-details");
const platformName = $("#platform-name");
const openConfigurator = $("#open-configurator");
const lastUpdated = $("#last-updated");
const footerVersion = $("#footer-version");
const refreshButton = $("#refresh-button");
const hardwareRefresh = $("#hardware-refresh");
const adapterForm = $("#adapter-form");
const bluetoothAdapter = $("#bluetooth-adapter");
const wifiAdapter = $("#wifi-adapter");
const bluetoothPower = $("#bluetooth-power");
const hardwareResult = $("#hardware-result");
const wifiForm = $("#wifi-form");
const wifiScan = $("#wifi-scan");
const wifiNetwork = $("#wifi-network");
const wifiSsid = $("#wifi-ssid");
const wifiPassword = $("#wifi-password");
const wifiHidden = $("#wifi-hidden");
const wifiResult = $("#wifi-result");
const wifiState = $("#wifi-state");
const wifiCurrentState = $("#wifi-current-state");
const wifiCurrentDetails = $("#wifi-current-details");
const bluetoothPairedState = $("#bluetooth-paired-state");
const bluetoothPairedDevices = $("#bluetooth-paired-devices");
const integrationSourcesRefresh = $("#integration-sources-refresh");
const registryForm = $("#registry-form");
const registryUrls = $("#registry-urls");
const ghcrForm = $("#ghcr-form");
const ghcrImage = $("#ghcr-image");
const ghcrDriverId = $("#ghcr-driver-id");
const ghcrName = $("#ghcr-name");
const ghcrVersion = $("#ghcr-version");
const ghcrWebsocketPath = $("#ghcr-websocket-path");
const ghcrPull = $("#ghcr-pull");
const ghcrSubmit = $("#ghcr-submit");
const integrationSourceSummary = $("#integration-source-summary");
const integrationSourceList = $("#integration-source-list");
const integrationSourcesResult = $("#integration-sources-result");

const logsSource = $("#logs-source");
const logsLive = $("#logs-live");
const logsLiveStatus = $("#logs-live-status");
const logsRefresh = $("#logs-refresh");
const logsDownload = $("#logs-download");
const logsOutput = $("#logs-output");
const logsResult = $("#logs-result");
const hciToggle = $("#hci-toggle");
const hciDownload = $("#hci-download");
const updateStatus = $("#update-status");
const updateInstalled = $("#update-installed");
const updateChannel = $("#update-channel");
const updateChecked = $("#update-checked");
const updateRelease = $("#update-release");
const updateTitle = $("#update-title");
const updateDescription = $("#update-description");
const updateMeta = $("#update-meta");
const updateProgress = $("#update-progress");
const updateProgressLabel = $("#update-progress-label");
const updateProgressValue = $("#update-progress-value");
const updateProgressBar = $("#update-progress-bar");
const updateCheck = $("#update-check");
const updateAction = $("#update-action");
const updateResult = $("#update-result");
let logSources = [];
let logLoading = false;
let softwareUpdate = null;
let updatePollTimer = null;

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]); }
function formatBytes(value) { const bytes = Number(value || 0); if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"; const units = ["B", "KB", "MB", "GB", "TB"]; const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024))); return `${(bytes / (1024 ** power)).toFixed(power ? 1 : 0)} ${units[power]}`; }
function formatDuration(value) { let seconds = Math.max(0, Math.floor(Number(value || 0))); const days = Math.floor(seconds / 86400); seconds %= 86400; const hours = Math.floor(seconds / 3600); seconds %= 3600; const minutes = Math.floor(seconds / 60); if (days) return `${days}d ${hours}h`; if (hours) return `${hours}h ${minutes}m`; return `${minutes}m ${seconds % 60}s`; }
function setPill(element, state, label) { element.className = `status-pill ${state}`; element.innerHTML = `<i></i><b>${escapeHtml(label)}</b>`; }
function metric(label, value, detail = "") { return `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</article>`; }
function detail(label, value, options = {}) { const content = options.code ? `<code>${escapeHtml(value)}</code>` : escapeHtml(value); return `<div><dt>${escapeHtml(label)}</dt><dd>${content}</dd></div>`; }
async function management(path, options = {}) { const response = await fetch(`/management/${path}`, { cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || payload.message || `Request returned HTTP ${response.status}`); return payload; }
function result(element, state, message) { element.className = `upload-result ${state}`; element.textContent = message; }

async function managementText(path, options = {}) {
  const response = await fetch(`/management/${path}`, { cache: "no-store", ...options, headers: { ...(options.headers || {}) } });
  const payload = await response.text();
  if (!response.ok) {
    let message = payload;
    try { message = JSON.parse(payload).error || message; } catch {}
    throw new Error(message || `Request returned HTTP ${response.status}`);
  }
  return { response, payload };
}

function sourceOptionGroups(values) {
  const fixed = values.filter((item) => item.type !== "integration");
  const integrations = values.filter((item) => item.type === "integration");
  const options = fixed.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  const managed = integrations.length ? `<optgroup label="Managed integrations">${integrations.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}</optgroup>` : "";
  return `${options}${managed}`;
}

function activeLogSource() { return logSources.find((item) => item.id === logsSource.value) || logSources[0] || null; }

function renderHciActions() {
  const source = activeLogSource();
  const hci = logSources.find((item) => item.type === "bluetooth-hci");
  const selected = source?.type === "bluetooth-hci";
  hciToggle.classList.toggle("hidden", !selected || !hci?.available);
  hciDownload.classList.toggle("hidden", !selected || !hci?.path);
  hciToggle.textContent = hci?.enabled ? "Stop HCI capture" : "Start HCI capture";
}

async function refreshLogSources() {
  const previous = logsSource.value || "core";
  const payload = await management("logs/sources");
  logSources = payload.sources || [];
  logsSource.innerHTML = sourceOptionGroups(logSources);
  logsSource.value = logSources.some((item) => item.id === previous) ? previous : (logSources[0]?.id || "core");
  renderHciActions();
}

async function refreshLogs({ forceSources = false } = {}) {
  if (logLoading) return;
  logLoading = true;
  logsRefresh.disabled = true;
  const wasNearBottom = logsOutput.scrollHeight - logsOutput.scrollTop - logsOutput.clientHeight < 50;
  const previousScroll = logsOutput.scrollTop;
  try {
    if (forceSources || !logSources.length) await refreshLogSources();
    const source = activeLogSource();
    if (!source) throw new Error("No log source is available");
    const { payload } = await managementText(`logs?source=${encodeURIComponent(source.id)}&limit=1500`);
    logsOutput.textContent = payload || "No log entries are available.";
    if (wasNearBottom) logsOutput.scrollTop = logsOutput.scrollHeight;
    else logsOutput.scrollTop = previousScroll;
    result(logsResult, "success", `Updated ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    logsOutput.textContent = `Unable to retrieve logs: ${error.message}`;
    result(logsResult, "error", error.message);
  } finally {
    logsRefresh.disabled = false;
    logLoading = false;
  }
}

async function downloadLog(path, fallbackName) {
  const response = await fetch(`/management/${path}`, { cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Download returned HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function localizedText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.en || value.en_US || Object.values(value)[0] || "";
}

function updatePercent(progress) {
  if (Number.isFinite(Number(progress?.download_percent))) return Number(progress.download_percent);
  if (Number.isFinite(Number(progress?.progress_percent))) return Number(progress.progress_percent);
  return ["DONE", "SUCCESS"].includes(String(progress?.state || "").toUpperCase()) ? 100 : 0;
}

function renderUpdateProgress(progress) {
  const state = String(progress?.state || "IDLE").toUpperCase();
  const percent = Math.max(0, Math.min(100, updatePercent(progress)));
  updateProgress.classList.toggle("hidden", ["IDLE"].includes(state));
  updateProgressBar.value = percent;
  updateProgressValue.textContent = `${Math.round(percent)}%`;
  updateProgressLabel.textContent = state === "DOWNLOAD" ? "Downloading update…"
    : state === "START" ? "Preparing installation…"
      : state === "PROGRESS" ? "Installing update…"
        : state === "DONE" ? "Update installed. Restarting…"
          : state === "SUCCESS" ? "Download complete"
            : state === "FAILURE" ? "Update failed" : "Preparing update…";
}

function renderSoftwareUpdate(payload) {
  softwareUpdate = payload;
  const available = payload.available?.[0] || null;
  updateInstalled.textContent = payload.installed_version || "Unknown";
  updateChannel.textContent = payload.channel === "TESTING" ? "Testing" : "Stable";
  updateChecked.textContent = payload.checked_at ? new Date(payload.checked_at).toLocaleString() : "Never";
  updateRelease.classList.toggle("hidden", !available);
  updateAction.classList.toggle("hidden", !available);
  if (available) {
    updateTitle.textContent = `${available.title || "UC Virtual Remote"} · v${available.version}`;
    updateDescription.textContent = localizedText(available.description) || "A new UC Virtual Remote release is available.";
    updateMeta.textContent = [available.release_date ? `Released ${available.release_date}` : "", available.source || "", available.download === "DOWNLOADED" ? "Downloaded" : "Not downloaded"].filter(Boolean).join(" · ");
    updateAction.textContent = available.download === "DOWNLOADED" ? "Install update" : "Download update";
    updateAction.dataset.updateId = available.id;
    setPill(updateStatus, "warning", `v${available.version} available`);
  } else if (payload.check_error) {
    setPill(updateStatus, "error", "Check failed");
    result(updateResult, "error", payload.check_error);
  } else {
    setPill(updateStatus, "online", "Up to date");
    result(updateResult, "success", "The installed version is up to date.");
  }
}

async function refreshSoftwareUpdate(force = false) {
  updateCheck.disabled = true;
  try {
    const payload = await management(`system/update${force ? "?force=true" : ""}`);
    renderSoftwareUpdate(payload);
  } catch (error) {
    setPill(updateStatus, "error", "Check failed");
    result(updateResult, "error", error.message);
  } finally { updateCheck.disabled = false; }
}

async function pollSoftwareUpdate(updateId) {
  clearTimeout(updatePollTimer);
  try {
    const progress = await management(`system/update/${encodeURIComponent(updateId)}/progress`);
    renderUpdateProgress(progress);
    const state = String(progress.state || "").toUpperCase();
    if (state === "FAILURE") {
      updateAction.disabled = false;
      result(updateResult, "error", progress.error || "Software update failed.");
      return;
    }
    if (state === "SUCCESS") {
      updateAction.disabled = false;
      result(updateResult, "success", "Download complete. The update is ready to install.");
      await refreshSoftwareUpdate(false);
      return;
    }
    if (state === "DONE") {
      setPill(updateStatus, "online", "Installed");
      result(updateResult, "success", "Update installed. The Virtual Remote is restarting.");
      return;
    }
    updatePollTimer = setTimeout(() => pollSoftwareUpdate(updateId), 750);
  } catch (error) {
    updateAction.disabled = false;
    result(updateResult, "error", error.message);
  }
}

function renderStatus(status) {
  const online = status?.online !== false && String(status?.state || "ONLINE").toUpperCase() === "ONLINE";
  setPill(statusElement, online ? "online" : "error", online ? "Online" : "Offline");
  platformName.textContent = status?.name || "Virtual Remote 3";
  footerVersion.textContent = `UC Virtual Remote v${status?.version || "unknown"}`;
  const integrations = status?.integrations || {}; const entities = status?.entities || {}; const runtime = status?.runtime || {}; const docks = status?.docks || {}; const media = status?.media || {};
  healthMetrics.innerHTML = [
    metric("Integrations", `${integrations.connected || 0}/${integrations.total || 0}`, `${integrations.managed || 0} managed containers`),
    metric("Entities", String(entities.configured || 0), `${entities.available || 0} available`),
    metric("Automation", String((status?.activities || 0) + (status?.macros || 0)), `${status?.activities || 0} activities · ${status?.macros || 0} macros`),
    metric("Interface", String((status?.profiles || 0) + (status?.pages || 0)), `${status?.profiles || 0} profiles · ${status?.pages || 0} pages`),
    metric("Virtual Docks", String(docks.total || 0), `${docks.active || 0} active`),
    metric("Media", String(media.sessions || 0), `${media.queues || 0} queues · ${media.cached_artwork || 0} artwork`),
    metric("Uptime", formatDuration(runtime.uptime_seconds), runtime.node || "Node.js"),
    metric("Memory", formatBytes(runtime.memory?.rss), `${formatBytes(runtime.memory?.heap_used)} heap used`)
  ].join("");
  runtimeDetails.innerHTML = [detail("Model", status?.model || "UCR3"), detail("Core version", status?.version || "unknown"), detail("Node runtime", runtime.node || "unknown"), detail("Host", status?.hostname || "unknown"), detail("Platform", `${runtime.platform || "unknown"} / ${runtime.arch || "unknown"}`), detail("Database", formatBytes(status?.storage?.database_bytes || 0)), detail("Data usage", formatBytes(status?.storage?.data_bytes || 0))].join("");
  const host = location.hostname; const restPort = status?.endpoints?.rest_port || location.port || 11090; const websocketPort = status?.endpoints?.websocket_port || 946;
  endpointDetails.innerHTML = [detail("Management", `${location.protocol}//${location.host}/`, { code: true }), detail("Configurator", `${location.protocol}//${location.host}/configurator/`, { code: true }), detail("REST API", `${location.protocol}//${host}:${restPort}`, { code: true }), detail("Core WebSocket", `ws://${host}:${websocketPort}${status?.endpoints?.websocket_path || "/ws"}`, { code: true })].join("");
  renderConfigurator(status?.web_configurator || {}); lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

function renderConfigurator(configurator) {
  const installed = Boolean(configurator.installed);
  setPill(configuratorStatus, installed ? "online" : "error", installed ? "Bundled" : "Unavailable");
  configuratorDescription.textContent = installed
    ? "Unofficial source-built community edition based on Web Configurator 2.3.3. The bundled files are immutable at runtime."
    : "The bundled community Web Configurator is missing from this application image. Reinstall or rebuild UC Virtual Remote.";
  openConfigurator.classList.toggle("disabled", !installed);
  openConfigurator.setAttribute("aria-disabled", installed ? "false" : "true");
  openConfigurator.tabIndex = installed ? 0 : -1;
  configuratorMeta.innerHTML = installed ? [
    `<span>Build <b>${escapeHtml(configurator.version || "2.3.3-unfoldedtools.8")}</b></span>`,
    `<span>Upstream source <b>${escapeHtml(configurator.upstream_version || "2.3.3")}</b></span>`,
    `<span><b>${Number(configurator.asset_count || 0).toLocaleString()}</b> files</span>`,
    `<span>Source-built · bundled · read-only</span>`
  ].join("") : `<span>Bundled configurator files are unavailable.</span>`;
}

function adapterOptions(values, selected) { return `<option value="">Automatic / unavailable</option>${values.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.name || item.id)} · ${escapeHtml(item.type || "unknown")}${item.state ? ` · ${escapeHtml(item.state)}` : ""}</option>`).join("")}`; }
async function refreshHardware(force = false) {
  hardwareRefresh.disabled = true;
  try {
    const data = await management(`hardware${force ? "?refresh=true" : ""}`);
    bluetoothAdapter.innerHTML = adapterOptions(data.bluetooth || [], data.selection?.bluetooth_adapter);
    wifiAdapter.innerHTML = adapterOptions(data.wifi || [], data.selection?.wifi_adapter);
    const capabilities = data.capabilities || {};
    const wifi = data.current?.wifi || {};
    const wifiConnected = String(wifi.wpa_state || "").toUpperCase() === "COMPLETED";
    wifiCurrentState.textContent = wifiConnected ? "Connected" : "Disconnected";
    wifiCurrentDetails.innerHTML = [
      detail("Network", wifiConnected ? (wifi.ssid || "Unknown") : "Not connected"),
      detail("MAC address", wifi.address || "Unavailable", { code: Boolean(wifi.address) }),
      detail("IP address", wifi.ip_address || "Unavailable", { code: Boolean(wifi.ip_address) })
    ].join("");
    const paired = Array.isArray(data.current?.bluetooth?.devices) ? data.current.bluetooth.devices : [];
    bluetoothPairedState.textContent = `${paired.length} paired`;
    bluetoothPairedDevices.innerHTML = paired.length ? paired.map((device) => `<article class="bluetooth-device-item"><div><strong>${escapeHtml(device.name || device.address)}</strong><code>${escapeHtml(device.address)}</code></div><span class="status-pill ${device.connected ? "online" : "pending"}"><i></i><b>${device.connected ? "Connected" : "Paired"}</b></span></article>`).join("") : '<p class="hardware-empty">No devices are paired with the selected Bluetooth adapter.</p>';
    result(hardwareResult, capabilities.host_dbus ? "success" : "working", `${data.bluetooth?.length || 0} Bluetooth and ${data.wifi?.length || 0} Wi-Fi adapter(s). ${capabilities.host_dbus ? "Host D-Bus available." : "Host D-Bus unavailable."}`);
  } catch (error) { result(hardwareResult, "error", error.message); } finally { hardwareRefresh.disabled = false; }
}

function integrationJobLabel(job) {
  const state = String(job?.state || "").toUpperCase();
  const progress = Math.max(0, Math.min(100, Number(job?.progress || 0)));
  return `${state || "SETUP"}${["SETUP", "WAIT_USER_ACTION"].includes(state) ? ` · ${Math.round(progress)}%` : ""}`;
}

async function refreshIntegrationSources(force = false) {
  if (!integrationSourcesRefresh) return;
  integrationSourcesRefresh.disabled = true;
  try {
    const [data, jobs] = await Promise.all([
      management(`integration-sources${force ? "?refresh=true" : ""}`),
      management("integration-sources/jobs").catch(() => [])
    ]);
    registryUrls.value = (data.registries || []).join("\n");
    const custom = data.ghcr || [];
    const activeJobs = Array.isArray(jobs) ? jobs : [];
    integrationSourceSummary.innerHTML = `<span><strong>${Number(data.status?.cached_entries || data.entries || 0).toLocaleString()}</strong> unique integrations</span><span><strong>${(data.registries || []).length}</strong> registries</span><span><strong>${custom.length}</strong> custom GHCR images</span>`;
    integrationSourceList.innerHTML = custom.length ? custom.map((entry) => {
      const driverId = entry.driver_id || entry.external_runtime?.driver_id || entry.id;
      const job = activeJobs.find((candidate) => candidate.driver_id === driverId);
      const image = entry.docker_image || entry.external_runtime?.docker_image || "";
      return `<article class="integration-source-item"><div><strong>${escapeHtml(entry.name || driverId)}</strong><code>${escapeHtml(image.replace("{version}", entry.version || "latest"))}</code><small>${escapeHtml(driverId)} · ${escapeHtml(entry.external_runtime?.websocket_path || "/intg")}${job ? ` · ${escapeHtml(integrationJobLabel(job))}` : ""}</small></div><div class="button-row"><button class="button button-secondary" type="button" data-ghcr-pull="${escapeHtml(entry.id)}">Pull</button><button class="icon-button danger" type="button" data-ghcr-remove="${escapeHtml(entry.id)}" aria-label="Remove ${escapeHtml(entry.name || driverId)}">×</button></div></article>`;
    }).join("") : '<p class="integration-source-empty">No custom GHCR integrations configured.</p>';
    const failures = data.status?.registry_errors || [];
    result(integrationSourcesResult, failures.length ? "working" : "success", failures.length ? `${failures.length} registry source(s) used cached data or failed.` : "Integration sources are available.");
  } catch (error) {
    result(integrationSourcesResult, "error", error.message);
  } finally {
    integrationSourcesRefresh.disabled = false;
  }
}

async function refreshStatus() { refreshButton.disabled = true; try { const response = await fetch("/pub/status", { cache: "no-store" }); if (!response.ok) throw new Error(`Status request returned HTTP ${response.status}`); renderStatus(await response.json()); } catch (error) { setPill(statusElement, "error", "Offline"); lastUpdated.textContent = error.message; healthMetrics.innerHTML = `<div class="error-message">Unable to retrieve platform status: ${escapeHtml(error.message)}</div>`; } finally { refreshButton.disabled = false; } }

openConfigurator.addEventListener("click", (event) => { if (openConfigurator.getAttribute("aria-disabled") === "true") event.preventDefault(); });
refreshButton.addEventListener("click", refreshStatus);
hardwareRefresh.addEventListener("click", () => refreshHardware(true));
integrationSourcesRefresh?.addEventListener("click", () => refreshIntegrationSources(true));
registryForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const registries = registryUrls.value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
    await management("integration-sources", { method: "PUT", body: JSON.stringify({ registries }) });
    result(integrationSourcesResult, "success", "Registry sources saved and refreshed.");
    await refreshIntegrationSources();
  } catch (error) { result(integrationSourcesResult, "error", error.message); }
});
ghcrForm?.addEventListener("submit", async (event) => {
  event.preventDefault(); ghcrSubmit.disabled = true;
  try {
    const payload = await management("integration-sources/ghcr", { method: "POST", body: JSON.stringify({ image: ghcrImage.value, driver_id: ghcrDriverId.value, name: ghcrName.value, version: ghcrVersion.value, websocket_path: ghcrWebsocketPath.value, pull: ghcrPull.checked }) });
    result(integrationSourcesResult, "success", payload.job ? "GHCR image added; container pull started." : "GHCR integration added.");
    ghcrImage.value = ""; ghcrDriverId.value = ""; ghcrName.value = "";
    await refreshIntegrationSources();
  } catch (error) { result(integrationSourcesResult, "error", error.message); }
  finally { ghcrSubmit.disabled = false; }
});
integrationSourceList?.addEventListener("click", async (event) => {
  const remove = event.target.closest("[data-ghcr-remove]");
  const pull = event.target.closest("[data-ghcr-pull]");
  try {
    if (remove) {
      await management(`integration-sources/ghcr/${encodeURIComponent(remove.dataset.ghcrRemove)}`, { method: "DELETE" });
      result(integrationSourcesResult, "success", "Custom GHCR integration removed.");
    } else if (pull) {
      await management(`integration-sources/ghcr/${encodeURIComponent(pull.dataset.ghcrPull)}/pull`, { method: "POST", body: "{}" });
      result(integrationSourcesResult, "working", "Container pull started.");
    } else return;
    await refreshIntegrationSources();
  } catch (error) { result(integrationSourcesResult, "error", error.message); }
});
adapterForm.addEventListener("submit", async (event) => { event.preventDefault(); try { await management("hardware", { method: "PUT", body: JSON.stringify({ bluetooth_adapter: bluetoothAdapter.value || null, wifi_adapter: wifiAdapter.value || null }) }); result(hardwareResult, "success", "Adapter selection saved."); await refreshHardware(); } catch (error) { result(hardwareResult, "error", error.message); } });
bluetoothPower.addEventListener("click", async () => { bluetoothPower.disabled = true; try { const data = await management("hardware/bluetooth/power", { method: "POST", body: JSON.stringify({ enabled: true }) }); result(hardwareResult, "success", `Bluetooth powered on using ${data.adapter}.`); } catch (error) { result(hardwareResult, "error", error.message); } finally { bluetoothPower.disabled = false; } });
wifiScan.addEventListener("click", async () => { wifiScan.disabled = true; wifiState.textContent = "Scanning…"; try { const networks = await management("hardware/wifi/networks"); wifiNetwork.innerHTML = `<option value="">Select a network</option>${networks.map((item) => `<option value="${escapeHtml(item.ssid)}">${escapeHtml(item.ssid)} · ${item.signal}% · ${escapeHtml(item.security)}</option>`).join("")}`; wifiState.textContent = `${networks.length} network(s)`; } catch (error) { wifiState.textContent = "Scan failed"; result(wifiResult, "error", error.message); } finally { wifiScan.disabled = false; } });
wifiNetwork.addEventListener("change", () => { if (wifiNetwork.value) wifiSsid.value = wifiNetwork.value; });
wifiForm.addEventListener("submit", async (event) => { event.preventDefault(); try { const data = await management("hardware/wifi/connect", { method: "POST", body: JSON.stringify({ ssid: wifiSsid.value || wifiNetwork.value, password: wifiPassword.value, hidden: wifiHidden.checked }) }); result(wifiResult, "success", `Connected ${data.adapter || "Wi-Fi"} to ${data.ssid || wifiSsid.value}.`); wifiPassword.value = ""; } catch (error) { result(wifiResult, "error", error.message); } });

logsSource.addEventListener("change", () => { renderHciActions(); refreshLogs(); });
logsLive.addEventListener("change", () => {
  setPill(logsLiveStatus, logsLive.checked ? "online" : "pending", logsLive.checked ? "Live" : "Paused");
  if (logsLive.checked) refreshLogs();
});
logsRefresh.addEventListener("click", () => refreshLogs({ forceSources: true }));
logsDownload.addEventListener("click", async () => {
  const source = activeLogSource();
  if (!source) return;
  logsDownload.disabled = true;
  try { await downloadLog(`logs?source=${encodeURIComponent(source.id)}&limit=10000&download=true`, `${source.type}-logs.txt`); result(logsResult, "success", "Log downloaded."); }
  catch (error) { result(logsResult, "error", error.message); }
  finally { logsDownload.disabled = false; }
});
hciToggle.addEventListener("click", async () => {
  const hci = logSources.find((item) => item.type === "bluetooth-hci");
  hciToggle.disabled = true;
  try {
    await management("logs/hci", { method: "POST", body: JSON.stringify({ enabled: !hci?.enabled }) });
    await refreshLogSources();
    await refreshLogs();
  } catch (error) { result(logsResult, "error", error.message); }
  finally { hciToggle.disabled = false; }
});
hciDownload.addEventListener("click", async () => {
  hciDownload.disabled = true;
  try { await downloadLog("logs/hci/raw", "bluetooth-hci.btsnoop"); result(logsResult, "success", "Raw HCI capture downloaded."); }
  catch (error) { result(logsResult, "error", error.message); }
  finally { hciDownload.disabled = false; }
});
updateCheck.addEventListener("click", () => refreshSoftwareUpdate(true));
updateAction.addEventListener("click", async () => {
  const updateId = updateAction.dataset.updateId;
  if (!updateId) return;
  updateAction.disabled = true;
  result(updateResult, "working", updateAction.textContent.startsWith("Install") ? "Starting installation…" : "Starting download…");
  try {
    await management(`system/update/${encodeURIComponent(updateId)}`, { method: "POST", body: "{}" });
    await pollSoftwareUpdate(updateId);
  } catch (error) { updateAction.disabled = false; result(updateResult, "error", error.message); }
});

refreshStatus(); refreshHardware(); refreshIntegrationSources(); refreshLogs({ forceSources: true }); refreshSoftwareUpdate(false);
setInterval(refreshStatus, 15_000);
setInterval(() => { if (document.visibilityState === "visible") refreshIntegrationSources(); }, 10_000);
setInterval(() => { if (logsLive.checked && document.visibilityState === "visible") refreshLogs(); }, 2_000);
