import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { logger } from "../shared/logger.js";
import { runProcess } from "../shared/process.js";

const log = logger("external-integrations");
const DEFAULT_REGISTRY_URL = "https://raw.githubusercontent.com/JackJPowell/uc-intg-list/refs/heads/main/registry.json";
const LABEL_MANAGED = "ucvr.external-integration";
const LABEL_DRIVER = "ucvr.integration.driver-id";
const LABEL_REGISTRY = "ucvr.integration.registry-id";
const LABEL_NAME = "ucvr.integration.name";
const LABEL_PORT = "ucvr.integration.port";
const MAX_SETUP_OUTPUT_CHARS = 120_000;

function setupJobPublic(job) {
  const state = job.state === "success" ? "OK" : job.state === "error" ? "ERROR" : job.state === "cancelled" ? "CANCELLED" : job.state === "waiting" ? "WAIT_USER_ACTION" : "SETUP";
  return {
    driver_id: job.driverId,
    state,
    event_type: ["OK", "ERROR", "CANCELLED"].includes(state) ? "STOP" : "START",
    job_id: job.id,
    phase: job.phase,
    progress: Math.max(0, Math.min(100, Number(job.progress || 0))),
    message: job.message || "Setting up integration",
    source: job.source,
    output: String(job.output || ""),
    started_at: job.startedAt,
    updated_at: job.updatedAt || job.startedAt,
    ...(job.state === "error" ? { error: job.message } : {})
  };
}

const OFFICIAL_PROFILES = {
  "uc-intg-hass": { driver_id: "hass_external", skip_repo_dockerfile: true, patch_driver_metadata: true, websocket_path: "/ws" },
  "uc-intg-denonavr": { driver_id: "denonavr_external", python_image: "python:3.11-slim", python_entrypoint: "intg-denonavr/driver.py", patch_driver_metadata: true },
  "uc-intg-androidtv": { driver_id: "androidtv_external", python_image: "python:3.11-slim", python_entrypoint: "src/driver.py", patch_driver_metadata: true, environment: { UC_DATA_HOME: "/data" } },
  "uc-intg-appletv": { driver_id: "appletv_external", python_image: "python:3.11-slim", python_entrypoint: "intg-appletv/driver.py", patch_driver_metadata: true },
  "integration-globalcache": { driver_id: "uc_gc_external_driver", patch_driver_metadata: true },
  "integration-roon": { driver_id: "uc_roon_external_driver", patch_driver_metadata: true }
};
const OFFICIAL_PROFILE_BY_REPOSITORY = {
  "unfoldedcircle/integration-home-assistant": "uc-intg-hass",
  "unfoldedcircle/integration-denonavr": "uc-intg-denonavr",
  "unfoldedcircle/integration-androidtv": "uc-intg-androidtv",
  "unfoldedcircle/integration-appletv": "uc-intg-appletv",
  "unfoldedcircle/integration-globalcache": "integration-globalcache",
  "unfoldedcircle/integration-roon": "integration-roon"
};

function safeJson(filename, fallback) {
  try { return JSON.parse(fs.readFileSync(filename, "utf8")); }
  catch { return structuredClone(fallback); }
}

function atomicJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temp = `${filename}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, filename);
}

function writableDirectory(filename) {
  fs.mkdirSync(filename, { recursive: true });
  try { fs.chmodSync(filename, 0o777); } catch {}
  return filename;
}

function slug(value) {
  return String(value || "integration").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 52) || "integration";
}

export function uniqueDockerMounts(mounts = []) {
  const unique = new Map();
  for (const mount of mounts) {
    const target = String(mount?.target || "");
    if (!target.startsWith("/") || unique.has(target)) continue;
    unique.set(target, { ...mount, target });
  }
  return [...unique.values()];
}

function registryUrlList(value) {
  const input = Array.isArray(value) ? value : String(value || "").split(/[\n,]+/);
  return [...new Set(input.map((item) => String(item || "").trim()).filter((item) => {
    try { return ["http:", "https:"].includes(new URL(item).protocol); }
    catch { return false; }
  }))];
}

function entryImage(entry) {
  return String(entry?.external_runtime?.docker_image || entry?.docker_image || "").trim();
}

function registryEntryKey(entry) {
  const driver = String(runtimeProfile(entry).driver_id || entry?.driver_id || entry?.id || "").trim().toLowerCase();
  if (driver) return `driver:${driver}`;
  const repository = String(entry?.repository || "").trim().replace(/\.git$/i, "").toLowerCase();
  if (repository) return `repository:${repository}`;
  const image = entryImage(entry).toLowerCase();
  return image ? `image:${image}` : `id:${String(entry?.id || "").toLowerCase()}`;
}

function normalizeGhcrImage(value) {
  const image = String(value || "").trim();
  if (!/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_./-]+(?::[A-Za-z0-9_.-]+|@sha256:[0-9a-f]{64})?$/i.test(image)) {
    throw Object.assign(new Error("Enter a valid ghcr.io image such as ghcr.io/owner/integration:latest"), { status: 422 });
  }
  const lastSlash = image.lastIndexOf("/");
  const tail = image.slice(lastSlash + 1);
  return tail.includes(":") || image.includes("@sha256:") ? image : `${image}:{version}`;
}

function customGhcrEntry(input = {}) {
  const image = normalizeGhcrImage(input.image || input.docker_image);
  const driverId = String(input.driver_id || input.id || "").trim();
  if (!driverId) throw Object.assign(new Error("A driver ID is required for a custom GHCR integration"), { status: 422 });
  const id = slug(input.id || `ghcr-${driverId}`);
  const websocketPath = normalizedWebSocketPath(input.websocket_path || input.ws_path || "/intg") || "/intg";
  return {
    id,
    driver_id: driverId,
    name: String(input.name || driverId).trim() || driverId,
    description: String(input.description || `Custom integration image ${image.replace("{version}", String(input.version || "latest"))}`),
    author: String(input.author || "Custom GHCR image"),
    version: String(input.version || "latest").trim() || "latest",
    docker_image: image,
    registry_source: "ghcr",
    custom_image: true,
    external_runtime: {
      driver_id: driverId,
      docker_image: image,
      prebuilt_standalone: true,
      websocket_path: websocketPath,
      environment: input.environment && typeof input.environment === "object" && !Array.isArray(input.environment) ? input.environment : {}
    }
  };
}

function dedupeRegistryEntries(entries) {
  const result = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || !entry.id || (!entry.repository && !entryImage(entry))) continue;
    const key = registryEntryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function ownerRepo(repository) {
  const match = String(repository || "").trim().match(/^https?:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?(?:[#/].*)?$/i);
  return match ? { owner: match[1], repo: match[2] } : null;
}

function runtimeProfile(entry) {
  const repository = ownerRepo(entry?.repository);
  const repoKey = repository ? `${repository.owner}/${repository.repo}`.toLowerCase() : "";
  const profileId = OFFICIAL_PROFILES[entry?.id] ? entry.id : OFFICIAL_PROFILE_BY_REPOSITORY[repoKey];
  const builtin = OFFICIAL_PROFILES[profileId] || {};
  const base = { ...builtin };
  const supplied = entry?.external_runtime;
  if (supplied && typeof supplied === "object" && !Array.isArray(supplied)) Object.assign(base, supplied);
  base.environment = { ...(builtin.environment || {}), ...(supplied?.environment || {}) };
  if (entry?.official || profileId) {
    base.environment.UC_DISABLE_MDNS_PUBLISH ||= "true";
    base.driver_id ||= `${entry?.driver_id || entry?.id || "official"}_external`;
    base.patch_driver_metadata ??= true;
  }
  return base;
}

function normalizedWebSocketPath(value) {
  const pathValue = String(value || "").trim();
  if (!pathValue || pathValue === "/") return "";
  return `/${pathValue.replace(/^\/+|\/+$/g, "")}`;
}

function integrationWebSocketPath(entryOrRecord) {
  if (!entryOrRecord || typeof entryOrRecord !== "object") return "";
  if (entryOrRecord.repository || entryOrRecord.external_runtime) {
    return normalizedWebSocketPath(runtimeProfile(entryOrRecord).websocket_path);
  }
  return normalizedWebSocketPath(
    entryOrRecord.websocket_path
    || OFFICIAL_PROFILES[String(entryOrRecord.registry_id || "")]?.websocket_path
  );
}

export function integrationWebSocketUrl(host, port, entryOrRecord) {
  return `ws://${host}:${port}${integrationWebSocketPath(entryOrRecord)}`;
}

function baseDriverId(entry) {
  return String(runtimeProfile(entry).driver_id || entry?.driver_id || entry?.id || "integration");
}

function registryDriver(entry, installed = null) {
  const driverId = baseDriverId(entry);
  const developerUrl = ownerRepo(entry.repository)
    ? `https://github.com/${ownerRepo(entry.repository).owner}`
    : entry.repository;
  return {
    driver_id: driverId,
    name: { en: String(entry.name || driverId) },
    driver_type: "EXTERNAL",
    driver_url: installed?.url || null,
    auth_method: "NONE",
    version: installed?.driver_version || String(entry.version || "latest"),
    icon: entry.icon ? (String(entry.icon).includes(":") ? entry.icon : `uc:${entry.icon}`) : "uc:puzzle",
    enabled: true,
    description: { en: String(entry.description || `Install ${entry.name || driverId} from the community integration registry.`) },
    developer: { name: String(entry.author || "Community developer"), ...(developerUrl ? { url: developerUrl } : {}) },
    home_page: entry.repository || undefined,
    device_discovery: false,
    instance_count: installed ? 1 : 0,
    has_instances: Boolean(installed),
    driver_state: installed?.status === "CONNECTED" ? "RUNNING" : installed ? "STOPPED" : "AVAILABLE",
    registry_id: entry.id,
    registry_managed: true,
    setup_data_schema: installed?.metadata?.setup_data_schema || {
      title: { en: `Install ${entry.name || driverId}` },
      settings: [
        {
          id: "ucvr_install_notice",
          label: { en: "Container installation" },
          field: { label: { value: { en: "UC Virtual Remote will pull a prebuilt image when available, otherwise clone and build the integration source. The resulting container is started with host networking and registered automatically." } } }
        },
        {
          id: "ucvr_install_source",
          label: { en: "Installation source" },
          field: { dropdown: { value: "auto", items: [
            { id: "auto", label: { en: "Automatic: image, then source build" } },
            { id: "image", label: { en: "Prebuilt container image only" } },
            { id: "build", label: { en: "Build from source" } }
          ] } }
        },
        {
          id: "ucvr_install_version",
          label: { en: "Image tag or Git reference" },
          description: { en: "Use latest for the newest image/default branch, or enter a release tag, branch, or commit." },
          field: { text: { value: "latest" } }
        }
      ]
    }
  };
}

function splitLines(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
}

function escapeDockerLabel(value) {
  return String(value || "").replace(/[\r\n]/g, " ").slice(0, 240);
}

function dockerImage(entry, version) {
  const profile = runtimeProfile(entry);
  const configured = profile.docker_image || entry.docker_image;
  if (configured) {
    if (profile.patch_driver_metadata && !profile.prebuilt_standalone) return null;
    return String(configured).replaceAll("{version}", version || "latest");
  }
  if (entry.official || profile.patch_driver_metadata || profile.skip_prebuilt) return null;
  const repo = ownerRepo(entry.repository);
  return repo ? `ghcr.io/${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}:${version || "latest"}` : null;
}

function findFile(root, candidates) {
  for (const candidate of candidates) {
    const filename = path.join(root, candidate);
    if (fs.existsSync(filename) && fs.statSync(filename).isFile()) return candidate;
  }
  return null;
}

function walk(root, maximum = 5000) {
  const result = [];
  const stack = [root];
  while (stack.length && result.length < maximum) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if ([".git", "node_modules", ".venv", "venv", "target", "dist", "build"].includes(entry.name)) continue;
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(filename);
      else if (entry.isFile()) result.push(path.relative(root, filename));
    }
  }
  return result;
}

function detectStack(root, profile) {
  if (profile.python_entrypoint || fs.existsSync(path.join(root, "requirements.txt")) || fs.existsSync(path.join(root, "pyproject.toml")) || fs.existsSync(path.join(root, "setup.py"))) return "python";
  if (fs.existsSync(path.join(root, "package.json"))) return "node";
  if (fs.existsSync(path.join(root, "go.mod"))) return "go";
  if (fs.existsSync(path.join(root, "Cargo.toml"))) return "rust";
  if (walk(root).some((item) => item.endsWith(".csproj"))) return "dotnet";
  return "unknown";
}

function pythonEntrypoint(root, profile) {
  if (profile.python_entrypoint && fs.existsSync(path.join(root, profile.python_entrypoint))) return profile.python_entrypoint;
  const direct = findFile(root, ["driver.py", "src/driver.py", "main.py", "src/main.py"]);
  if (direct) return direct;
  return walk(root).find((item) => /(^|\/)driver\.py$/i.test(item)) || walk(root).find((item) => /(^|\/)main\.py$/i.test(item)) || null;
}

export function generatedDockerfile(root, entry, profile, stack) {
  if (stack === "python") {
    const python = profile.python_image || "python:3.12-slim";
    const entrypoint = pythonEntrypoint(root, profile);
    if (!entrypoint) throw new Error("Python integration entrypoint could not be detected");
    const install = fs.existsSync(path.join(root, "requirements.txt"))
      ? "RUN pip install --no-cache-dir -r requirements.txt"
      : fs.existsSync(path.join(root, "pyproject.toml")) || fs.existsSync(path.join(root, "setup.py"))
        ? "RUN pip install --no-cache-dir ."
        : "";
    return `FROM ${python}\nENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1\nWORKDIR /app\nRUN apt-get update && apt-get install -y --no-install-recommends git gcc libc6-dev libffi-dev libssl-dev && rm -rf /var/lib/apt/lists/*\nCOPY . .\n${install}\nCMD [\"python\", ${JSON.stringify(entrypoint)}]\n`;
  }
  if (stack === "node") {
    const pkg = safeJson(path.join(root, "package.json"), {});
    const start = profile.command || (pkg.scripts?.start ? "npm start" : findFile(root, ["src/driver.js", "driver.js", "src/index.js", "index.js"]) ? `node ${findFile(root, ["src/driver.js", "driver.js", "src/index.js", "index.js"])}` : null);
    if (!start) throw new Error("Node integration start command could not be detected");
    // A number of community integrations compile TypeScript from their start
    // script. Keep dev dependencies in generated images so tools such as tsc
    // remain available at runtime. NODE_ENV is intentionally set afterwards:
    // npm otherwise silently omits dev dependencies during installation.
    return `FROM node:22-bookworm-slim\nWORKDIR /app\nCOPY package*.json ./\nRUN if [ -f package-lock.json ]; then npm ci --include=dev; else npm install --include=dev; fi\nCOPY . .\nENV NODE_ENV=production\nCMD [\"sh\",\"-lc\",${JSON.stringify(start)}]\n`;
  }
  if (stack === "go") return "FROM golang:1.24-bookworm AS build\nWORKDIR /src\nCOPY . .\nRUN go build -o /out/driver . || go build -o /out/driver ./...\nFROM debian:bookworm-slim\nRUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && update-ca-certificates && rm -rf /var/lib/apt/lists/*\nCOPY --from=build /out/driver /usr/local/bin/driver\nCMD [\"/usr/local/bin/driver\"]\n";
  if (stack === "rust") return `FROM rust:1-bookworm AS build
WORKDIR /src
COPY . .
RUN set -eux; \
    cargo build --release; \
    package_name="$(awk -F'"' '/^name =/{print $2; exit}' Cargo.toml)"; \
    binary_name="$(awk -F'"' 'BEGIN{in_bin=0} /^\\[\\[bin\\]\\]/{in_bin=1; next} in_bin && /^name =/{print $2; exit}' Cargo.toml)"; \
    [ -n "$binary_name" ] || binary_name="$package_name"; \
    normalized_name="$(printf '%s' "$binary_name" | tr '-' '_')"; \
    candidate=""; \
    if [ -x "target/release/$binary_name" ]; then candidate="target/release/$binary_name"; \
    elif [ -x "target/release/$normalized_name" ]; then candidate="target/release/$normalized_name"; \
    else candidate="$(find target/release -maxdepth 1 -type f -perm -111 ! -name '*.d' ! -name '*.so' | head -n 1)"; fi; \
    [ -n "$candidate" ] && [ -x "$candidate" ]; \
    cp "$candidate" /out
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && update-ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /out /usr/local/bin/driver
CMD ["/usr/local/bin/driver"]
`;
  if (stack === "dotnet") {
    const project = walk(root).find((item) => item.endsWith(".csproj"));
    if (!project) throw new Error(".NET project could not be detected");
    return `FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build\nWORKDIR /src\nCOPY . .\nRUN dotnet publish ${JSON.stringify(project)} -c Release -o /out\nFROM mcr.microsoft.com/dotnet/runtime:9.0\nWORKDIR /app\nCOPY --from=build /out .\nCMD [\"sh\",\"-lc\",\"dotnet $(find . -maxdepth 1 -name '*.dll' | head -1)\"]\n`;
  }
  throw new Error("No Dockerfile or supported source stack was detected");
}

async function portAvailable(host, port) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (available) => { socket.destroy(); resolve(available); };
    socket.setTimeout(400, () => done(true));
    socket.once("connect", () => done(false));
    socket.once("error", () => done(true));
  });
}

async function waitForPort(host, port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      const done = (value) => { socket.destroy(); resolve(value); };
      socket.setTimeout(500, () => done(false));
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });
    if (connected) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

export class ExternalIntegrationService {
  constructor(platform, options = {}) {
    this.platform = platform;
    this.runner = options.runner || runProcess;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.portStart = Math.max(1024, Number(options.portStart || process.env.UCVR_INTEGRATION_PORT_START || 11091));
    this.integrationHost = options.integrationHost || process.env.UCVR_INTEGRATION_HOST || "127.0.0.1";
    this.hostDataDir = options.hostDataDir || process.env.UCVR_HOST_DATA_DIR || null;
    this.root = path.join(platform.dataDir, "external-integrations");
    this.registryCachePath = path.join(this.root, "registry.json");
    this.registrySourcesCachePath = path.join(this.root, "registry-sources-cache.json");
    this.sourcesPath = path.join(this.root, "sources.json");
    this.statePath = path.join(this.root, "state.json");
    this.appsDir = path.join(this.root, "apps");
    this.configDir = path.join(this.root, "config");
    this.runtimeDataDir = path.join(this.root, "data");
    this.registryCache = null;
    this.registryFetchedAt = 0;
    this.registryFailed = false;
    this.jobs = new Map();
    this.updateJobs = new Map();
    this.updateCache = { checkedAt: 0, items: [] };
    this.updatePromise = null;
    this.eventListener = null;
    this.state = safeJson(this.statePath, { version: 1, integrations: {} });
    const savedSources = safeJson(this.sourcesPath, { version: 1, registries: [], ghcr: [] });
    const configuredRegistries = options.registryUrls
      || options.registryUrl
      || process.env.UCVR_INTEGRATION_REGISTRY_URLS
      || process.env.UCVR_INTEGRATION_REGISTRY_URL
      || savedSources.registries;
    this.registryUrls = registryUrlList(configuredRegistries);
    if (!this.registryUrls.length) this.registryUrls = [DEFAULT_REGISTRY_URL];
    this.registryUrl = this.registryUrls[0];
    this.customImages = Array.isArray(savedSources.ghcr)
      ? savedSources.ghcr.map((entry) => { try { return customGhcrEntry(entry); } catch { return null; } }).filter(Boolean)
      : [];
    this.registrySourceErrors = [];
    for (const directory of [this.root, this.appsDir, this.configDir, this.runtimeDataDir]) fs.mkdirSync(directory, { recursive: true });
    this.#saveSources();
  }

  async start() {
    log.info(`Registry-backed integration manager enabled: ${this.registryUrls.join(", ")}`);
    this.eventListener = (event) => {
      const driverId = String(event?.data?.driver_id || event?.data?.id || "");
      const job = this.jobs.get(driverId);
      if (!job || !["OK", "ERROR"].includes(String(event?.data?.state || ""))) return;
      job.state = event.data.state === "OK" ? "success" : "error";
      job.phase = "complete";
      job.progress = event.data.state === "OK" ? 100 : job.progress;
      job.message = event.data.state === "OK" ? "Integration configured" : String(event.data.error || "Integration setup failed");
      job.updatedAt = new Date().toISOString();
    };
    this.platform.events.on("integration.setup", this.eventListener);
    try {
      const version = await this.#docker(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 5000 });
      log.info(`Docker daemon available, server ${version.stdout.trim() || "unknown"}`);
      this.hostDataDir ||= await this.#detectHostDataDir();
      log.info(`Managed integration persistence mapped to host path ${this.hostDataDir}`);
      await this.#reconcile();
      this.#repairManagedIntegrationUrls();
    } catch (error) {
      log.warn("Docker management is unavailable:", error.message);
    }
    this.fetchRegistry().then((registry) => {
      log.info(`Integration registry loaded: ${registry.integrations.length} entries`);
      this.updates(true).catch((error) => log.debug("Initial managed integration update check failed:", error.message));
    }).catch((error) => log.warn("Initial integration registry refresh failed:", error.message));
  }

  async stop() {
    for (const job of this.jobs.values()) job.controller.abort();
    for (const job of this.updateJobs.values()) job.controller.abort();
    await Promise.allSettled([...this.jobs.values()].map((job) => job.promise));
    await Promise.allSettled([...this.updateJobs.values()].map((job) => job.promise));
    this.jobs.clear();
    this.updateJobs.clear();
    if (this.eventListener) this.platform.events.off("integration.setup", this.eventListener);
    this.eventListener = null;
  }

  status() {
    return {
      registry_url: this.registryUrl,
      registry_urls: [...this.registryUrls],
      custom_images: this.customImages.length,
      registry_errors: structuredClone(this.registrySourceErrors),
      cached_entries: Number(this.registryCache?.integrations?.length || 0),
      managed_instances: Object.keys(this.state.integrations || {}).length,
      active_jobs: [...this.jobs.values()].filter((item) => !["success", "error", "cancelled"].includes(item.state)).length,
      active_updates: this.updateJobs.size,
      updates_available: this.updateCache.items.filter((item) => item.update_available).length,
      host_data_dir: this.hostDataDir || null
    };
  }

  #saveSources() {
    atomicJson(this.sourcesPath, {
      version: 1,
      registries: [...this.registryUrls],
      ghcr: this.customImages.map((entry) => ({
        id: entry.id,
        driver_id: entry.driver_id,
        name: entry.name,
        description: entry.description,
        author: entry.author,
        version: entry.version,
        image: entry.docker_image,
        websocket_path: entry.external_runtime?.websocket_path || "/intg",
        environment: entry.external_runtime?.environment || {}
      }))
    });
  }

  sourceSettings() {
    return {
      registries: [...this.registryUrls],
      ghcr: structuredClone(this.customImages),
      status: this.status()
    };
  }

  async setRegistryUrls(values) {
    const registries = registryUrlList(values);
    if (!registries.length) throw Object.assign(new Error("At least one valid HTTP or HTTPS registry URL is required"), { status: 422 });
    this.registryUrls = registries;
    this.registryUrl = registries[0];
    this.registryCache = null;
    this.registryFetchedAt = 0;
    this.#saveSources();
    const registry = await this.fetchRegistry(true);
    this.invalidateUpdateCache();
    return { ...this.sourceSettings(), entries: registry.integrations.length };
  }

  async addGhcrIntegration(input = {}) {
    const entry = customGhcrEntry(input);
    const key = registryEntryKey(entry);
    this.customImages = this.customImages.filter((candidate) => candidate.id !== entry.id && registryEntryKey(candidate) !== key);
    this.customImages.push(entry);
    this.registryCache = null;
    this.registryFetchedAt = 0;
    this.#saveSources();
    this.invalidateUpdateCache();
    return structuredClone(entry);
  }

  removeGhcrIntegration(id) {
    const key = String(id || "");
    const previous = this.customImages.length;
    this.customImages = this.customImages.filter((entry) => entry.id !== key && entry.driver_id !== key);
    if (this.customImages.length === previous) return false;
    this.registryCache = null;
    this.registryFetchedAt = 0;
    this.#saveSources();
    this.invalidateUpdateCache();
    return true;
  }

  async fetchRegistry(force = false) {
    const cacheTtl = this.registryFailed ? 60_000 : 15 * 60_000;
    if (!force && this.registryCache && Date.now() - this.registryFetchedAt < cacheTtl) return this.registryCache;
    const sourceCache = safeJson(this.registrySourcesCachePath, { version: 1, sources: {} });
    const merged = [];
    const errors = [];
    for (const registryUrl of this.registryUrls) {
      let data = null;
      try {
        if (!this.fetchImpl) throw new Error("fetch is unavailable");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        let response;
        try {
          response = await this.fetchImpl(registryUrl, {
            headers: { "User-Agent": `uc-virtual-remote/${this.platform.version}`, Accept: "application/json" },
            signal: controller.signal
          });
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) throw new Error(`registry returned HTTP ${response.status}`);
        data = await response.json();
        if (!Array.isArray(data?.integrations)) throw new Error("registry does not contain an integrations array");
        sourceCache.sources[registryUrl] = { fetched_at: new Date().toISOString(), data };
      } catch (error) {
        data = sourceCache.sources?.[registryUrl]?.data || null;
        errors.push({ url: registryUrl, error: error.message, cached: Boolean(data) });
        if (data) log.warn(`Using cached integration registry ${registryUrl} after refresh failure:`, error.message);
        else log.warn(`Integration registry ${registryUrl} is unavailable:`, error.message);
      }
      if (!Array.isArray(data?.integrations)) continue;
      for (const entry of data.integrations) merged.push({ ...entry, registry_source: registryUrl });
    }
    atomicJson(this.registrySourcesCachePath, sourceCache);
    const integrations = dedupeRegistryEntries([...merged, ...this.customImages]);
    if (!integrations.length && errors.length === this.registryUrls.length) {
      const legacy = safeJson(this.registryCachePath, null);
      if (Array.isArray(legacy?.integrations)) integrations.push(...dedupeRegistryEntries(legacy.integrations));
    }
    const data = { version: 2, registries: [...this.registryUrls], integrations };
    atomicJson(this.registryCachePath, data);
    this.registryCache = data;
    this.registryFetchedAt = Date.now();
    this.registryFailed = errors.length === this.registryUrls.length && !integrations.length;
    this.registrySourceErrors = errors;
    if (this.registryFailed) throw new Error(errors.map((item) => `${item.url}: ${item.error}`).join("; ") || "Integration registries are unavailable");
    return this.registryCache;
  }

  async entries() { return (await this.fetchRegistry()).integrations; }

  async findEntry(driverId) {
    const key = String(driverId);
    const custom = this.customImages.find((item) => baseDriverId(item) === key || String(item.driver_id || item.id) === key || String(item.id) === key);
    if (custom) return custom;
    try { return (await this.entries()).find((item) => baseDriverId(item) === key || String(item.driver_id || item.id) === key || String(item.id) === key) || null; }
    catch (error) { log.warn("Integration registry lookup failed:", error.message); return null; }
  }

  async drivers() {
    let entries = [];
    try { entries = await this.entries(); } catch (error) { log.warn("Integration registry is unavailable:", error.message); }

    return entries.map((entry) => {
      const driverId = baseDriverId(entry);
      const installed = this.platform.db.listIntegrations().find((item) => String(item.driver_id || item.id) === driverId) || null;
      return registryDriver(entry, installed);
    });
  }

  async driver(driverId) {
    const entry = await this.findEntry(driverId);
    if (!entry) return null;
    const installed = this.platform.db.listIntegrations().find((item) => String(item.driver_id || item.id) === baseDriverId(entry)) || null;
    return registryDriver(entry, installed);
  }

  invalidateUpdateCache() {
    this.updateCache = { checkedAt: 0, items: [] };
  }

  async updates(force = false) {
    const ttl = Math.max(30_000, Number(process.env.UCVR_INTEGRATION_UPDATE_CHECK_TTL_MS || 5 * 60_000));
    if (!force && this.updateCache.checkedAt && Date.now() - this.updateCache.checkedAt < ttl) {
      return structuredClone(this.updateCache.items);
    }
    if (this.updatePromise) return structuredClone(await this.updatePromise);
    this.updatePromise = this.#refreshUpdates().finally(() => { this.updatePromise = null; });
    return structuredClone(await this.updatePromise);
  }

  async updateInfo(idOrDriver, force = false) {
    const key = String(idOrDriver || "");
    return (await this.updates(force)).find((item) => item.driver_id === key || item.integration_id === key || item.registry_id === key) || null;
  }

  async #refreshUpdates() {
    let entries = [];
    try { entries = await this.entries(); } catch (error) { log.warn("Unable to refresh registry before integration update check:", error.message); }
    const entryById = new Map(entries.map((entry) => [String(entry.id), entry]));
    const entryByDriver = new Map(entries.map((entry) => [baseDriverId(entry), entry]));
    let stateChanged = false;
    const records = Object.values(this.state.integrations || {});
    const items = await Promise.all(records.map(async (record) => {
      const entry = entryById.get(String(record.registry_id)) || entryByDriver.get(String(record.driver_id)) || null;
      const checked = await this.#checkManagedUpdate(record, entry);
      if (!record.revision && checked.installed_ref && record.source === "build") {
        record.revision = checked.installed_ref;
        stateChanged = true;
      }
      if (!record.digest && checked.installed_ref && record.source === "image") {
        record.digest = checked.installed_ref;
        stateChanged = true;
      }
      return checked;
    }));
    if (stateChanged) atomicJson(this.statePath, this.state);
    this.updateCache = { checkedAt: Date.now(), items };
    return items;
  }

  async #checkManagedUpdate(record, entry) {
    const dbRecord = this.platform.db.listIntegrations().find((item) => String(item.driver_id || item.metadata?.driver_id || item.id) === String(record.driver_id)) || null;
    const base = {
      integration_id: dbRecord?.id || record.driver_id,
      driver_id: record.driver_id,
      registry_id: record.registry_id,
      name: { en: String(record.name || dbRecord?.name || record.driver_id) },
      source: record.source,
      current_version: dbRecord?.driver_version || record.version || "latest",
      installed_ref: null,
      available_ref: null,
      available_version: null,
      update_available: false,
      update_supported: false,
      checked_at: new Date().toISOString()
    };
    if (!entry) return { ...base, check_error: "Registry entry not found" };
    try {
      if (record.source === "build" && ownerRepo(entry.repository)) {
        const appDir = path.join(this.appsDir, slug(entry.id));
        const installed = record.revision || await this.#localRepositoryRevision(appDir);
        const available = await this.#remoteRepositoryRevision(entry.repository, record.version || "latest");
        return {
          ...base,
          installed_ref: installed,
          available_ref: available,
          available_version: available ? String(entry.version || available.slice(0, 12)) : null,
          update_available: Boolean(installed && available && installed !== available),
          update_supported: true
        };
      }
      if (record.source === "image" && record.image) {
        const installed = record.digest || await this.#localImageDigest(record.image);
        const available = await this.#remoteImageDigest(record.image);
        return {
          ...base,
          installed_ref: installed,
          available_ref: available,
          available_version: available ? String(entry.version || available.slice(0, 19)) : null,
          update_available: Boolean(installed && available && installed !== available),
          update_supported: true
        };
      }
      return { ...base, check_error: "Installed source cannot be checked automatically" };
    } catch (error) {
      return { ...base, update_supported: true, check_error: error.message };
    }
  }

  #gitAuth(repository) {
    const token = String(process.env.UCVR_GITHUB_TOKEN || "").trim();
    if (!token || !ownerRepo(repository)) return { args: [], redacted: [] };
    const header = `http.extraHeader=Authorization: Bearer ${token}`;
    return { args: ["-c", header], redacted: [header] };
  }

  async #localRepositoryRevision(appDir) {
    if (!fs.existsSync(path.join(appDir, ".git"))) return null;
    const result = await this.runner("git", ["-c", `safe.directory=${appDir}`, "-C", appDir, "rev-parse", "HEAD"], {
      timeoutMs: 10_000,
      rejectOnError: false
    });
    const revision = String(result.stdout || "").trim().match(/^[0-9a-f]{40}$/i)?.[0];
    return revision ? revision.toLowerCase() : null;
  }

  async #remoteRepositoryRevision(repository, version = "latest") {
    const auth = this.#gitAuth(repository);
    const ref = String(version || "latest").trim();
    const patterns = ref && ref !== "latest"
      ? [`refs/tags/${ref}^{}`, `refs/tags/${ref}`, `refs/heads/${ref}`]
      : ["HEAD"];
    const result = await this.runner("git", [...auth.args, "ls-remote", repository, ...patterns], {
      timeoutMs: 20_000,
      rejectOnError: false,
      redacted: auth.redacted,
      env: { GIT_TERMINAL_PROMPT: "0" }
    });
    if (result.code !== 0) throw new Error(String(result.stderr || result.stdout || "Unable to query repository").trim());
    const lines = String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const refs = lines.map((line) => {
      const [revision, name = ""] = line.split(/\s+/, 2);
      return { revision: /^[0-9a-f]{40}$/i.test(revision) ? revision.toLowerCase() : null, name };
    }).filter((item) => item.revision);
    if (!refs.length) return null;
    return (refs.find((item) => item.name.endsWith("^{}")) || refs.find((item) => item.name.includes("/tags/")) || refs[0]).revision;
  }

  async #localImageDigest(image) {
    const result = await this.#docker(["image", "inspect", "--format", "{{json .RepoDigests}}", image], { timeoutMs: 10_000, rejectOnError: false });
    const text = String(result.stdout || "").trim();
    try {
      const values = JSON.parse(text);
      const digest = Array.isArray(values) ? values.map(String).find((item) => item.includes("@sha256:"))?.split("@")[1] : null;
      if (digest) return digest;
    } catch {}
    return text.match(/sha256:[0-9a-f]{64}/i)?.[0]?.toLowerCase() || null;
  }

  async #remoteImageDigest(image) {
    let result = await this.#docker(["buildx", "imagetools", "inspect", image, "--format", "{{json .Manifest.Digest}}"], {
      timeoutMs: 30_000,
      rejectOnError: false
    });
    let digest = `${result.stdout || ""} ${result.stderr || ""}`.match(/sha256:[0-9a-f]{64}/i)?.[0]?.toLowerCase();
    if (digest) return digest;
    result = await this.#docker(["manifest", "inspect", "--verbose", image], { timeoutMs: 30_000, rejectOnError: false });
    digest = `${result.stdout || ""} ${result.stderr || ""}`.match(/sha256:[0-9a-f]{64}/i)?.[0]?.toLowerCase();
    return digest || null;
  }

  async update(idOrDriver) {
    const record = this.managedRecord(idOrDriver);
    if (!record) return null;
    const key = String(record.driver_id);
    if (this.updateJobs.has(key)) {
      const error = new Error(`Integration ${key} is already being updated`);
      error.status = 409;
      throw error;
    }
    const controller = new AbortController();
    const job = { controller, promise: null };
    job.promise = this.#performUpdate(record, controller).finally(() => this.updateJobs.delete(key));
    this.updateJobs.set(key, job);
    return job.promise;
  }

  async #performUpdate(record, controller) {
    const entry = await this.findEntry(record.driver_id);
    if (!entry) throw Object.assign(new Error(`Registry entry for ${record.driver_id} was not found`), { status: 404 });
    const dbRecord = this.platform.db.listIntegrations().find((item) => String(item.driver_id || item.metadata?.driver_id || item.id) === String(record.driver_id)) || null;
    const wasEnabled = dbRecord?.enabled !== false;
    if (dbRecord) await this.platform.integrations.disconnect(dbRecord.id).catch(() => {});
    const installJob = {
      registryId: entry.id,
      driverId: record.driver_id,
      source: record.source || "auto",
      version: record.version || "latest",
      controller
    };
    try {
      const resolved = await this.#install(entry, installJob, { port: record.port, installedAt: record.installed_at });
      if (dbRecord) {
        this.platform.db.updateIntegration(dbRecord.id, {
          url: integrationWebSocketUrl(this.integrationHost, resolved.port, entry),
          enabled: wasEnabled,
          last_error: null
        });
        if (wasEnabled) await this.platform.integrations.connect(dbRecord.id);
      }
      this.invalidateUpdateCache();
      const info = await this.updateInfo(record.driver_id, true);
      log.info(`Updated managed integration ${record.driver_id}${info?.current_version ? ` to ${info.current_version}` : ""}`);
      return info || { driver_id: record.driver_id, updated: true };
    } catch (error) {
      if (dbRecord && wasEnabled) await this.platform.integrations.connect(dbRecord.id).catch(() => {});
      throw error;
    }
  }

  job(driverId) { return this.jobs.get(String(driverId)) || null; }

  publicJob(driverIdOrJob) {
    const job = typeof driverIdOrJob === "string" ? this.job(driverIdOrJob) : driverIdOrJob;
    return job ? setupJobPublic(job) : null;
  }

  setupJobs() {
    return [...this.jobs.values()]
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
      .map(setupJobPublic);
  }

  async startSetup(driverId, setupData = {}) {
    const key = String(driverId);
    const existing = this.jobs.get(key);
    if (existing && !["success", "error", "cancelled"].includes(existing.state)) return setupJobPublic(existing);
    const entry = await this.findEntry(key);
    if (!entry) return null;
    const controller = new AbortController();
    const inputValues = setupData?.input_values || setupData?.inputValues || {};
    const source = ["auto", "image", "build"].includes(String(inputValues.ucvr_install_source || "auto")) ? String(inputValues.ucvr_install_source || "auto") : "auto";
    const version = String(inputValues.ucvr_install_version || "latest").trim() || "latest";
    const job = {
      id: `${key}-${Date.now()}`,
      driverId: key,
      registryId: entry.id,
      state: "queued",
      phase: "installing",
      message: "Queued for installation",
      startedAt: new Date().toISOString(),
      controller,
      setupData: { input_values: Object.fromEntries(Object.entries(inputValues).filter(([name]) => !name.startsWith("ucvr_"))) },
      source,
      version,
      recordId: null,
      progress: 0,
      output: "",
      updatedAt: new Date().toISOString(),
      promise: null
    };
    this.jobs.set(key, job);
    this.platform.events.publish("integration.setup", { driver_id: key, state: "SETUP", event_type: "START" });
    job.promise = this.#installAndStartSetup(entry, job).catch((error) => {
      if (controller.signal.aborted) {
        job.state = "cancelled";
        job.message = "Installation cancelled";
        job.updatedAt = new Date().toISOString();
        return;
      }
      job.state = "error";
      job.message = error.message;
      job.updatedAt = new Date().toISOString();
      log.error(`${key} installation failed:`, error);
      this.platform.events.publish("integration.setup", { driver_id: key, state: "ERROR", event_type: "STOP", error: error.message });
    });
    return setupJobPublic(job);
  }

  async continueSetup(driverId, input) {
    const job = this.jobs.get(String(driverId));
    if (!job || job.phase !== "awaiting_initial_setup" || !job.recordId) return false;
    job.phase = "driver_setup";
    job.state = "setting_up";
    job.progress = 98;
    job.message = "Starting integration setup";
    job.updatedAt = new Date().toISOString();
    await this.platform.integrations.startSetup(job.recordId, false, input || {});
    return true;
  }

  async cancelSetup(driverId) {
    const job = this.jobs.get(String(driverId));
    if (!job) return false;
    job.controller.abort();
    if (job.recordId) await this.platform.integrations.abortSetup(job.recordId).catch(() => {});
    job.state = "cancelled";
    job.message = "Cancelled";
    job.updatedAt = new Date().toISOString();
    return true;
  }

  async #installAndStartSetup(entry, job) {
    job.state = "installing";
    job.phase = "resolving";
    job.progress = 3;
    job.message = "Resolving container image";
    job.updatedAt = new Date().toISOString();
    const resolved = await this.#install(entry, job);
    job.recordId = resolved.driverId;
    job.state = "registering";
    job.phase = "registering";
    job.progress = 92;
    job.message = "Registering external integration";
    job.updatedAt = new Date().toISOString();
    const record = await this.platform.integrations.register({
      id: resolved.driverId,
      driver_id: resolved.driverId,
      name: entry.name || resolved.driverId,
      url: integrationWebSocketUrl(this.integrationHost, resolved.port, entry),
      enabled: true,
      configured: false,
      metadata: {
        driver_id: resolved.driverId,
        name: { en: entry.name || resolved.driverId },
        description: { en: entry.description || "" },
        developer: { name: entry.author || "Community developer", url: entry.repository },
        home_page: entry.repository,
        icon: entry.icon ? (String(entry.icon).includes(":") ? entry.icon : `uc:${entry.icon}`) : "uc:puzzle",
        registry_id: entry.id,
        registry_managed: true,
        managed_container: resolved.container
      }
    });
    const settings = record.metadata?.setup_data_schema?.settings;
    if (Array.isArray(settings) && settings.length) {
      job.phase = "awaiting_initial_setup";
      job.state = "waiting";
      job.progress = 97;
      job.message = "Waiting for integration setup details";
      job.updatedAt = new Date().toISOString();
      const requireUserAction = {
        input: {
          title: record.metadata.setup_data_schema.title || { en: `Configure ${entry.name || resolved.driverId}` },
          settings
        }
      };
      this.platform.db.updateIntegration(record.id, { setup_state: "WAIT_USER_ACTION", setup_action: requireUserAction });
      this.platform.events.publish("integration.setup", {
        driver_id: resolved.driverId,
        state: "WAIT_USER_ACTION",
        event_type: "SETUP",
        require_user_action: requireUserAction
      });
      return;
    }
    job.phase = "driver_setup";
    job.state = "setting_up";
    job.progress = 98;
    job.message = "Starting integration setup";
    job.updatedAt = new Date().toISOString();
    await this.platform.integrations.startSetup(record.id, false, job.setupData);
    job.state = "success";
    job.phase = "complete";
    job.progress = 100;
    job.message = "Integration configured";
    job.updatedAt = new Date().toISOString();
  }

  async #install(entry, job, options = {}) {
    const driverId = baseDriverId(entry);
    const container = `ucvr-intg-${slug(entry.id)}`;
    const existing = this.managedRecord(driverId);
    const requestedPort = Number(options.port || existing?.port || 0);
    const port = requestedPort > 0 ? requestedPort : await this.#nextPort();
    const profile = runtimeProfile(entry);
    let image = dockerImage(entry, job.version);
    let source = "image";
    if (job.source !== "build" && image) {
      try {
        job.phase = "pulling";
        job.progress = 10;
        job.message = "Pulling integration image";
        job.updatedAt = new Date().toISOString();
        await this.#jobCommand(job, process.env.UCVR_DOCKER_BIN || "docker", ["pull", image], { timeoutMs: 15 * 60_000 });
        job.progress = 72;
        job.updatedAt = new Date().toISOString();
      } catch (error) {
        if (job.source === "image") throw error;
        log.info(`${entry.id}: prebuilt image unavailable, falling back to source build`);
        image = null;
      }
    } else if (job.source === "image" && !image) {
      throw new Error("This registry entry does not provide a standalone prebuilt image");
    }
    let revision = null;
    let digest = null;
    if (!image) {
      source = "build";
      image = `ucvr/${slug(entry.id)}:${slug(job.version)}`;
      await this.#build(entry, image, job);
      revision = await this.#localRepositoryRevision(path.join(this.appsDir, slug(entry.id))).catch(() => null);
    } else {
      digest = await this.#localImageDigest(image).catch(() => null);
    }
    job.phase = "starting";
    job.progress = Math.max(86, Number(job.progress || 0));
    job.message = "Starting integration container";
    job.updatedAt = new Date().toISOString();
    await this.#removeContainer(container, false);
    const config = writableDirectory(path.join(this.configDir, container));
    const data = writableDirectory(path.join(this.runtimeDataDir, container));
    const hostConfig = this.#hostPath(config);
    const hostData = this.#hostPath(data);
    const environment = {
      UC_CONFIG_HOME: "/config",
      STATE_DIRECTORY: "/data",
      UC_DATA_HOME: "/data",
      UC_INTEGRATION_INTERFACE: "0.0.0.0",
      UC_INTEGRATION_HTTP_PORT: String(port),
      UC_DISABLE_MDNS_PUBLISH: "true",
      PYTHONUNBUFFERED: "1",
      ...(profile.environment || {})
    };
    const args = ["run", "-d", "--name", container, "--network", "host", "--restart", "unless-stopped",
      "--label", `${LABEL_MANAGED}=true`, "--label", `${LABEL_DRIVER}=${escapeDockerLabel(driverId)}`,
      "--label", `${LABEL_REGISTRY}=${escapeDockerLabel(entry.id)}`, "--label", `${LABEL_NAME}=${escapeDockerLabel(entry.name || driverId)}`,
      "--label", `${LABEL_PORT}=${port}`];
    for (const [key, value] of Object.entries(environment)) args.push("-e", `${key}=${value}`);
    const mountCandidates = [
      { host: hostConfig, target: "/config", mode: null },
      { host: hostData, target: "/data", mode: null }
    ];
    for (const mount of Array.isArray(profile.persistent_mounts) ? profile.persistent_mounts : []) {
      if (!mount?.target || !String(mount.target).startsWith("/")) continue;
      const target = String(mount.target);
      const host = writableDirectory(path.join(data, slug(mount.name || path.basename(mount.target))));
      mountCandidates.push({ host: this.#hostPath(host), target, mode: mount.mode || "rw" });
    }
    // The standard /config and /data mounts win if a registry profile repeats
    // one of those targets. Docker rejects duplicate destination paths.
    for (const mount of uniqueDockerMounts(mountCandidates)) {
      args.push("-v", `${mount.host}:${mount.target}${mount.mode ? `:${mount.mode}` : ""}`);
    }
    args.push(image);
    if (profile.command) args.push("sh", "-lc", String(profile.command));
    await this.#jobCommand(job, process.env.UCVR_DOCKER_BIN || "docker", args, { timeoutMs: 120_000 });
    if (!await waitForPort(this.integrationHost, port, Number(process.env.UCVR_INTEGRATION_START_TIMEOUT_MS || 45_000))) {
      const tail = await this.containerLogs(container, { tail: 100 }).catch(() => "");
      await this.#removeContainer(container, false);
      throw new Error(`Container ${container} did not open Integration API port ${port}.${tail ? ` Last output: ${tail.slice(-2000)}` : ""}`);
    }
    const record = {
      registry_id: entry.id, driver_id: driverId, name: entry.name || driverId, repository: entry.repository,
      container, image, source, port, version: job.version,
      websocket_path: integrationWebSocketPath(entry) || null,
      ...(revision ? { revision } : {}), ...(digest ? { digest } : {}),
      installed_at: options.installedAt || existing?.installed_at || new Date().toISOString(), updated_at: new Date().toISOString()
    };
    this.state.integrations[driverId] = record;
    atomicJson(this.statePath, this.state);
    this.invalidateUpdateCache();
    log.info(`${entry.name || entry.id} container ready: ${container}, image=${image}, port=${port}, source=${source}`);
    return { ...record, driverId };
  }

  async #build(entry, image, job) {
    job.phase = "source";
    job.progress = 12;
    job.message = "Preparing integration source";
    job.updatedAt = new Date().toISOString();
    const repo = ownerRepo(entry.repository);
    if (!repo) throw new Error(`Unsupported repository URL: ${entry.repository}`);
    const appDir = path.join(this.appsDir, slug(entry.id));
    if (fs.existsSync(path.join(appDir, ".git"))) {
      await this.#jobCommand(job, "git", ["-c", `safe.directory=${appDir}`, "-C", appDir, "fetch", "--all", "--tags", "--prune"], { timeoutMs: 120_000 });
    } else {
      fs.rmSync(appDir, { recursive: true, force: true });
      await this.#jobCommand(job, "git", ["clone", "--filter=blob:none", entry.repository, appDir], { timeoutMs: 180_000 });
    }
    if (job.version && job.version !== "latest") {
      await this.#jobCommand(job, "git", ["-c", `safe.directory=${appDir}`, "-C", appDir, "checkout", "--force", job.version], { timeoutMs: 60_000 });
    } else {
      await this.#jobCommand(job, "git", ["-c", `safe.directory=${appDir}`, "-C", appDir, "reset", "--hard", "origin/HEAD"], { timeoutMs: 60_000 }).catch(() => {});
    }
    const profile = runtimeProfile(entry);
    const metadataBackups = profile.patch_driver_metadata ? this.#patchDriverMetadata(appDir, baseDriverId(entry), `${entry.name || entry.id} (external)`) : [];
    let dockerfile = profile.dockerfile || (!profile.skip_repo_dockerfile && findFile(appDir, ["Dockerfile", "docker/Dockerfile", "Dockerfile.prod"]));
    let generated = null;
    if (!dockerfile) {
      const stack = detectStack(appDir, profile);
      dockerfile = "-";
      generated = generatedDockerfile(appDir, entry, profile, stack);
      log.info(`${entry.id}: generated ${stack} container build from stdin`);
    } else {
      log.info(`${entry.id}: using repository Dockerfile ${dockerfile}`);
    }
    try {
      job.phase = "building";
      job.progress = 30;
      job.message = "Building integration container";
      job.updatedAt = new Date().toISOString();
      await this.#jobCommand(job, process.env.UCVR_DOCKER_BIN || "docker", ["build", "--pull", "-t", image, "-f", dockerfile, appDir], {
        timeoutMs: 30 * 60_000,
        ...(generated ? { input: generated } : {})
      });
      job.progress = 84;
      job.message = "Integration image built";
      job.updatedAt = new Date().toISOString();
    } finally {
      for (const [filename, content] of metadataBackups) fs.writeFileSync(filename, content);
    }
  }

  #patchDriverMetadata(root, driverId, name) {
    const backups = [];
    for (const relative of walk(root).filter((item) => /(^|\/)driver\.json$/i.test(item))) {
      const filename = path.join(root, relative);
      try {
        const content = fs.readFileSync(filename);
        const metadata = JSON.parse(content.toString("utf8"));
        if (!metadata?.driver_id) continue;
        backups.push([filename, content]);
        metadata.driver_id = driverId;
        if (metadata.name && typeof metadata.name === "object") metadata.name.en = name;
        else metadata.name = { en: name };
        fs.writeFileSync(filename, `${JSON.stringify(metadata, null, 2)}\n`);
        log.info(`Patched ${relative} with external driver id ${driverId}`);
      } catch {}
    }
    if (!backups.length) throw new Error("No patchable driver.json was found for this official integration");
    return backups;
  }

  async #nextPort() {
    const used = new Set(Object.values(this.state.integrations || {}).map((item) => Number(item.port)).filter(Boolean));
    for (let port = this.portStart; port <= 65535; port += 1) {
      if (!used.has(port) && await portAvailable(this.integrationHost, port)) return port;
    }
    throw new Error(`No free integration port found from ${this.portStart}`);
  }

  async #jobCommand(job, command, args, options = {}) {
    if (job.controller.signal.aborted) throw new Error("Installation cancelled");
    const safeArgs = args.map((item, index) => {
      const previous = String(args[index - 1] || "");
      const text = String(item);
      if (previous === "-e" && /(?:TOKEN|KEY|SECRET|PASSWORD)=/i.test(text)) return `${text.split("=")[0]}=***`;
      return /(?:TOKEN|KEY|SECRET|PASSWORD)=/i.test(text) ? `${text.split("=")[0]}=***` : text;
    });
    const commandLine = `$ ${command} ${safeArgs.join(" ")}`;
    log.info(`${job.registryId}: ${command} ${safeArgs.join(" ")}`);
    job.output = `${job.output || ""}${job.output ? "\n" : ""}${commandLine}\n`.slice(-MAX_SETUP_OUTPUT_CHARS);
    job.updatedAt = new Date().toISOString();
    let partial = "";
    const output = (text) => {
      const value = String(text || "");
      job.output = `${job.output || ""}${value}`.slice(-MAX_SETUP_OUTPUT_CHARS);
      job.updatedAt = new Date().toISOString();
      if (job.phase === "building") job.progress = Math.min(82, Math.max(32, Number(job.progress || 32) + 0.15));
      partial += value;
      const lines = partial.split(/\r?\n/);
      partial = lines.pop() || "";
      for (const line of lines.filter(Boolean)) log.info(`${job.registryId}: ${line}`);
    };
    return this.runner(command, args, { ...options, signal: job.controller.signal, onStdout: output, onStderr: output });
  }

  #hostPath(containerPath) {
    const dataRoot = path.resolve(this.platform.dataDir);
    const relative = path.relative(dataRoot, path.resolve(containerPath));
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Managed integration path is outside ${dataRoot}`);
    return path.join(path.resolve(this.hostDataDir || dataRoot), relative);
  }

  async #detectHostDataDir() {
    const fallback = path.resolve(this.platform.dataDir);
    const containerId = String(process.env.HOSTNAME || "").trim();
    if (!containerId) return fallback;
    try {
      const result = await this.#docker(["inspect", "-f", "{{json .Mounts}}", containerId], { timeoutMs: 5000, rejectOnError: false });
      if (result.code !== 0 || !String(result.stdout || "").trim()) return fallback;
      const mounts = JSON.parse(String(result.stdout).trim());
      const target = path.resolve(this.platform.dataDir);
      const mount = Array.isArray(mounts) ? mounts.find((item) => path.resolve(String(item.Destination || "")) === target) : null;
      return mount?.Source ? path.resolve(String(mount.Source)) : fallback;
    } catch (error) {
      log.warn("Unable to resolve the host-side data mount; using the runtime data path:", error.message);
      return fallback;
    }
  }

  async #docker(args, options = {}) { return this.runner(process.env.UCVR_DOCKER_BIN || "docker", args, options); }

  async #removeContainer(container, throwOnError = true) {
    return this.#docker(["rm", "-f", container], { timeoutMs: 30_000, rejectOnError: throwOnError });
  }

  async #reconcile() {
    for (const record of Object.values(this.state.integrations || {})) {
      const inspect = await this.#docker(["inspect", "-f", "{{.State.Status}}", record.container], { timeoutMs: 5000, rejectOnError: false });
      if (inspect.code !== 0) continue;
      if (inspect.stdout.trim() !== "running") await this.#docker(["start", record.container], { timeoutMs: 30_000 });
    }
  }

  #repairManagedIntegrationUrls() {
    for (const record of Object.values(this.state.integrations || {})) {
      const dbRecord = this.platform.db.listIntegrations().find((item) => String(item.driver_id || item.metadata?.driver_id || item.id) === String(record.driver_id));
      if (!dbRecord) continue;
      const expected = integrationWebSocketUrl(this.integrationHost, record.port, record);
      if (String(dbRecord.url || "") === expected) continue;
      this.platform.db.updateIntegration(dbRecord.id, { url: expected, last_error: null });
      log.info(`Corrected managed integration WebSocket URL for ${record.driver_id}: ${expected}`);
    }
  }

  managedRecord(idOrDriver) {
    const key = String(idOrDriver || "");
    return this.state.integrations[key]
      || Object.values(this.state.integrations || {}).find((item) => item.driver_id === key || item.container === key)
      || null;
  }

  async setRunning(idOrDriver, running) {
    const record = this.managedRecord(idOrDriver);
    if (!record) return false;
    await this.#docker([running ? "start" : "stop", record.container], { timeoutMs: 60_000 });
    return true;
  }

  async remove(idOrDriver) {
    const record = this.managedRecord(idOrDriver);
    if (!record) return false;
    await this.#removeContainer(record.container, false);
    delete this.state.integrations[record.driver_id];
    atomicJson(this.statePath, this.state);
    fs.rmSync(path.join(this.configDir, record.container), { recursive: true, force: true });
    fs.rmSync(path.join(this.runtimeDataDir, record.container), { recursive: true, force: true });
    this.invalidateUpdateCache();
    log.info(`Removed managed integration container ${record.container}`);
    return true;
  }

  async factoryReset() {
    for (const job of this.jobs.values()) job.controller.abort();
    await Promise.allSettled(Object.values(this.state.integrations || {}).map((item) => this.#removeContainer(item.container, false)));
    this.state = { version: 1, integrations: {} };
    this.invalidateUpdateCache();
    fs.rmSync(this.root, { recursive: true, force: true });
  }

  services() {
    return Object.values(this.state.integrations || {}).map((item) => ({ service: item.container, name: item.name || item.driver_id, container: item.container }));
  }

  async containerLogs(container, options = {}) {
    const args = ["logs", "--timestamps", "--tail", String(Math.max(1, Math.min(10000, Number(options.tail || 1000))))];
    if (options.since) args.push("--since", options.since);
    if (options.until) args.push("--until", options.until);
    args.push(container);
    const result = await this.#docker(args, { timeoutMs: 30_000, rejectOnError: false });
    return `${result.stdout || ""}${result.stderr || ""}`;
  }

  async logRecords(query = {}) {
    const requested = new Set(String(query.s || "").split(",").map(decodeURIComponent).filter(Boolean));
    const services = this.services().filter((item) => !requested.size || requested.has(item.service));
    const limit = Math.max(1, Math.min(10000, Number(query.limit || 1000)));
    const records = [];
    for (const service of services) {
      const output = await this.containerLogs(service.container, {
        tail: limit,
        since: query.from || undefined,
        until: query.to || undefined
      }).catch((error) => `${new Date().toISOString()} ERROR Unable to read Docker logs: ${error.message}`);
      for (const raw of splitLines(output)) {
        const match = raw.match(/^(\d{4}-\d\d-\d\dT\S+)\s+(.*)$/);
        const timestamp = match && !Number.isNaN(Date.parse(match[1])) ? new Date(match[1]).toISOString() : new Date().toISOString();
        const message = match ? match[2] : raw;
        const level = /\b(error|fatal|exception|traceback)\b/i.test(message) ? "error" : /\bwarn(?:ing)?\b/i.test(message) ? "warn" : /\bdebug\b/i.test(message) ? "debug" : "info";
        records.push({ timestamp, level, priority: level === "error" ? 3 : level === "warn" ? 4 : level === "debug" ? 7 : 6,
          scope: service.container, service: service.service, message, line: `[${timestamp}] ${level.toUpperCase().padEnd(5)} ${service.container} ${message}` });
      }
    }
    return records;
  }
}

export { DEFAULT_REGISTRY_URL, registryDriver };
