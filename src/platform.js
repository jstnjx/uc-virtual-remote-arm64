import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventBus } from "./core/event-bus.js";
import { PlatformDatabase } from "./storage/database.js";
import { IntegrationManager } from "./integrations/manager.js";
import { ExternalIntegrationService } from "./external-integrations/service.js";
import { NativeIntegrationService } from "./native-integrations/service.js";
import { HardwareService } from "./hardware/service.js";
import { FactoryResetService } from "./system-reset/service.js";
import { SequenceEngine } from "./engine/sequence-engine.js";
import { ConfigurationService } from "./core/configuration.js";
import { WebConfiguratorManager } from "./web-configurator.js";
import { MediaService } from "./media/service.js";
import { DockService } from "./docks/service.js";
import { SystemUpdateService } from "./system-update/service.js";
import { SystemBackupService } from "./system-backup/service.js";
import { DemoModeService } from "./demo/service.js";
import { SyncModeService } from "./sync-mode/service.js";
import { installSyncModeConfigurationAdapter } from "./sync-mode/config-adapter.js";
import { configureLogger, logger } from "./shared/logger.js";
import { visibleIntegrations } from "./core/models.js";

const log = logger("platform");
const applicationRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function applicationVersion() {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(applicationRoot, "package.json"), "utf8"),
    );
    const version = String(packageJson.version || "").trim();
    if (version) return version;
  } catch (error) {
    log.warn(
      `Unable to read application version from package.json: ${error.message}`,
    );
  }
  return "0.0.0";
}

function directorySize(directory) {
  let total = 0;
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(filename);
      else if (entry.isFile()) {
        try {
          total += fs.statSync(filename).size;
        } catch {}
      }
    }
  }
  return total;
}

function parsePort(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return port;
}

export class VirtualRemotePlatform {
  constructor(options = {}) {
    this.id = options.id || process.env.UCVR_ID || "uc-virtual-remote";
    this.name = options.name || process.env.UCVR_NAME || "Virtual Remote 3";
    const bundledVersion = applicationVersion();
    const activeCommit = String(process.env.UCVR_ACTIVE_RELEASE_COMMIT || "");
    this.version =
      process.env.UCVR_ACTIVE_RELEASE_CHANNEL === "TESTING" && activeCommit
        ? `${bundledVersion}-beta.${activeCommit.slice(0, 7)}`
        : bundledVersion;
    this.restCoreApiVersion = "0.32.0";
    this.coreWebSocketApiVersion = "0.25.0-beta";
    this.integrationApiVersion = "0.10.0-beta";
    this.remoteUiCompatibilityVersion = "0.38.4";
    this.locale = process.env.UCVR_LOCALE || "en-US";
    this.timezone =
      process.env.TZ ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "UTC";
    this.dataDir =
      options.dataDir || process.env.UCVR_DATA_DIR || path.resolve("data");
    this.host = options.host || process.env.UCVR_HOST || "0.0.0.0";
    this.restPort = parsePort(
      options.restPort ??
        process.env.UCVR_REST_PORT ??
        process.env.UCVR_PORT ??
        11090,
      "REST port",
    );
    this.websocketPort = parsePort(
      options.websocketPort ?? 946,
      "WebSocket port",
    );
    if (this.restPort === this.websocketPort) {
      throw new Error(
        `REST port ${this.restPort} conflicts with the fixed Core WebSocket port ${this.websocketPort}`,
      );
    }
    this.port = this.restPort;
    this.pin = process.env.UCVR_PIN || "1234";
    this.adminToken = process.env.UCVR_ADMIN_TOKEN || "";
    this.coreToken = process.env.UCVR_CORE_TOKEN || "";
    this.hostname = os.hostname();
    this.supportedEntityTypes = [
      "activity",
      "button",
      "climate",
      "cover",
      "ir_emitter",
      "light",
      "macro",
      "media_player",
      "remote",
      "select",
      "sensor",
      "switch",
    ];
    configureLogger({
      file: path.join(this.dataDir, "logs", "uc-virtual-remote.log"),
    });
    this.events = new EventBus();
    this.db = new PlatformDatabase(this.dataDir);
    this.syncMode = installSyncModeConfigurationAdapter(
      new SyncModeService(this),
    );
    this.configuration = new ConfigurationService(this);
    this.demo = new DemoModeService(this);
    this.integrations = new IntegrationManager(this);
    this.media = new MediaService(this);
    this.docks = new DockService(this);
    this.systemUpdate = new SystemUpdateService(this);
    this.systemBackup = new SystemBackupService(this);
    this.engine = new SequenceEngine(this);
    this.webConfigurator = new WebConfiguratorManager(this.dataDir);
    this.externalIntegrations = new ExternalIntegrationService(
      this,
      options.externalIntegrations || {},
    );
    this.nativeIntegrations = new NativeIntegrationService(
      this,
      options.nativeIntegrations || {},
    );
    this.hardware = new HardwareService(this, options.hardware || {});
    this.factoryReset = new FactoryResetService(
      this,
      options.factoryReset || {},
    );
    this.stopped = false;
  }

  async start() {
    log.info(
      `Starting Virtual Remote Core ${this.version}: id=${this.id}, rest=${this.restPort}, websocket=${this.websocketPort}, data=${this.dataDir}`,
    );
    const internalOwner = this.db.getIntegration("uc.main");
    if (internalOwner) {
      this.db.updateIntegration("uc.main", {
        name: "UC Virtual Remote",
        url: "virtual://core",
        enabled: false,
        status: "CONNECTED",
        device_state: "CONNECTED",
        driver_id: "uc",
        driver_type: "INTERNAL",
        driver_version: this.version,
        configured: true,
        metadata: {
          ...(internalOwner.metadata || {}),
          internal: true,
          hidden: true,
          name: { en: "UC Virtual Remote" },
          version: this.version,
        },
      });
    }
    await this.hardware
      .refresh()
      .catch((error) =>
        log.warn("Initial host hardware scan failed:", error.message),
      );
    if (this.configuration.get("bt").enable_hci_log) {
      await this.hardware
        .setHciLogging(true)
        .catch((error) =>
          log.warn("Unable to enable Bluetooth HCI logging:", error.message),
        );
    }
    await this.externalIntegrations.start();
    await this.nativeIntegrations.start();
    await this.demo.start();
    await this.integrations.start();
    await this.syncMode.start();
    log.info(
      `Virtual Remote Core ready: configured_integrations=${visibleIntegrations(this.db.listIntegrations()).length}, configurator=${this.webConfigurator.status().installed ? "installed" : "not-installed"}`,
    );
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    log.info("Stopping Virtual Remote Core services");
    await this.syncMode.stop();
    await this.nativeIntegrations.stop();
    await this.externalIntegrations.stop();
    await this.demo.stop();
    await this.integrations.stop();
    await this.hardware
      .stop()
      .catch((error) =>
        log.warn("Unable to stop host hardware services:", error.message),
      );
    this.db.close();
  }

  status() {
    const integrations = visibleIntegrations(this.db.listIntegrations());
    const docks = this.docks.list();
    const memory = process.memoryUsage();
    const databaseBytes = fs.existsSync(this.db.path)
      ? fs.statSync(this.db.path).size
      : 0;
    const resourcesBytes = directorySize(this.db.resourcesDir);
    const mediaBytes = directorySize(this.db.mediaDir);
    const externalBytes = directorySize(
      path.join(this.dataDir, "external-integrations"),
    );
    const mediaSessions = this.media.listSessions();
    const mediaQueues = Number(
      this.db.db.prepare("SELECT COUNT(*) AS count FROM media_queues").get()
        .count || 0,
    );
    const cachedArtwork = Number(
      this.db.db.prepare("SELECT COUNT(*) AS count FROM media_artwork").get()
        .count || 0,
    );
    return {
      id: this.id,
      name: this.name,
      model: "UCR3",
      emulated: true,
      online: true,
      state: "ONLINE",
      version: this.version,
      api: {
        rest: this.restCoreApiVersion,
        websocket: this.coreWebSocketApiVersion,
        integration: this.integrationApiVersion,
        remote_ui: this.remoteUiCompatibilityVersion,
      },
      integration_api: this.integrationApiVersion,
      hostname: this.hostname,
      timezone: this.timezone,
      endpoints: {
        rest_port: this.restPort,
        websocket_port: this.websocketPort,
        websocket_path: "/ws",
      },
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        uptime_seconds: Math.floor(process.uptime()),
        memory: {
          rss: memory.rss,
          heap_total: memory.heapTotal,
          heap_used: memory.heapUsed,
          external: memory.external,
        },
      },
      storage: {
        database_bytes: databaseBytes,
        resources_bytes: resourcesBytes,
        media_cache_bytes: mediaBytes,
        external_integrations_bytes: externalBytes,
        data_bytes:
          databaseBytes + resourcesBytes + mediaBytes + externalBytes,
      },
      integrations: {
        total: integrations.length,
        connected: integrations.filter((item) => item.status === "CONNECTED")
          .length,
        errors: integrations.filter((item) => item.status === "ERROR").length,
        managed: this.externalIntegrations.status().managed_instances,
      },
      entities: {
        available: this.db.listAvailableEntities().length,
        configured: this.db.listConfiguredEntities().length,
      },
      activities: this.db.listActivities().length,
      macros: this.db.listMacros().length,
      profiles: this.db.listProfiles().length,
      pages: this.db.listPages().length,
      docks: {
        total: docks.length,
        active: docks.filter(
          (item) => item.active && item.state === "ACTIVE",
        ).length,
      },
      media: {
        sessions: mediaSessions.length,
        queues: mediaQueues,
        cached_artwork: cachedArtwork,
      },
      web_configurator: this.webConfigurator.status(),
      software_update: this.systemUpdate.status(),
      external_integrations: this.externalIntegrations.status(),
      native_integrations: this.nativeIntegrations.status(),
      sync_mode: this.syncMode.summary(),
      native_hardware: this.hardware.cached,
    };
  }
}
