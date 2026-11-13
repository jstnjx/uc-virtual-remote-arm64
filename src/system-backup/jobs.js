// Asynchronous backup export and restore jobs (REST Core-API 0.57.0,
// WebSocket `backup_job_change` event, WebSocket Core-API 0.50.0).
//
// One job runs at a time. The latest job stays queryable after it has ended,
// until it is discarded, a new job starts, or the service restarts. A completed
// export keeps its archive under a lease that every download renews.

import crypto from "node:crypto";
import { nowIso } from "../shared/util.js";

const EXPORT_PHASES = ["PREPARE", "DATABASE", "INTEGRATIONS", "ACTIVITIES", "ACTIVITY_GROUPS", "MACROS", "REMOTES", "BLUETOOTH", "PROFILES", "DOCKS", "RESOURCES", "SETTINGS", "FINALIZE"];
const RESTORE_PHASES = ["PREPARE", "INTEGRATIONS", "REMOTES", "ACTIVITIES", "ACTIVITY_GROUPS", "MACROS", "DOCKS", "SETTINGS", "RESOURCES", "PROFILES", "BLUETOOTH"];
export const ARCHIVE_LEASE_SEC = 300;

function conflict(message) {
  return Object.assign(new Error(message), { status: 409, errorCode: "CONFLICT", code: "CONFLICT" });
}

export class BackupJobService {
  constructor(platform, { leaseSeconds = ARCHIVE_LEASE_SEC } = {}) {
    this.platform = platform;
    this.leaseSeconds = leaseSeconds;
    this.job = null;
    this.archive = null;
    this.leaseTimer = null;
    this.downloads = 0;
  }

  running() {
    return this.job?.state === "RUNNING";
  }

  assertIdle() {
    if (this.running()) throw conflict("A backup or restore process is already running");
  }

  list() {
    return this.job ? [this.view()] : [];
  }

  get(jobId) {
    return this.job && this.job.job_id === jobId ? this.view() : null;
  }

  view({ event = false } = {}) {
    if (!this.job) return null;
    const { report, snapshot, ...base } = this.job;
    const value = { ...base, progress: { ...base.progress } };
    if (this.archive && this.job.type === "EXPORT") {
      value.archive = {
        filename: this.archive.filename,
        size: this.archive.buffer.length,
        lease_window_sec: this.leaseSeconds,
        expires_in_sec: this.downloads > 0
          ? this.leaseSeconds
          : Math.max(0, Math.round((this.archive.expiresAt - Date.now()) / 1000)),
      };
    }
    if (!event) {
      if (report) value.report = report;
      if (snapshot) value.snapshot = snapshot;
    }
    return value;
  }

  #publish() {
    this.platform.events.publish("backup.job", this.view({ event: true }));
  }

  #discardArchive() {
    if (this.leaseTimer) clearTimeout(this.leaseTimer);
    this.leaseTimer = null;
    this.archive = null;
  }

  #renewLease() {
    if (!this.archive) return;
    if (this.leaseTimer) clearTimeout(this.leaseTimer);
    this.archive.expiresAt = Date.now() + this.leaseSeconds * 1000;
    this.leaseTimer = setTimeout(() => {
      if (this.downloads > 0) return this.#renewLease();
      this.#discardArchive();
      if (this.job) this.#publish();
    }, this.leaseSeconds * 1000);
    this.leaseTimer.unref?.();
  }

  #start(type, phases) {
    this.assertIdle();
    this.#discardArchive();
    this.job = {
      job_id: crypto.randomUUID(),
      type,
      state: "RUNNING",
      progress: { phase: phases[0], current_step: 1, total_steps: phases.length },
      created_at: nowIso(),
    };
    this.cancelRequested = false;
    this.#publish();
    return this.job;
  }

  async #phases(job, phases, work) {
    for (let index = 0; index < phases.length; index += 1) {
      if (this.cancelRequested) throw Object.assign(new Error("Backup job cancelled"), { cancelled: true });
      job.progress = { phase: phases[index], current_step: index + 1, total_steps: phases.length };
      this.#publish();
      if (index === 1) await work();
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  #finish(job, state, extra = {}) {
    if (this.job !== job) return;
    Object.assign(job, { state, finished_at: nowIso(), ...extra });
    this.#publish();
  }

  #fail(job, error) {
    if (error?.cancelled) return this.#finish(job, "CANCELED");
    return this.#finish(job, "FAILED", {
      error: {
        code: error?.errorCode || error?.code || (Number(error?.status) === 404 ? "NOT_FOUND" : Number(error?.status) === 400 ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR"),
        message: error?.message || "Backup job failed",
      },
    });
  }

  startExport(options = {}) {
    if (options && typeof options !== "object") throw Object.assign(new Error("Invalid backup export options"), { status: 400 });
    if (options?.custom_integrations !== undefined && typeof options.custom_integrations !== "boolean") {
      throw Object.assign(new Error("custom_integrations must be a boolean"), { status: 400 });
    }
    const job = this.#start("EXPORT", EXPORT_PHASES);
    let buffer = null;
    (async () => {
      await this.#phases(job, EXPORT_PHASES, async () => { buffer = this.platform.systemBackup.exportArchive(); });
      const stamp = new Date().toISOString().slice(0, 19).replace("T", "_").replace(/[-:]/g, "").replace(/^(\d{4})(\d{2})(\d{2})_/, "$1-$2-$3_");
      this.archive = { buffer, filename: `UCR3_${stamp}.backup`, expiresAt: Date.now() + this.leaseSeconds * 1000 };
      this.#renewLease();
      this.#finish(job, "COMPLETED", { report: [] });
    })().catch((error) => this.#fail(job, error));
    return this.view();
  }

  startRestore(buffer, options = {}) {
    const job = this.#start("RESTORE", RESTORE_PHASES);
    (async () => {
      let result = null;
      await this.#phases(job, RESTORE_PHASES, async () => { result = this.platform.systemBackup.restore(buffer, options); });
      this.#finish(job, "COMPLETED", { report: Array.isArray(result?.report) ? result.report : [] });
    })().catch((error) => this.#fail(job, error));
    return this.view();
  }

  cancelOrDiscard(jobId) {
    if (!this.job || this.job.job_id !== jobId) return null;
    if (this.running()) {
      if (this.job.type === "RESTORE") throw conflict("A running restore cannot be cancelled");
      this.cancelRequested = true;
      return this.view();
    }
    this.#discardArchive();
    const value = this.view();
    this.job = null;
    return value;
  }

  // Returns `{ filename, buffer, done }` or null. `done` must be called when the
  // download has ended, so the lease runs again.
  download(jobId) {
    if (!this.job || this.job.job_id !== jobId || !this.archive) return null;
    this.downloads += 1;
    this.#renewLease();
    const archive = this.archive;
    let ended = false;
    return {
      filename: archive.filename,
      buffer: archive.buffer,
      done: () => {
        if (ended) return;
        ended = true;
        this.downloads = Math.max(0, this.downloads - 1);
        this.#renewLease();
      },
    };
  }

  stop() {
    this.#discardArchive();
  }
}
