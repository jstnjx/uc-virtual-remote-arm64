import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createZip, extractZip, readJson } from "../shared/archive.js";
import { displayName, localEntityId, nowIso } from "../shared/util.js";

function files(root, relative = "") {
  const directory = path.join(root, relative);
  let entries = [];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((entry) => {
    const next = path.join(relative, entry.name);
    return entry.isDirectory() ? files(root, next) : [next];
  });
}

function jsonFiles(root, directory) {
  return files(root, directory).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(root, name), null)).filter(Boolean);
}

function mime(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if ([".jpg", ".jpeg"].includes(ext)) return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function integrationRecord(driver, instance) {
  const id = String(instance?.integration_id || driver.driver_id);
  return {
    id,
    name: displayName(instance?.name || driver.name, id),
    url: String(instance?.driver_url || driver.driver_url || "virtual://restored-integration"),
    token: null,
    enabled: false,
    status: "DISCONNECTED",
    device_state: "DISCONNECTED",
    driver_version: driver.version || null,
    driver_id: driver.driver_id || id,
    driver_type: "EXTERNAL",
    auth_method: "NONE",
    configured: true,
    setup_state: "IDLE",
    last_error: "Restored from a physical Remote backup. Register the corresponding external integration to reconnect it.",
    metadata: {
      ...driver,
      ...(instance || {}),
      driver_id: driver.driver_id || id,
      original_driver_type: driver.driver_type || "UNKNOWN",
      driver_type: "EXTERNAL",
      name: instance?.name || driver.name || { en: id },
      icon: instance?.icon || driver.icon || "uc:integration"
    }
  };
}

function convertProfile(profile) {
  const profileId = String(profile.profile_id || profile.id);
  const pages = (profile.pages || []).map((page, index) => ({
    ...page,
    id: page.page_id || page.id,
    page_id: page.page_id || page.id,
    profile_id: profileId,
    pos: Number(page.position ?? page.pos ?? index),
    sort_order: Number(page.position ?? page.sort_order ?? index),
    items: (page.items || []).map((item, itemIndex) => ({ ...item, pos: Number(item.position ?? item.pos ?? itemIndex) }))
  }));
  const groups = (profile.groups || []).map((group) => ({
    ...group,
    id: group.group_id || group.id,
    group_id: group.group_id || group.id,
    profile_id: profileId
  }));
  return {
    profile: { ...profile, id: profileId, profile_id: profileId, pages: undefined, groups: undefined },
    pages,
    groups
  };
}

export class SystemBackupService {
  constructor(platform) {
    this.platform = platform;
    this.snapshotDir = path.join(platform.dataDir, "backups", "snapshots");
    fs.mkdirSync(this.snapshotDir, { recursive: true });
  }

  #snapshotPath(id) {
    const value = String(id || "").replace(/[^a-zA-Z0-9._-]/g, "");
    if (!value) throw Object.assign(new Error("Invalid backup snapshot identifier"), { status: 400 });
    return path.join(this.snapshotDir, `${value}.backup`);
  }

  #snapshotInfo(filename) {
    const stat = fs.statSync(filename);
    return {
      id: path.basename(filename, ".backup"),
      creation_date: stat.birthtimeMs > 0 ? stat.birthtime.toISOString() : stat.mtime.toISOString(),
      size: stat.size
    };
  }

  listSnapshots() {
    let entries = [];
    try { entries = fs.readdirSync(this.snapshotDir); } catch {}
    return entries.filter((name) => name.endsWith(".backup")).map((name) => this.#snapshotInfo(path.join(this.snapshotDir, name)))
      .sort((a, b) => b.creation_date.localeCompare(a.creation_date));
  }

  createSnapshot() {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const id = `UCR3_${stamp}`;
    const filename = this.#snapshotPath(id);
    fs.writeFileSync(filename, this.exportArchive(), { flag: "wx" });
    return this.#snapshotInfo(filename);
  }

  getSnapshot(id) {
    const filename = this.#snapshotPath(id);
    if (!fs.existsSync(filename)) return null;
    return { ...this.#snapshotInfo(filename), path: filename };
  }

  snapshotMetadata(id) {
    const item = this.getSnapshot(id);
    if (!item) return null;
    return {
      id: item.id,
      creation_date: item.creation_date,
      version: { backup: "1.0.0", core: this.platform.version, os: `Node.js ${process.version}` }
    };
  }

  restoreSnapshot(id, options = {}) {
    const item = this.getSnapshot(id);
    if (!item) throw Object.assign(new Error(`Backup snapshot ${id} was not found`), { status: 404 });
    return this.restore(fs.readFileSync(item.path), options);
  }

  deleteSnapshot(id) {
    const item = this.getSnapshot(id);
    if (!item) return false;
    fs.rmSync(item.path, { force: true });
    return true;
  }

  deleteAllSnapshots() {
    const count = this.listSnapshots().length;
    for (const item of this.listSnapshots()) this.deleteSnapshot(item.id);
    return count;
  }

  exportArchive() {
    const data = this.platform.db.exportData();
    const metadata = {
      version: "1.0.0",
      product: "UC Virtual Remote",
      created_at: data.created_at,
      format: data.format
    };
    return createZip([
      { name: "backup.json", data: `${JSON.stringify(metadata, null, 2)}\n` },
      { name: "uc-virtual-remote.json", data: `${JSON.stringify(data)}\n` }
    ]);
  }

  restore(buffer, options = {}) {
    let payload;
    if (buffer.subarray(0, 2).toString("binary") === "PK") {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ucvr-restore-"));
      const zip = path.join(temp, "backup.backup");
      try {
        fs.writeFileSync(zip, buffer);
        extractZip(zip, temp, { maximumEntries: 50000, maximumUncompressedBytes: 1024 * 1024 * 1024 });
        payload = this.#payloadFromExtracted(temp);
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    } else {
      try { payload = JSON.parse(buffer.toString("utf8")); }
      catch { throw Object.assign(new Error("Backup archive is invalid or corrupt"), { status: 400 }); }
    }
    return this.platform.db.importData(payload, { merge: Boolean(options.merge) });
  }

  #payloadFromExtracted(root) {
    for (const candidate of ["uc-virtual-remote.json", "backup.json"]) {
      const value = readJson(path.join(root, candidate), null);
      if (String(value?.format || "").startsWith("uc-virtual-remote-backup-v")) return value;
    }
    const backup = readJson(path.join(root, "backup.json"), null);
    if (!backup) throw Object.assign(new Error("Backup archive is invalid or corrupt"), { status: 400 });
    return this.#convertPhysicalBackup(root, backup);
  }

  #convertPhysicalBackup(root, backup) {
    const settings = readJson(path.join(root, "settings.json"), {});
    const configuration = { ...settings };
    if (configuration.voice && !configuration.voice_control) configuration.voice_control = configuration.voice;
    delete configuration.voice;

    const integrations = [];
    const driverByInstance = new Map();
    for (const driverPath of files(root, "integrations").filter((name) => name.endsWith("/driver.json"))) {
      const driver = readJson(path.join(root, driverPath), null);
      if (!driver) continue;
      for (const instance of driver.instances || []) {
        const item = integrationRecord(driver, instance);
        integrations.push(item);
        driverByInstance.set(item.id, item);
      }
    }

    const configuredEntities = [];
    const availableEntities = [];
    const entityIds = new Set();
    const addEntity = (entity) => {
      if (!entity?.entity_id || !entity.integration_id || entityIds.has(entity.entity_id)) return;
      entityIds.add(entity.entity_id);
      if (!driverByInstance.has(entity.integration_id)) {
        const synthetic = integrationRecord({ driver_id: entity.integration_id, name: { en: entity.integration_id }, driver_type: "RESTORED" }, { integration_id: entity.integration_id });
        integrations.push(synthetic); driverByInstance.set(entity.integration_id, synthetic);
      }
      const localId = localEntityId(entity.integration_id, entity.entity_id);
      const common = { ...entity, local_id: localId };
      availableEntities.push({ ...common, entity_id: localId });
      configuredEntities.push({ ...common, id: entity.entity_id, entity_id: entity.entity_id, attributes: entity.attributes || {} });
    };
    for (const entityPath of files(root, "integrations").filter((name) => name.includes("/entities/") && name.endsWith(".json"))) {
      addEntity(readJson(path.join(root, entityPath), null));
    }
    for (const remotePath of files(root, "remotes").filter((name) => !name.includes("/ir/") && name.endsWith(".json"))) {
      addEntity(readJson(path.join(root, remotePath), null));
    }

    const profileParts = jsonFiles(root, "profiles").map(convertProfile);
    const resources = [];
    for (const filename of files(root, "resources")) {
      const parts = filename.replace(/\\/g, "/").split("/");
      if (parts.length < 3) continue;
      const officialType = parts[1];
      const basename = path.basename(filename);
      const type = officialType === "BackgroundImage" ? "background" : officialType === "Icon" ? "icon" : officialType.toLowerCase();
      resources.push({
        type, id: basename, filename: basename, mime_type: mime(basename), metadata: {},
        data_base64: fs.readFileSync(path.join(root, filename)).toString("base64")
      });
    }

    return {
      format: "uc-virtual-remote-backup-v4",
      created_at: nowIso(),
      source_versions: { physical_remote_backup: backup.version || backup.backup_version || "unknown" },
      settings: { configuration, restored_physical_backup: backup },
      integrations,
      available_entities: availableEntities,
      configured_entities: configuredEntities,
      activities: jsonFiles(root, "activities"),
      macros: jsonFiles(root, "macros"),
      activity_groups: jsonFiles(root, "activity_groups"),
      profiles: profileParts.map((item) => item.profile),
      pages: profileParts.flatMap((item) => item.pages),
      groups: profileParts.flatMap((item) => item.groups),
      resources,
      media_queues: [],
      docks: jsonFiles(root, "docks").map((dock) => ({ ...dock, version: dock.version || "0.10.15", state: dock.active === false ? "DISCONNECTED" : "ACTIVE" })),
      custom_ir_code_sets: []
    };
  }
}
