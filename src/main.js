import path from "node:path";
import { fileURLToPath } from "node:url";
import { VirtualRemotePlatform } from "./platform.js";
import { PlatformHttpServer } from "./api/server.js";
import { PlatformWebSocketServer } from "./api/websocket-server.js";
import { attachInstalledIntegrationManagement } from "./api/installed-integration-management.js";
import { logger } from "./shared/logger.js";

const log = logger("main");
const directory = path.dirname(fileURLToPath(import.meta.url));
const platform = new VirtualRemotePlatform();
const httpServer = new PlatformHttpServer(platform, path.resolve(directory, "../public"));
const websocketServer = new PlatformWebSocketServer(platform);
attachInstalledIntegrationManagement(httpServer, platform);

const shutdownTimeoutMs = Math.max(1000, Number(process.env.UCVR_SHUTDOWN_TIMEOUT_MS || 5000));
let stopping = false;
async function stop(signal, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  log.info(`Stopping after ${signal}`);
  const forceTimer = setTimeout(() => {
    log.error(`Shutdown did not complete within ${shutdownTimeoutMs} ms; forcing process exit`);
    process.exit(exitCode);
  }, shutdownTimeoutMs);
  try {
    await Promise.allSettled([
      websocketServer.close({ gracePeriodMs: 1000 }),
      httpServer.close({ gracePeriodMs: 1000 })
    ]);
    await platform.stop().catch((error) => log.warn("Platform shutdown failed:", error));
  } finally {
    clearTimeout(forceTimer);
    process.exit(exitCode);
  }
}

platform.events.on("system.restart", (event) => {
  stop(event.data?.reason || "system.restart", Number(event.data?.exit_code || 75));
});

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("uncaughtException", (error) => {
  log.error("Uncaught exception:", error);
  stop("uncaughtException");
});
process.on("unhandledRejection", (error) => log.error("Unhandled rejection:", error));

await httpServer.listen();
await websocketServer.listen();
await platform.start();
log.info(`${platform.name} ${platform.version} ready`);
