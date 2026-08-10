import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractZip, findDirectory, readJson } from "../shared/archive.js";
import { logger } from "../shared/logger.js";
import { nowIso, slug } from "../shared/util.js";

const log = logger("system-update");
const DEFAULT_REPOSITORY = "jstnjx/uc-virtual-remote";
const CACHE_MS = 5 * 60 * 1000;

function normalizedVersion(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

function versionParts(value) {
  const match = normalizedVersion(value).match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1).map(Number) : null;
}

function newerVersion(candidate, installed) {
  const left = versionParts(candidate);
  const right = versionParts(installed);
  if (!left || !right) return normalizedVersion(candidate) !== normalizedVersion(installed);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

function localized(value) {
  return { en: String(value || "") };
}

function safeUpdateId(value) {
  return slug(String(value || "update"), "update").slice(0, 120);
}

function atomicJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filename);
}

async function githubRequestError(response, context) {
  let detail = "";
  try {
    const contentType = String(response.headers.get("content-type") || "");
    if (contentType.includes("application/json")) {
      const body = await response.json();
      detail = String(body?.message || "").trim();
    } else {
      detail = String(await response.text()).trim().slice(0, 300);
    }
  } catch {}

  let message;
  if (response.status === 401) {
    message = "GitHub authentication failed. Check that UCVR_GITHUB_TOKEN is valid and has not expired";
  } else if (response.status === 403) {
    message = "GitHub denied the update request. Check token repository access, Contents permission, and API rate limits";
  } else if (response.status === 404) {
    message = "GitHub update repository, release, or asset was not found. For a private repository, configure UCVR_GITHUB_TOKEN with read access to that repository";
  } else {
    message = `${context} failed with HTTP ${response.status}`;
  }
  if (detail && !message.toLowerCase().includes(detail.toLowerCase())) message += `: ${detail}`;
  return Object.assign(new Error(message), { status: response.status });
}

async function fetchJson(url, headers, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw await githubRequestError(response, "GitHub request");
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function chooseReleaseArchive(release) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const preferred = assets.find((asset) => /^uc-virtual-remote(?:[-_.].*)?\.zip$/i.test(String(asset.name || "")))
    || assets.find((asset) => /uc-virtual-remote.*\.zip$/i.test(String(asset.name || "")));
  if (preferred?.url) {
    return {
      url: preferred.url,
      accept: "application/octet-stream",
      type: "GITHUB_RELEASE_ASSET",
      name: preferred.name || null
    };
  }
  if (preferred?.browser_download_url) {
    return {
      url: preferred.browser_download_url,
      accept: "application/octet-stream",
      type: "GITHUB_RELEASE_ASSET_BROWSER_URL",
      name: preferred.name || null
    };
  }
  if (release.zipball_url) {
    return {
      url: release.zipball_url,
      accept: "application/vnd.github+json",
      type: "GITHUB_RELEASE_SOURCE_ARCHIVE",
      name: null
    };
  }
  return null;
}

export class SystemUpdateService {
  constructor(platform, options = {}) {
    this.platform = platform;
    this.repository = options.repository || process.env.UCVR_UPDATE_REPOSITORY || DEFAULT_REPOSITORY;
    this.apiBase = String(options.apiBase || process.env.UCVR_UPDATE_API_BASE || "https://api.github.com").replace(/\/$/, "");
    this.dataDir = path.join(platform.dataDir, "application");
    this.downloadDir = path.join(this.dataDir, "downloads");
    this.releaseDir = path.join(this.dataDir, "releases");
    this.activeFile = path.join(this.dataDir, "active.json");
    this.stateFile = path.join(this.dataDir, "update-state.json");
    this.cache = null;
    this.tasks = new Map();
    this.progressState = new Map();
    this.lastError = null;
    fs.mkdirSync(this.downloadDir, { recursive: true });
    fs.mkdirSync(this.releaseDir, { recursive: true });
  }

  channel() {
    return this.platform.configuration.get("software_update").channel === "TESTING" ? "TESTING" : "DEFAULT";
  }

  activeRelease() {
    return readJson(this.activeFile, null);
  }

  status() {
    return {
      repository: this.repository,
      channel: this.channel(),
      active_release: this.activeRelease(),
      last_checked_at: this.cache?.checkedAt || null,
      last_error: this.lastError
    };
  }

  async check(force = false) {
    const channel = this.channel();
    if (!force && this.cache && this.cache.channel === channel && Date.now() - this.cache.timestamp < CACHE_MS) {
      return this.#response(this.cache.updates);
    }
    try {
      const update = channel === "TESTING" ? await this.#testingUpdate() : await this.#stableUpdate();
      const updates = update ? [this.#withDownloadState(update)] : [];
      this.cache = { channel, updates, timestamp: Date.now(), checkedAt: nowIso() };
      this.lastError = null;
      atomicJson(this.stateFile, { ...this.cache, updates });
      return this.#response(updates);
    } catch (error) {
      this.lastError = error.message;
      log.warn(`Update check failed for ${this.repository}: ${error.message}`);
      this.cache = { channel, updates: [], timestamp: Date.now(), checkedAt: nowIso() };
      atomicJson(this.stateFile, { ...this.cache, error: this.lastError });
      // The physical configurator treats any non-2xx response as a fatal UI
      // error. Return an empty result with diagnostic metadata instead so an
      // unavailable GitHub repository does not break Settings → Software Update.
      return this.#response([], this.lastError);
    }
  }

  progress(updateId) {
    const current = this.progressState.get(String(updateId));
    if (current) return { ...current };
    const update = this.cache?.updates?.find((item) => item.id === updateId);
    if (!update) return null;
    return { state: fs.existsSync(this.#downloadPath(update)) ? "DONE" : "IDLE", update_id: update.id };
  }

  async action(updateId) {
    await this.check(false);
    const update = this.cache?.updates?.find((item) => item.id === updateId);
    if (!update) throw Object.assign(new Error(`Unknown software update ${updateId}`), { status: 404 });
    if (this.tasks.has(updateId)) {
      const task = this.tasks.get(updateId);
      return { code: "OK", action: task.action, state: task.action === "INSTALL" ? "START" : "DOWNLOAD", update_id: updateId };
    }
    const downloaded = this.#downloadPath(update);
    if (!fs.existsSync(downloaded)) {
      const task = { action: "DOWNLOAD" };
      this.tasks.set(updateId, task);
      this.#download(update, downloaded).finally(() => this.tasks.delete(updateId));
      return { code: "OK", action: "DOWNLOAD", state: "DOWNLOAD", update_id: updateId };
    }
    const task = { action: "INSTALL" };
    this.tasks.set(updateId, task);
    this.#install(update, downloaded).finally(() => this.tasks.delete(updateId));
    return { code: "OK", action: "INSTALL", state: "START", update_id: updateId };
  }

  #headers(accept = "application/vnd.github+json") {
    return {
      Accept: accept,
      "User-Agent": `uc-virtual-remote/${this.platform.version}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(process.env.UCVR_GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.UCVR_GITHUB_TOKEN}` } : {})
    };
  }

  async #stableUpdate() {
    const release = await fetchJson(`${this.apiBase}/repos/${this.repository}/releases/latest`, this.#headers());
    const version = normalizedVersion(release.tag_name || release.name);
    const active = this.activeRelease();
    if (!version || (!newerVersion(version, this.platform.version) && active?.channel !== "TESTING")) return null;
    const archive = chooseReleaseArchive(release);
    if (!archive) throw new Error("Latest GitHub release has no downloadable ZIP archive");
    return {
      id: safeUpdateId(`release-${release.id || version}`),
      version,
      description: localized(release.body || `UC Virtual Remote ${version}`),
      title: localized(release.name || `UC Virtual Remote ${version}`),
      release_date: release.published_at || release.created_at || null,
      archive_url: archive.url,
      archive_accept: archive.accept,
      archive_type: archive.type,
      archive_name: archive.name,
      channel: "DEFAULT",
      source: "GITHUB_RELEASE",
      release_id: release.id || null,
      commit: release.target_commitish || null,
      html_url: release.html_url || null
    };
  }

  async #testingUpdate() {
    const branch = process.env.UCVR_UPDATE_BRANCH || "main";
    const commit = await fetchJson(`${this.apiBase}/repos/${this.repository}/commits/${encodeURIComponent(branch)}`, this.#headers());
    const sha = String(commit.sha || "");
    if (!sha) throw new Error("GitHub commit response did not include a SHA");
    const active = this.activeRelease();
    if (active?.channel === "TESTING" && active?.commit === sha) return null;
    return {
      id: safeUpdateId(`commit-${sha}`),
      version: `${normalizedVersion(this.platform.version).split("-")[0]}-beta.${sha.slice(0, 7)}`,
      description: localized(commit.commit?.message || `Latest ${branch} commit ${sha.slice(0, 7)}`),
      title: localized(`Development build ${sha.slice(0, 7)}`),
      release_date: commit.commit?.committer?.date || commit.commit?.author?.date || null,
      archive_url: `${this.apiBase}/repos/${this.repository}/zipball/${encodeURIComponent(sha)}`,
      archive_accept: "application/vnd.github+json",
      archive_type: "GITHUB_COMMIT_SOURCE_ARCHIVE",
      archive_name: null,
      channel: "TESTING",
      source: "GITHUB_COMMIT",
      commit: sha,
      branch,
      html_url: commit.html_url || null
    };
  }

  #response(updates, error = null) {
    const checkedAt = this.cache?.checkedAt || nowIso();
    const softwareUpdate = this.platform.configuration.get("software_update");
    return {
      update_in_progress: this.tasks.size > 0,
      update_check_enabled: Boolean(softwareUpdate.check_for_updates),
      installed_version: this.platform.version,
      available: updates.map((item) => this.#publicUpdate(this.#withDownloadState(item))),
      last_check_date: checkedAt,
      next_check_date: new Date(Date.parse(checkedAt) + CACHE_MS).toISOString(),
      channel: this.channel(),
      repository: this.repository,
      checked_at: checkedAt,
      ...(error ? { check_error: error } : {})
    };
  }

  #publicUpdate(update) {
    const title = typeof update.title === "object" ? (update.title.en || Object.values(update.title)[0] || update.version) : String(update.title || update.version);
    return {
      id: update.id,
      version: update.version,
      title,
      description: typeof update.description === "object" ? update.description : localized(update.description),
      release_date: String(update.release_date || nowIso()).slice(0, 10),
      size: Number(update.archive_size || 0),
      ...(update.html_url ? { release_notes_url: update.html_url } : {}),
      download: update.download,
      channel: update.channel === "DEFAULT" ? "STABLE" : update.channel,
      source: update.source
    };
  }

  #withDownloadState(update) {
    return { ...update, download: fs.existsSync(this.#downloadPath(update)) ? "DOWNLOADED" : "PENDING" };
  }

  #downloadPath(update) {
    return path.join(this.downloadDir, `${safeUpdateId(update.id)}.zip`);
  }

  #publish(progress, eventType = "PROGRESS") {
    if (progress?.update_id) this.progressState.set(String(progress.update_id), { ...progress });
    this.platform.events.publish("software.update", { event_type: eventType, progress });
  }

  async #download(update, target) {
    const temporary = `${target}.part-${process.pid}`;
    try {
      this.#publish({ state: "DOWNLOAD", update_id: update.id, download_percent: 0 }, "START");
      const response = await fetch(update.archive_url, {
        headers: this.#headers(update.archive_accept || "application/vnd.github+json"),
        redirect: "follow"
      });
      if (!response.ok) throw await githubRequestError(response, "Update download");
      if (!response.body) throw new Error("Update download returned no response body");
      const total = Number(response.headers.get("content-length") || 0);
      const file = fs.createWriteStream(temporary, { flags: "w" });
      let received = 0;
      let lastPercent = -1;
      for await (const chunk of response.body) {
        await new Promise((resolve, reject) => file.write(chunk, (error) => error ? reject(error) : resolve()));
        received += chunk.length;
        const percent = total > 0 ? Math.min(99, Math.floor(received * 100 / total)) : Math.min(99, Math.floor(received / (1024 * 1024)));
        if (percent !== lastPercent) {
          lastPercent = percent;
          this.#publish({ state: "DOWNLOAD", update_id: update.id, download_percent: percent });
        }
      }
      await new Promise((resolve, reject) => file.end((error) => error ? reject(error) : resolve()));
      fs.renameSync(temporary, target);
      this.cache = this.cache ? { ...this.cache, updates: this.cache.updates.map((item) => item.id === update.id ? this.#withDownloadState(item) : item) } : this.cache;
      this.#publish({ state: "DOWNLOAD", update_id: update.id, download_percent: 100 });
      this.#publish({ state: "SUCCESS", update_id: update.id });
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      this.#publish({ state: "FAILURE", update_id: update.id, error: error.message });
      log.error(`Update download failed: ${error.message}`);
    }
  }

  async #install(update, archive) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ucvr-application-update-"));
    try {
      this.#publish({ state: "START", update_id: update.id }, "START");
      extractZip(archive, temporary, { maximumUncompressedBytes: 1024 * 1024 * 1024 });
      const root = findDirectory(temporary, (_directory, entries) => {
        const names = new Set(entries.map((entry) => entry.name));
        return names.has("package.json") && names.has("src") && names.has("public");
      });
      if (!root || !fs.existsSync(path.join(root, "src", "index.js"))) {
        throw new Error("Downloaded archive is not a UC Virtual Remote release");
      }
      const packageJson = readJson(path.join(root, "package.json"), {});
      if (packageJson.name !== "uc-virtual-remote") throw new Error("Downloaded archive has an unexpected package name");
      const packageVersion = normalizedVersion(packageJson.version);
      if (!packageVersion) throw new Error("Downloaded archive has no valid application version");
      if (update.channel === "DEFAULT" && packageVersion !== normalizedVersion(update.version)) {
        throw new Error(`Downloaded archive version ${packageVersion} does not match update ${normalizedVersion(update.version)}`);
      }
      const fingerprint = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex").slice(0, 16);
      const releaseId = safeUpdateId(`${update.id}-${fingerprint}`);
      const destination = path.join(this.releaseDir, releaseId);
      const staging = `${destination}.staging-${process.pid}`;
      fs.rmSync(staging, { recursive: true, force: true });
      fs.cpSync(root, staging, { recursive: true });
      fs.rmSync(destination, { recursive: true, force: true });
      fs.renameSync(staging, destination);
      const metadata = {
        id: update.id,
        version: packageVersion,
        channel: update.channel,
        source: update.source,
        repository: this.repository,
        commit: update.commit || null,
        path: destination,
        archive_sha256: crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex"),
        installed_at: nowIso()
      };
      atomicJson(this.activeFile, metadata);
      this.#publish({ state: "PROGRESS", update_id: update.id, progress_percent: 100 });
      this.#publish({ state: "DONE", update_id: update.id });
      if (process.env.UCVR_DISABLE_RESTART !== "1") {
        setTimeout(() => {
          log.info(`Restarting to activate software update ${update.id}`);
          try {
            this.platform.events.publish("system.restart", { reason: "software_update", exit_code: 75 });
          } catch (error) {
            log.error(`Unable to publish software-update restart event: ${error.message}`);
            process.exit(75);
          }
        }, 500);
      }
    } catch (error) {
      this.#publish({ state: "FAILURE", update_id: update.id, error: error.message });
      log.error(`Update installation failed: ${error.message}`);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
}
