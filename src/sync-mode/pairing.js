import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DRIVER_ID = "remote_sync";
const DEFAULT_AGENT_PORT = 11081;

function atomicJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(temporary, filename);
}

function config(filename) {
  try {
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch {
    throw Object.assign(
      new Error("Apply Sync Mode before pairing a Satellite"),
      { status: 409 },
    );
  }
}

function normalizeAgentUrl(value) {
  let text = String(value || "").trim();
  if (!text) {
    throw Object.assign(new Error("Enter the Satellite agent address"), {
      status: 400,
    });
  }
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  const url = new URL(text);
  if (!url.port) url.port = String(DEFAULT_AGENT_PORT);
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/, "");
}

function pairingIdentifier(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function networkValue(...responses) {
  for (const response of responses) {
    if (!response || typeof response !== "object") continue;
    const nested =
      response.network && typeof response.network === "object"
        ? response.network
        : {};
    const mac = nested.mac || response.mac || null;
    const broadcasts = Array.isArray(nested.broadcasts)
      ? nested.broadcasts
      : Array.isArray(response.broadcasts)
        ? response.broadcasts
        : [];
    if (mac || broadcasts.length) return { mac, broadcasts };
  }
  return { mac: null, broadcasts: [] };
}

async function agentJson(baseUrl, endpoint, token, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: options.method || "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
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
          payload?.error ||
            payload?.message ||
            `Satellite agent returned HTTP ${response.status}`,
        ),
        { status: response.status },
      );
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function primaryAgentUrl(service, settings) {
  if (settings.primary.agent_public_url) {
    return String(settings.primary.agent_public_url).replace(/\/$/, "");
  }
  return `http://${service.platform.hostname}:${settings.primary.agent_port}`;
}

async function restartPrimary(service) {
  if (!service.platform.externalIntegrations.managedRecord(DRIVER_ID)) return;
  const integration = service.platform.db
    .listIntegrations()
    .find(
      (item) =>
        String(item.driver_id || item.metadata?.driver_id || item.id) ===
          DRIVER_ID && !item.metadata?.instance_alias,
    );
  if (integration) {
    await service.platform.integrations.disconnect(integration.id).catch(() => {});
  }
  await service.platform.externalIntegrations
    .setRunning(DRIVER_ID, false)
    .catch(() => {});
  await service.platform.externalIntegrations.setRunning(DRIVER_ID, true);
  if (integration) {
    await service.platform.integrations.connect(integration.id).catch(() => {});
  }
}

export function installSyncModePairing(service) {
  service.pairSatellite = async (input = {}) => {
    const settings = service.settings();
    if (!settings.enabled) {
      throw Object.assign(
        new Error("Enable and apply Sync Mode before pairing a Satellite"),
        { status: 409 },
      );
    }

    const baseUrl = normalizeAgentUrl(input.url || input.address);
    const token = String(input.token || "").trim();
    if (token.length < 16) {
      throw Object.assign(
        new Error("Enter the pairing token displayed by the Satellite"),
        { status: 400 },
      );
    }

    const capabilities = await agentJson(
      baseUrl,
      "/v1/capabilities",
      token,
    );
    if (capabilities.role !== "child") {
      throw Object.assign(
        new Error("The selected Remote Sync agent is not a Satellite"),
        { status: 409 },
      );
    }
    if (capabilities.ready_to_pair === false) {
      throw Object.assign(
        new Error("The selected Satellite is not ready to pair"),
        { status: 409 },
      );
    }

    const current = config(service.configPath());
    const validated = await agentJson(
      baseUrl,
      "/v1/pairing/validate",
      token,
      {
        method: "POST",
        body: {
          master_id: current.node_id,
          master_name: current.node_name,
        },
      },
    );

    const identifier = pairingIdentifier(
      validated.identifier || capabilities.identifier,
    );
    if (!identifier) {
      throw Object.assign(
        new Error("The Satellite did not provide a pairing identifier"),
        { status: 422 },
      );
    }

    const commandToken = crypto.randomBytes(32).toString("base64url");
    const claimed = await agentJson(baseUrl, "/v1/pairing/claim", token, {
      method: "POST",
      body: {
        master_id: current.node_id,
        master_name: current.node_name,
        master_agent_url: primaryAgentUrl(service, settings),
        master_command_token: commandToken,
        master_mac: current.remote?.mac || null,
        master_broadcasts: current.remote?.broadcasts || [],
      },
    });

    const satelliteNetwork = networkValue(claimed, validated);
    const peer = {
      peer_id: `rms-${identifier.toLowerCase()}`,
      identifier,
      name:
        String(input.name || "").trim() ||
        claimed.node_name ||
        validated.node_name ||
        capabilities.node_name ||
        identifier,
      url: baseUrl,
      token,
      mac: satelliteNetwork.mac,
      broadcasts: satelliteNetwork.broadcasts,
      enabled: true,
      child_node_id:
        claimed.node_id || validated.node_id || capabilities.node_id || null,
      claimed_at: claimed.paired_at || new Date().toISOString(),
      command_token: commandToken,
      protocol: capabilities,
    };

    const peers = Array.isArray(current.peers) ? [...current.peers] : [];
    const index = peers.findIndex(
      (item) =>
        item.peer_id === peer.peer_id ||
        pairingIdentifier(item.identifier) === identifier,
    );
    if (index >= 0) peers[index] = { ...peers[index], ...peer };
    else peers.push(peer);
    current.peers = peers;
    atomicJson(service.configPath(), current);
    await restartPrimary(service);
    return service.status(true);
  };

  return service;
}
