import { installSyncModeNetworkConfigBridge } from "./network-config-bridge.js";
import { installSyncModePairing } from "./pairing.js";

const DRIVER_ID = "remote_sync";
const STABLE_SETUP_PHASES = new Set([
  "awaiting_initial_setup",
  "driver_setup",
  "complete",
]);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function statusRefreshReady(service) {
  return Boolean(
    service.platform.configuration &&
      typeof service.platform.hardware?.status === "function",
  );
}

function publicSnapshot(service) {
  const settings = service.settings();
  const cached = service.lastStatus || null;
  return {
    ...(cached || {}),
    settings,
    enabled: settings.enabled,
    applying: Boolean(service.applying || service.commandRunning),
    configured: cached?.configured ?? false,
    credentials: cached?.credentials || {
      api_key_provisioned: false,
      api_key_id: null,
      agent_token_provisioned: false,
    },
    integration: cached?.integration || null,
    managed: cached?.managed || null,
    job: cached?.job || null,
    agent: cached?.agent || { health: null, status: null, satellites: [] },
    warnings: [
      ...(settings.enabled ? cached?.warnings || [] : []),
      ...(service.commandError ? [service.commandError] : []),
    ],
    catalog: cached?.catalog || [],
    updated_at: cached?.updated_at || null,
  };
}

function filterCatalog(groups) {
  return (Array.isArray(groups) ? groups : []).map((group) => ({
    ...group,
    items: (Array.isArray(group.items) ? group.items : []).filter(
      (item) =>
        !String(item?.key || "").startsWith("sync_mode") &&
        !String(item?.key || "").startsWith("network.sync_mode"),
    ),
  }));
}

async function finalizeManagedIntegration(service, timeoutMs = 15 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  let record = null;
  let job = null;

  while (Date.now() < deadline) {
    record = service.platform.db
      .listIntegrations()
      .find(
        (item) =>
          String(item.driver_id || item.metadata?.driver_id || item.id) ===
            DRIVER_ID && !item.metadata?.instance_alias,
      );
    job = service.platform.externalIntegrations.job(DRIVER_ID);

    if (job?.state === "error") {
      throw Object.assign(
        new Error(job.message || "Remote Sync installation failed"),
        { status: 500 },
      );
    }
    if (job?.state === "cancelled") {
      throw Object.assign(new Error("Remote Sync installation was cancelled"), {
        status: 409,
      });
    }
    if (record && (!job || STABLE_SETUP_PHASES.has(job.phase))) break;
    await delay(500);
  }

  if (!record) {
    throw Object.assign(
      new Error(
        "Remote Sync container started but its integration driver did not register",
      ),
      { status: 504 },
    );
  }
  if (job && !STABLE_SETUP_PHASES.has(job.phase)) {
    throw Object.assign(
      new Error("Remote Sync installation did not reach a configurable state"),
      { status: 504 },
    );
  }

  if (job?.phase === "driver_setup") {
    await service.platform.integrations.abortSetup(record.id).catch(() => {});
  }

  service.platform.db.updateIntegration(record.id, {
    configured: true,
    enabled: true,
    setup_state: "OK",
    setup_action: null,
    last_error: null,
  });

  if (job) {
    job.state = "success";
    job.phase = "complete";
    job.progress = 100;
    job.message = "Integration configured by Sync Mode";
    job.updatedAt = new Date().toISOString();
  }

  service.platform.events.publish("integration.setup", {
    id: record.id,
    driver_id: DRIVER_ID,
    event_type: "STOP",
    state: "OK",
  });
  await service.platform.integrations.connect(record.id).catch(() => {});
}

export function installSyncModeConfigurationAdapter(service) {
  installSyncModePairing(service);
  service.lastStatus = null;
  service.commandRunning = false;
  service.commandError = null;
  service.refreshPromise = null;
  service.lastRefreshAt = 0;
  service.networkBridgeInstalled = false;

  const originalStart = service.start.bind(service);
  service.start = async () => {
    if (!service.networkBridgeInstalled) {
      installSyncModeNetworkConfigBridge(
        service.platform.configuration,
        service,
      );
      service.networkBridgeInstalled = true;
    }
    service.commandError = null;
    return originalStart();
  };

  const originalCatalog = service.catalog.bind(service);
  service.catalog = (hardware = {}) => filterCatalog(originalCatalog(hardware));

  const originalStatus = service.status.bind(service);
  service.status = async (refresh = false) => {
    const result = await originalStatus(refresh);
    service.lastStatus = {
      ...result,
      catalog: filterCatalog(result.catalog),
      updated_at: new Date().toISOString(),
    };
    service.lastRefreshAt = Date.now();
    return service.lastStatus;
  };

  const originalApply = service.apply.bind(service);
  service.apply = async (patch = {}, options = {}) => {
    const result = await originalApply(patch, options);
    await finalizeManagedIntegration(service);
    return service.status(true).catch(() => result);
  };

  service.configurationState = (refresh = true) => {
    if (
      refresh &&
      statusRefreshReady(service) &&
      !service.refreshPromise &&
      Date.now() - service.lastRefreshAt > 2000
    ) {
      service.refreshPromise = service
        .status(false)
        .catch((error) => {
          service.commandError = error.message;
          return null;
        })
        .finally(() => {
          service.refreshPromise = null;
        });
    }
    return publicSnapshot(service);
  };

  service.handleConfigurationPatch = (input = {}) => {
    const patch = input && typeof input === "object" ? { ...input } : {};
    const action = String(patch.action || "save").toLowerCase();
    delete patch.action;

    const explicitSettings =
      patch.settings && typeof patch.settings === "object"
        ? patch.settings
        : null;
    const inlineSettings = { ...patch };
    delete inlineSettings.settings;
    delete inlineSettings.satellite;
    delete inlineSettings.peer_id;
    delete inlineSettings.satellite_action;
    const settingsPatch =
      explicitSettings ||
      (["save", "apply", "enable"].includes(action) ? inlineSettings : {});
    if (Object.keys(settingsPatch).length) service.update(settingsPatch);

    if (action === "save" || action === "refresh") {
      if (action === "refresh") service.lastRefreshAt = 0;
      return service.configurationState(true);
    }

    if (service.commandRunning) {
      service.commandError = "A Sync Mode operation is already running";
      return service.configurationState(false);
    }

    service.commandRunning = true;
    service.commandError = null;
    setImmediate(async () => {
      try {
        if (action === "apply" || action === "enable") {
          await service.apply(settingsPatch);
        } else if (action === "disable") {
          await service.disable();
        } else if (action === "rotate-key") {
          await service.rotateCredentials();
        } else if (action === "sync") {
          await service.sync(false);
        } else if (action === "preview") {
          await service.sync(true);
        } else if (action === "pair-satellite") {
          await service.pairSatellite(patch.satellite || {});
        } else if (action === "satellite-action") {
          await service.satelliteAction(
            String(patch.peer_id || ""),
            String(patch.satellite_action || ""),
          );
        } else {
          throw Object.assign(
            new Error(`Unsupported Sync Mode action ${action}`),
            { status: 400 },
          );
        }
        await service.status(true).catch(() => null);
      } catch (error) {
        service.commandError = error.message;
      } finally {
        service.commandRunning = false;
      }
    });

    return service.configurationState(false);
  };

  return service;
}
