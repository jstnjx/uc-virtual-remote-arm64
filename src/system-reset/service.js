import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../shared/logger.js";

const log = logger("factory-reset");

export class FactoryResetService {
  constructor(platform, options = {}) {
    this.platform = platform;
    this.tokenTtlMs = Number(options.tokenTtlMs || 60_000);
    this.token = null;
    this.expiresAt = 0;
    this.running = false;
  }

  issueToken() {
    this.token = crypto.randomBytes(24).toString("base64url");
    this.expiresAt = Date.now() + this.tokenTtlMs;
    log.info("Factory reset authorization token issued");
    return { token: this.token, expires_at: new Date(this.expiresAt).toISOString() };
  }

  validate(token) {
    const supplied = Buffer.from(String(token || ""));
    const expected = Buffer.from(String(this.token || ""));
    return this.token && Date.now() <= this.expiresAt && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  }

  schedule(token) {
    if (!this.validate(token)) throw Object.assign(new Error("Factory reset token is invalid or expired"), { status: 403 });
    this.token = null;
    this.expiresAt = 0;
    setTimeout(() => this.execute().catch((error) => log.error("Factory reset failed:", error)), 150).unref?.();
    return { accepted: true };
  }

  async execute() {
    if (this.running) return;
    this.running = true;
    log.warn(`Factory reset started: erasing ${this.platform.dataDir}`);
    await this.platform.externalIntegrations?.factoryReset().catch((error) => log.warn("Unable to remove every managed integration container:", error.message));
    await this.platform.integrations?.stop().catch((error) => log.warn("Unable to stop every integration connection:", error.message));
    await this.platform.demo?.stop().catch((error) => log.warn("Unable to stop demo mode:", error.message));
    await this.platform.hardware?.stop?.().catch((error) => log.warn("Unable to stop host hardware services:", error.message));
    this.platform.db?.close();
    const dataDir = path.resolve(this.platform.dataDir);
    // The community Web Configurator is bundled into the application image,
    // not installed into persistent user data.
    const preserved = new Set(["application"]);
    for (const item of fs.readdirSync(dataDir, { withFileTypes: true })) {
      if (preserved.has(item.name)) continue;
      fs.rmSync(path.join(dataDir, item.name), { recursive: true, force: true });
    }
    log.info(`Factory reset preserved: ${[...preserved].sort().join(", ")}`);
    log.warn("Factory reset completed; restarting Virtual Remote Core");
    this.platform.events.publish("system.restart", { reason: "factory_reset", exit_code: 75 });
  }
}
