import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUNDLED_CONFIGURATOR_VERSION = "2.3.3-unfoldedtools.8";
const UPSTREAM_CONFIGURATOR_VERSION = "2.3.3";
const COMMUNITY_BUILD_PUBLISHED_AT = "2026-08-03";
const COMMUNITY_BUILD_UPDATED_AT = "2026-08-05";
const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultRoot = path.join(applicationRoot, "web-configurator-build");
const SOURCE_ARCHIVE_NAME = `web-configurator-${BUNDLED_CONFIGURATOR_VERSION}-source.tar.gz`;
const defaultSourceArchive = path.join(applicationRoot, "web-configurator-source", SOURCE_ARCHIVE_NAME);
const SOURCE_ARCHIVE_ROUTE = `/web-configurator-source/${SOURCE_ARCHIVE_NAME}`;

function readVersion(filename) {
  try {
    const value = fs.readFileSync(filename, "utf8").trim();
    return /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function fileSha256(filename) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
  } catch {
    return null;
  }
}

function countFiles(root) {
  let total = 0;
  const stack = [root];
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
      else if (entry.isFile()) total += 1;
    }
  }
  return total;
}

export class WebConfiguratorManager {
  constructor(_dataDir, options = {}) {
    const explicitDir = typeof options === "string" ? options : options.root;
    const explicitSourceRoot = typeof options === "object" && options ? options.sourceRoot : null;
    this.root = explicitDir
      ? path.resolve(explicitDir)
      : path.resolve(process.env.UCVR_WEB_CONFIGURATOR_DIR || defaultRoot);
    this.sourceArchive = explicitSourceRoot
      ? path.resolve(explicitSourceRoot, SOURCE_ARCHIVE_NAME)
      : path.resolve(process.env.UCVR_WEB_CONFIGURATOR_SOURCE_ARCHIVE_PATH || defaultSourceArchive);
    this.sourceRoute = SOURCE_ARCHIVE_ROUTE;
  }

  status() {
    const index = path.join(this.root, "index.html");
    const installed = fs.existsSync(index);
    const sourceArchiveAvailable = fs.existsSync(this.sourceArchive);
    return {
      installed,
      active: installed,
      bundled: true,
      immutable: true,
      path: this.root,
      index,
      version: readVersion(path.join(this.root, "VERSION")) || BUNDLED_CONFIGURATOR_VERSION,
      upstream_version: UPSTREAM_CONFIGURATOR_VERSION,
      source: "repository-contained-modified-web-configurator-source",
      source_repository_path: "web-configurator/",
      source_archive_available: sourceArchiveAvailable,
      source_archive_route: this.sourceRoute,
      source_archive_sha256: sourceArchiveAvailable ? fileSha256(this.sourceArchive) : null,
      asset_count: installed ? countFiles(this.root) : 0,
      published_at: COMMUNITY_BUILD_PUBLISHED_AT,
      modified_at: COMMUNITY_BUILD_UPDATED_AT,
      route: "/configurator/",
      simulator_route: "/configurator/?ucvr_view=remote3"
    };
  }

  resolve(relativePath) {
    const root = path.resolve(this.root);
    const requested = String(relativePath || "").replace(/^\/+/, "");
    const filename = path.resolve(root, requested || "index.html");
    if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) return null;
    if (fs.existsSync(filename) && fs.statSync(filename).isFile()) return filename;
    if (requested && !path.extname(requested)) {
      const index = path.join(root, "index.html");
      if (fs.existsSync(index)) return index;
    }
    return null;
  }
}
