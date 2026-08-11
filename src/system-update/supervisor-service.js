import fs from "node:fs";
import path from "node:path";
import { logger } from "../shared/logger.js";
import { nowIso, slug } from "../shared/util.js";
import { SupervisorUpdateAdapter } from "./supervisor.js";

const log = logger("system-update");
const CACHE_MS = 5 * 60 * 1000;

function safeUpdateId(value) {
  return slug(String(value || "update"), "update").slice(0, 120);
}

function atomicJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filename);
}

export class SupervisorSystemUpdateService {
  constructor(platform, options = {}) {
    this.platform = platform;
    this.repository = "jstnjx/uc-virtual-remote-ha-addon";
    this.dataDir = path.join(platform.dataDir, "application");
    this.downloadDir = path.join(this.dataDir, "downloads");
    this.stateFile = path.join(this.dataDir, "update-state.json");
    this.supervisor = new SupervisorUpdateAdapter(options.supervisor || {});
    this.cache = null;
    this.tasks = new Map();
    this.progressState = new Map();
    this.lastError = null;
    fs.mkdirSync(this.downloadDir, { recursive: true });
  }

  channel() {
    return "DEFAULT";
  }

  activeRelease() {
    return null;
  }

  status() {
    return {
      repository: this.repository,
      channel: this.channel(),
      active_release: null,
      supervisor_managed: true,
      supervisor_installed_version: this.supervisor.installedVersion,
      supervisor_latest_version: this.supervisor.latestVersion,
      last_checked_at: this.cache?.checkedAt || null,
      last_error: this.lastError
    };
  }

  async check(force = false) {
    if (!force && this.cache && Date.now() - this.cache.timestamp < CACHE_MS) {
      return this.#response(this.cache.updates);
    }
    try {
      const update = await this.supervisor.check(force);
      const updates = update ? [this.#withDownloadState(update)] : [];
      this.cache = {
        channel: "DEFAULT",
        updates,
        timestamp: Date.now(),
        checkedAt: nowIso()
      };
      this.lastError = null;
      atomicJson(this.stateFile, { ...this.cache, updates, supervisor_managed: true });
      return this.#response(updates);
    } catch (error) {
      this.lastError = error.message;
      log.warn(`Home Assistant Supervisor update check failed: ${error.message}`);
      this.cache = {
        channel: "DEFAULT",
        updates: [],
        timestamp: Date.now(),
        checkedAt: nowIso()
      };
      atomicJson(this.stateFile, { ...this.cache, error: this.lastError, supervisor_managed: true });
      return this.#response([], this.lastError);
    }
  }

  progress(updateId) {
    const current = this.progressState.get(String(updateId));
    if (current) return { ...current };
    const update = this.cache?.updates?.find((item) => item.id === updateId);
    if (!update) return null;
    return {
      state: fs.existsSync(this.#markerPath(update)) ? "DONE" : "IDLE",
      update_id: update.id
    };
  }

  async action(updateId) {
    await this.check(false);
    const update = this.cache?.updates?.find((item) => item.id === updateId);
    if (!update) throw Object.assign(new Error(`Unknown software update ${updateId}`), { status: 404 });
    if (this.tasks.has(updateId)) {
      const task = this.tasks.get(updateId);
      return {
        code: "OK",
        action: task.action,
        state: task.action === "INSTALL" ? "START" : "DOWNLOAD",
        update_id: updateId
      };
    }

    const marker = this.#markerPath(update);
    if (!fs.existsSync(marker)) {
      const task = { action: "DOWNLOAD" };
      this.tasks.set(updateId, task);
      this.#prepare(update, marker).finally(() => this.tasks.delete(updateId));
      return { code: "OK", action: "DOWNLOAD", state: "DOWNLOAD", update_id: updateId };
    }

    const task = { action: "INSTALL" };
    this.tasks.set(updateId, task);
    this.#install(update, marker).finally(() => this.tasks.delete(updateId));
    return { code: "OK", action: "INSTALL", state: "START", update_id: updateId };
  }

  #response(updates, error = null) {
    const checkedAt = this.cache?.checkedAt || nowIso();
    const softwareUpdate = this.platform.configuration.get("software_update");
    return {
      update_in_progress: this.tasks.size > 0,
      update_check_enabled: Boolean(softwareUpdate.check_for_updates),
      installed_version: this.supervisor.installedVersion || this.platform.version,
      available: updates.map((item) => this.#publicUpdate(this.#withDownloadState(item))),
      last_check_date: checkedAt,
      next_check_date: new Date(Date.parse(checkedAt) + CACHE_MS).toISOString(),
      channel: "DEFAULT",
      repository: this.repository,
      checked_at: checkedAt,
      supervisor_managed: true,
      ...(error ? { check_error: error } : {})
    };
  }

  #publicUpdate(update) {
    const title = typeof update.title === "object"
      ? (update.title.en || Object.values(update.title)[0] || update.version)
      : String(update.title || update.version);
    return {
      id: update.id,
      version: update.version,
      title,
      description: typeof update.description === "object" ? update.description : { en: String(update.description || "") },
      release_date: String(update.release_date || nowIso()).slice(0, 10),
      size: 0,
      download: update.download,
      channel: "STABLE",
      source: "HOME_ASSISTANT_SUPERVISOR"
    };
  }

  #withDownloadState(update) {
    return {
      ...update,
      download: fs.existsSync(this.#markerPath(update)) ? "DOWNLOADED" : "PENDING"
    };
  }

  #markerPath(update) {
    return path.join(this.downloadDir, `${safeUpdateId(update.id)}.supervisor.json`);
  }

  #publish(progress, eventType = "PROGRESS") {
    if (progress?.update_id) this.progressState.set(String(progress.update_id), { ...progress });
    this.platform.events.publish("software.update", { event_type: eventType, progress });
  }

  async #prepare(update, marker) {
    try {
      this.#publish({ state: "DOWNLOAD", update_id: update.id, download_percent: 0 }, "START");
      atomicJson(marker, {
        source: "HOME_ASSISTANT_SUPERVISOR",
        update_id: update.id,
        version: update.version,
        prepared_at: nowIso()
      });
      this.cache = this.cache ? {
        ...this.cache,
        updates: this.cache.updates.map((item) => item.id === update.id ? this.#withDownloadState(item) : item)
      } : this.cache;
      this.#publish({ state: "DOWNLOAD", update_id: update.id, download_percent: 100 });
      this.#publish({ state: "SUCCESS", update_id: update.id });
    } catch (error) {
      fs.rmSync(marker, { force: true });
      this.#publish({ state: "FAILURE", update_id: update.id, error: error.message });
      log.error(`Supervisor update preparation failed: ${error.message}`);
    }
  }

  async #install(update, marker) {
    try {
      this.#publish({ state: "START", update_id: update.id }, "START");
      const result = await this.supervisor.install(update);
      fs.rmSync(marker, { force: true });
      this.#publish({ state: "PROGRESS", update_id: update.id, progress_percent: 100 });
      this.#publish({ state: "DONE", update_id: update.id });
      log.info(`Handed software update ${update.id} to Home Assistant Supervisor${result?.job_id ? ` (job ${result.job_id})` : ""}`);
    } catch (error) {
      this.#publish({ state: "FAILURE", update_id: update.id, error: error.message });
      log.error(`Home Assistant Supervisor update failed: ${error.message}`);
    }
  }
}
