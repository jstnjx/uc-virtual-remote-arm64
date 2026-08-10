import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { displayName, jsonString, localEntityId, nowIso, parseJson, qualifiedEntityId, randomId, slug } from "../shared/util.js";
import { entityCommandIds, normalizeButtonMappings } from "../core/device-metadata.js";

function bool(value) { return Boolean(Number(value)); }
function rowJson(row, fields = []) {
  if (!row) return null;
  const value = { ...row };
  for (const [field, fallback] of fields.map((item) => Array.isArray(item) ? item : [item, item === "metadata_json" ? {} : null])) {
    value[field.replace(/_json$/, "")] = parseJson(value[field], fallback);
    delete value[field];
  }
  for (const key of ["enabled", "active", "restricted", "configured"]) if (key in value) value[key] = bool(value[key]);
  return value;
}

function languageText(value, fallback = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return { en: String(value || fallback) };
}

function pageItems(value) {
  const items = Array.isArray(value) ? value : [];
  return items.map((item, index) => {
    if (typeof item === "string") return { entity_id: item, pos: index };
    const result = { ...item, pos: Number(item?.pos ?? index) };
    if (!result.entity_id && !result.group_id && result.target_id) {
      if (result.type === "group") result.group_id = result.target_id;
      else result.entity_id = result.target_id;
    }
    if (!result.entity_id && !result.group_id && result.id) result.entity_id = result.id;
    return result;
  }).filter((item) => item.entity_id || item.group_id);
}

function normalizeActivityUiItem(value = {}) {
  const item = value && typeof value === "object" ? { ...value } : {};
  item.type = String(item.type || "text");
  item.location = {
    x: Math.max(0, Number(item.location?.x ?? 0) || 0),
    y: Math.max(0, Number(item.location?.y ?? 0) || 0)
  };
  item.size = {
    width: Math.max(1, Number(item.size?.width ?? 1) || 1),
    height: Math.max(1, Number(item.size?.height ?? 1) || 1)
  };

  if (item.type === "sensor") {
    const sensor = typeof item.sensor === "string" ? { sensor_id: item.sensor } : { ...(item.sensor || {}) };
    sensor.sensor_id = String(sensor.sensor_id || item.sensor_id || item.entity_id || "");
    sensor.show_label = Boolean(sensor.show_label ?? item.show_label ?? false);
    sensor.show_unit = Boolean(sensor.show_unit ?? item.show_unit ?? true);
    item.sensor = sensor;
    delete item.sensor_id;
    delete item.show_label;
    delete item.show_unit;
  } else if (item.type === "select") {
    const select = typeof item.select === "string" ? { select_id: item.select } : { ...(item.select || {}) };
    select.select_id = String(select.select_id || item.select_id || item.entity_id || "");
    select.show_name = Boolean(select.show_name ?? item.show_name ?? false);
    item.select = select;
    delete item.select_id;
    delete item.show_name;
  } else if (item.type === "media_player") {
    item.media_player_id = String(item.media_player_id || item.mediaPlayerId || item.entity_id || "");
    delete item.mediaPlayerId;
  }
  return item;
}

function normalizeActivityUserInterface(value = {}) {
  const userInterface = value && typeof value === "object" ? { ...value } : {};
  userInterface.pages = (Array.isArray(userInterface.pages) ? userInterface.pages : []).map((page, index) => {
    const source = page && typeof page === "object" ? page : {};
    const rawItems = Array.isArray(source.items) && source.items.length
      ? source.items
      : Array.isArray(source.gridCommands) ? source.gridCommands : [];
    const items = rawItems.map((item) => normalizeActivityUiItem(item));
    const width = Math.max(1, Number(source.grid?.width ?? 4) || 4);
    const height = Math.max(1, Number(source.grid?.height ?? 6) || 6);
    return {
      ...source,
      page_id: String(source.page_id || source.id || `page-${index + 1}`),
      name: String(source.name || `Page ${index + 1}`),
      grid: { width, height },
      items,
      gridCommands: items.map((item) => structuredClone(item))
    };
  });
  return userInterface;
}

export class PlatformDatabase {
  constructor(dataDir) {
    const resolvedDataDir = path.resolve(dataDir);
    const uid = typeof process.getuid === "function" ? process.getuid() : "unknown";
    const gid = typeof process.getgid === "function" ? process.getgid() : "unknown";
    try {
      fs.mkdirSync(resolvedDataDir, { recursive: true });
      fs.accessSync(resolvedDataDir, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
      throw new Error(
        `UC Virtual Remote data directory is not writable: ${resolvedDataDir} ` +
        `(uid=${uid}, gid=${gid}). For Docker bind mounts, pre-create the directory ` +
        `with UID/GID 1000 or use the supplied container entrypoint.`,
        { cause: error }
      );
    }
    this.dataDir = resolvedDataDir;
    this.resourcesDir = path.join(resolvedDataDir, "resources");
    this.mediaDir = path.join(resolvedDataDir, "media-cache");
    fs.mkdirSync(this.resourcesDir, { recursive: true });
    fs.mkdirSync(this.mediaDir, { recursive: true });
    this.path = path.join(resolvedDataDir, "virtual-remote.sqlite");
    this.closed = false;
    try { this.db = new DatabaseSync(this.path); }
    catch (error) {
      throw new Error(
        `Unable to open UC Virtual Remote database: ${this.path} ` +
        `(uid=${uid}, gid=${gid}). Check directory ownership, permissions, and free disk space.`,
        { cause: error }
      );
    }
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.#migrate();
    this.#seed();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.db.close(); } catch {}
  }

  #hasColumn(table, column) {
    return this.db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
  }

  #addColumn(table, definition) {
    const name = definition.trim().split(/\s+/)[0];
    if (!this.#hasColumn(table, name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }

  #migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS integrations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        token TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'DISCONNECTED',
        device_state TEXT NOT NULL DEFAULT 'UNKNOWN',
        driver_version TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        setup_state TEXT NOT NULL DEFAULT 'IDLE',
        setup_action_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS available_entities (
        integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
        local_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        name TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (integration_id, local_id)
      );
      CREATE TABLE IF NOT EXISTS configured_entities (
        id TEXT PRIMARY KEY,
        integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
        local_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        name TEXT NOT NULL,
        icon TEXT,
        metadata_json TEXT NOT NULL,
        attributes_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (integration_id, local_id)
      );
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT,
        state TEXT NOT NULL DEFAULT 'OFF',
        options_json TEXT NOT NULL DEFAULT '{}',
        sequence_on_json TEXT NOT NULL DEFAULT '[]',
        sequence_off_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS macros (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT,
        sequence_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        columns_count INTEGER NOT NULL DEFAULT 4,
        rows_count INTEGER NOT NULL DEFAULT 7,
        elements_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profile_groups (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        icon TEXT,
        description TEXT,
        entities_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activity_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT,
        description_json TEXT NOT NULL DEFAULT '{}',
        options_json TEXT NOT NULL DEFAULT '{}',
        activities_json TEXT NOT NULL DEFAULT '[]',
        state TEXT NOT NULL DEFAULT 'OFF',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        status TEXT NOT NULL,
        current_step INTEGER NOT NULL DEFAULT 0,
        total_steps INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        scopes_json TEXT NOT NULL DEFAULT '["admin"]',
        active INTEGER NOT NULL DEFAULT 1,
        valid_to TEXT,
        description TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS external_access_tokens (
        system TEXT NOT NULL,
        token_id TEXT NOT NULL,
        name TEXT NOT NULL,
        token TEXT NOT NULL,
        description TEXT,
        url TEXT,
        data TEXT,
        creation_date TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(system, token_id)
      );
      CREATE TABLE IF NOT EXISTS resources (
        type TEXT NOT NULL,
        id TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        PRIMARY KEY(type,id)
      );
      CREATE TABLE IF NOT EXISTS media_cache (
        cache_key TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        request_json TEXT NOT NULL DEFAULT '{}',
        response_json TEXT NOT NULL,
        item_count INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_artwork (
        id TEXT PRIMARY KEY,
        source_url TEXT,
        filename TEXT NOT NULL,
        mime_type TEXT,
        etag TEXT,
        size INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_queues (
        entity_id TEXT PRIMARY KEY,
        items_json TEXT NOT NULL DEFAULT '[]',
        position INTEGER NOT NULL DEFAULT 0,
        repeat_mode TEXT,
        shuffle INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_sessions (
        id TEXT PRIMARY KEY,
        integration_id TEXT,
        entity_id TEXT,
        kind TEXT NOT NULL,
        state_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS docks (
        id TEXT PRIMARY KEY,
        active INTEGER NOT NULL DEFAULT 1,
        config_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS dock_setups (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        data_json TEXT NOT NULL DEFAULT '{}',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS dock_updates (
        dock_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        version TEXT,
        error TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS dock_output_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dock_id TEXT NOT NULL,
        port_id TEXT,
        mode TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ir_code_sets (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT 'CUSTOM',
        manufacturer_id TEXT,
        name TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        codes_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ir_learn_sessions (
        emitter_id TEXT PRIMARY KEY,
        active INTEGER NOT NULL DEFAULT 0,
        timeout_at INTEGER,
        code_json TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_available_integration ON available_entities(integration_id);
      CREATE INDEX IF NOT EXISTS idx_configured_integration ON configured_entities(integration_id);
      CREATE INDEX IF NOT EXISTS idx_pages_profile ON pages(profile_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_groups_profile ON profile_groups(profile_id, name);
      CREATE INDEX IF NOT EXISTS idx_media_cache_entity ON media_cache(entity_id, kind);
      CREATE INDEX IF NOT EXISTS idx_dock_log_dock ON dock_output_log(dock_id, created_at);
    `);

    this.#addColumn("integrations", "driver_id TEXT");
    this.#addColumn("integrations", "driver_type TEXT NOT NULL DEFAULT 'EXTERNAL'");
    this.#addColumn("integrations", "auth_method TEXT NOT NULL DEFAULT 'NONE'");
    this.#addColumn("integrations", "setup_data_json TEXT NOT NULL DEFAULT '{}'");
    // Existing databases represented every driver record as an instance. Keep
    // those records configured by default while allowing newly registered
    // drivers to remain unconfigured until setup completes.
    this.#addColumn("integrations", "configured INTEGER NOT NULL DEFAULT 1");
    this.#addColumn("profiles", "icon TEXT");
    this.#addColumn("activities", "description TEXT");
    this.#addColumn("activities", "integration_id TEXT NOT NULL DEFAULT 'uc:core'");
    this.#addColumn("activities", "attributes_json TEXT NOT NULL DEFAULT '{}'");
    this.#addColumn("macros", "description TEXT");
    this.#addColumn("macros", "integration_id TEXT NOT NULL DEFAULT 'uc:core'");
    this.#addColumn("macros", "attributes_json TEXT NOT NULL DEFAULT '{}'");
    this.#addColumn("macros", "options_json TEXT NOT NULL DEFAULT '{}'");
    this.#addColumn("profiles", "restricted INTEGER NOT NULL DEFAULT 0");
    this.#addColumn("profiles", "description TEXT");
    this.#addColumn("pages", "image TEXT");
    this.#addColumn("api_keys", "active INTEGER NOT NULL DEFAULT 1");
    this.#addColumn("api_keys", "valid_to TEXT");
    this.#addColumn("api_keys", "description TEXT");
  }

  #seed() {
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM profiles").get().count;
    if (count > 0) return;
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO profiles (id,name,active,icon,restricted,description,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run("default", "Default", 1, null, 0, "Default virtual remote profile", timestamp, timestamp);
    this.db.prepare(`
      INSERT INTO pages (id,profile_id,name,sort_order,columns_count,rows_count,elements_json,image,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run("home", "default", "Home", 0, 4, 7, "[]", null, timestamp, timestamp);
  }

  getSetting(key, fallback = null) {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key=?").get(key);
    return row ? parseJson(row.value_json, fallback) : fallback;
  }

  setSetting(key, value) {
    this.db.prepare(`
      INSERT INTO settings (key,value_json,updated_at) VALUES (?,?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(key, jsonString(value), nowIso());
    return value;
  }

  listIntegrations() {
    return this.db.prepare("SELECT * FROM integrations ORDER BY name COLLATE NOCASE").all()
      .map((row) => rowJson(row, [["metadata_json", {}], ["setup_action_json", null], ["setup_data_json", {}]]));
  }

  getIntegration(id) {
    return rowJson(this.db.prepare("SELECT * FROM integrations WHERE id=?").get(id), [
      ["metadata_json", {}], ["setup_action_json", null], ["setup_data_json", {}]
    ]);
  }

  saveIntegration(input) {
    const timestamp = nowIso();
    const id = slug(input.id || input.integration_id || input.name || `integration-${Date.now()}`, "integration");
    const existing = this.getIntegration(id);
    const metadata = input.metadata ?? existing?.metadata ?? {};
    const driverId = String(input.driver_id || metadata.driver_id || existing?.driver_id || id);
    this.db.prepare(`
      INSERT INTO integrations (
        id,name,url,token,enabled,status,device_state,driver_version,metadata_json,setup_state,
        setup_action_json,created_at,updated_at,last_error,driver_id,driver_type,auth_method,setup_data_json,configured
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,url=excluded.url,token=excluded.token,enabled=excluded.enabled,
        driver_id=excluded.driver_id,driver_type=excluded.driver_type,auth_method=excluded.auth_method,
        setup_data_json=excluded.setup_data_json,configured=excluded.configured,updated_at=excluded.updated_at
    `).run(
      id,
      String(input.name || existing?.name || id),
      String(input.url || input.driver_url || existing?.url || ""),
      input.token ?? existing?.token ?? null,
      input.enabled === false ? 0 : 1,
      existing?.status || input.status || "DISCONNECTED",
      existing?.device_state || input.device_state || "UNKNOWN",
      existing?.driver_version || input.driver_version || input.version || null,
      jsonString(metadata),
      existing?.setup_state || input.setup_state || "IDLE",
      (existing?.setup_action || input.setup_action) ? jsonString(input.setup_action ?? existing.setup_action) : null,
      existing?.created_at || timestamp,
      timestamp,
      input.last_error ?? existing?.last_error ?? null,
      driverId,
      String(input.driver_type || existing?.driver_type || "EXTERNAL"),
      String(input.auth_method || existing?.auth_method || (input.token ? "TOKEN" : "NONE")),
      jsonString(input.setup_data ?? existing?.setup_data ?? {}),
      (input.configured ?? existing?.configured ?? true) ? 1 : 0
    );
    return this.getIntegration(id);
  }

  updateIntegration(id, patch) {
    const existing = this.getIntegration(id);
    if (!existing) return null;
    const merged = { ...existing, ...patch, updated_at: nowIso() };
    this.db.prepare(`
      UPDATE integrations SET
        name=?,url=?,token=?,enabled=?,status=?,device_state=?,driver_version=?,metadata_json=?,
        setup_state=?,setup_action_json=?,updated_at=?,last_error=?,driver_id=?,driver_type=?,auth_method=?,setup_data_json=?,configured=?
      WHERE id=?
    `).run(
      merged.name, merged.url, merged.token ?? null, merged.enabled === false ? 0 : 1,
      merged.status || "DISCONNECTED", merged.device_state || "UNKNOWN", merged.driver_version || null,
      jsonString(merged.metadata || {}), merged.setup_state || "IDLE",
      merged.setup_action ? jsonString(merged.setup_action) : null, merged.updated_at,
      merged.last_error || null, merged.driver_id || merged.metadata?.driver_id || id,
      merged.driver_type || "EXTERNAL", merged.auth_method || (merged.token ? "TOKEN" : "NONE"),
      jsonString(merged.setup_data || {}), merged.configured === false ? 0 : 1, id
    );
    return this.getIntegration(id);
  }

  deleteIntegration(id) { return this.db.prepare("DELETE FROM integrations WHERE id=?").run(id).changes > 0; }

  replaceAvailableEntities(integrationId, entities) {
    const timestamp = nowIso();
    const insert = this.db.prepare(`
      INSERT INTO available_entities (integration_id,local_id,entity_type,name,metadata_json,updated_at)
      VALUES (?,?,?,?,?,?)
    `);
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM available_entities WHERE integration_id=?").run(integrationId);
      for (const entity of entities || []) {
        const localId = String(entity.entity_id || entity.id || "");
        if (!localId) continue;
        insert.run(integrationId, localId, String(entity.entity_type || "unknown"), displayName(entity.name, localId), jsonString(entity), timestamp);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listAvailableEntities(integrationId);
  }

  upsertAvailableEntity(integrationId, entity) {
    const localId = String(entity.entity_id || entity.id || "");
    if (!localId) throw new Error("Available entity has no identifier");
    this.db.prepare(`
      INSERT INTO available_entities (integration_id,local_id,entity_type,name,metadata_json,updated_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(integration_id,local_id) DO UPDATE SET
        entity_type=excluded.entity_type,name=excluded.name,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at
    `).run(integrationId, localId, String(entity.entity_type || "unknown"), displayName(entity.name, localId), jsonString(entity), nowIso());
    return this.getAvailableEntity(integrationId, localId);
  }

  removeAvailableEntity(integrationId, localId) {
    return this.db.prepare("DELETE FROM available_entities WHERE integration_id=? AND local_id=?").run(integrationId, localId).changes > 0;
  }

  listAvailableEntities(integrationId = null) {
    const rows = integrationId
      ? this.db.prepare("SELECT * FROM available_entities WHERE integration_id=? ORDER BY name COLLATE NOCASE").all(integrationId)
      : this.db.prepare("SELECT * FROM available_entities ORDER BY integration_id,name COLLATE NOCASE").all();
    return rows.map((row) => ({
      integration_id: row.integration_id,
      local_id: row.local_id,
      ...parseJson(row.metadata_json, {}),
      configured_id: qualifiedEntityId(row.integration_id, row.local_id)
    }));
  }

  getAvailableEntity(integrationId, localId) {
    const row = this.db.prepare("SELECT * FROM available_entities WHERE integration_id=? AND local_id=?").get(integrationId, localId);
    return row ? {
      integration_id: row.integration_id,
      local_id: row.local_id,
      ...parseJson(row.metadata_json, {}),
      configured_id: qualifiedEntityId(row.integration_id, row.local_id)
    } : null;
  }

  configureEntity(integrationId, localId, overrides = {}) {
    const source = this.getAvailableEntity(integrationId, localId);
    if (!source) throw Object.assign(new Error(`Entity ${integrationId}/${localId} is not available`), { status: 404 });
    const id = qualifiedEntityId(integrationId, localId);
    const timestamp = nowIso();
    const old = this.getConfiguredEntity(id);
    const metadata = { ...source, ...overrides, entity_id: id, integration_id: integrationId };
    delete metadata.configured_id;
    delete metadata.local_id;
    const name = displayName(overrides.name || source.name, localId);
    this.db.prepare(`
      INSERT INTO configured_entities (id,integration_id,local_id,entity_type,name,icon,metadata_json,attributes_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        entity_type=excluded.entity_type,name=excluded.name,icon=excluded.icon,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at
    `).run(
      id, integrationId, localId, String(source.entity_type || "unknown"), name,
      overrides.icon ?? source.icon ?? null, jsonString(metadata),
      jsonString(old?.attributes || source.attributes || {}), old?.created_at || timestamp, timestamp
    );
    return this.getConfiguredEntity(id);
  }

  updateConfiguredEntity(id, patch = {}) {
    const existing = this.getConfiguredEntity(id);
    if (!existing) return null;
    const metadata = { ...existing, ...patch, entity_id: id, integration_id: existing.integration_id };
    const name = displayName(patch.name || existing.name, existing.display_name || id);
    this.db.prepare("UPDATE configured_entities SET name=?,icon=?,metadata_json=?,updated_at=? WHERE id=?")
      .run(name, patch.icon ?? existing.icon ?? null, jsonString(metadata), nowIso(), id);
    if (patch.attributes) this.updateEntityAttributes(id, patch.attributes);
    return this.getConfiguredEntity(id);
  }

  deleteConfiguredEntity(id) { return this.db.prepare("DELETE FROM configured_entities WHERE id=?").run(id).changes > 0; }

  listConfiguredEntities(integrationId = null) {
    const rows = integrationId
      ? this.db.prepare("SELECT * FROM configured_entities WHERE integration_id=? ORDER BY name COLLATE NOCASE").all(integrationId)
      : this.db.prepare("SELECT * FROM configured_entities ORDER BY name COLLATE NOCASE").all();
    return rows.map((row) => this.#configuredRow(row));
  }

  getConfiguredEntity(id) { return this.#configuredRow(this.db.prepare("SELECT * FROM configured_entities WHERE id=?").get(id)); }
  getConfiguredEntityByLocal(integrationId, localId) {
    return this.#configuredRow(this.db.prepare("SELECT * FROM configured_entities WHERE integration_id=? AND local_id=?").get(integrationId, localId));
  }

  #configuredRow(row) {
    if (!row) return null;
    const metadata = parseJson(row.metadata_json, {});
    if (row.entity_type === "remote") {
      metadata.options = {
        ...(metadata.options || {}),
        button_mapping: normalizeButtonMappings(metadata.options?.button_mapping)
      };
    }
    return {
      ...metadata,
      id: row.id,
      entity_id: row.id,
      integration_id: row.integration_id,
      local_id: row.local_id,
      entity_type: row.entity_type,
      name: languageText(metadata.name, row.name),
      display_name: row.name,
      icon: row.icon || metadata.icon || null,
      features: Array.isArray(metadata.features) ? metadata.features : [],
      options: metadata.options || {},
      attributes: parseJson(row.attributes_json, {}),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  updateEntityAttributes(id, attributes) {
    const existing = this.getConfiguredEntity(id);
    if (!existing) return null;
    const merged = { ...(existing.attributes || {}), ...(attributes || {}) };
    this.db.prepare("UPDATE configured_entities SET attributes_json=?,updated_at=? WHERE id=?").run(jsonString(merged), nowIso(), id);
    return this.getConfiguredEntity(id);
  }

  #includedEntity(entityId, existing = {}) {
    const id = String(entityId || existing.entity_id || existing.id || "");
    let entity = this.getConfiguredEntity(id);
    if (!entity) {
      const row = this.db.prepare("SELECT * FROM activities WHERE id=?").get(id);
      if (row) {
        const on = parseJson(row.sequence_on_json, []);
        const off = parseJson(row.sequence_off_json, []);
        entity = {
          id: row.id, entity_id: row.id, entity_type: "activity", integration_id: row.integration_id || "uc:core",
          name: languageText(row.name, row.id), icon: row.icon || null,
          features: off.length ? ["on_off", "start"] : ["start"], options: parseJson(row.options_json, {})
        };
      }
    }
    if (!entity) {
      const row = this.db.prepare("SELECT * FROM macros WHERE id=?").get(id);
      if (row) entity = {
        id: row.id, entity_id: row.id, entity_type: "macro", integration_id: row.integration_id || "uc:core",
        name: languageText(row.name, row.id), icon: row.icon || null, features: ["start"], options: parseJson(row.options_json, {})
      };
    }
    if (!entity) return { ...existing, entity_id: id, available: false };

    const integration = entity.integration_id === "uc:core" ? { name: { en: "Core" }, icon: "uc:remote" } : this.getIntegration(entity.integration_id);
    const derivedCommands = entityCommandIds(entity);
    const entityCommands = [...new Set([...(existing.entity_commands || []), ...derivedCommands])];
    const simpleCommands = [...new Set([...(existing.simple_commands || []), ...(entity.options?.simple_commands || [])])];
    return {
      ...existing,
      entity_id: entity.entity_id || entity.id,
      entity_type: entity.entity_type,
      integration_id: entity.integration_id,
      name: languageText(entity.name, entity.display_name || id),
      icon: entity.icon || null,
      entity_commands: entityCommands,
      simple_commands: simpleCommands,
      integration: integration ? {
        name: languageText(integration.name || integration.metadata?.name, integration.id),
        icon: integration.icon || integration.metadata?.icon || "uc:integration"
      } : existing.integration ? {
        ...existing.integration,
        name: languageText(existing.integration.name, entity.integration_id || "Integration")
      } : existing.integration,
      available: true
    };
  }

  #enrichIncludedEntities(items) {
    return (Array.isArray(items) ? items : []).map((item) => {
      const current = typeof item === "string" ? { entity_id: item } : (item || {});
      return this.#includedEntity(current.entity_id || current.id, current);
    });
  }

  #activityWidgetEntities(userInterface) {
    const referenced = new Map();
    const add = (entityId, entityType) => {
      const id = String(entityId || "").trim();
      if (!id || referenced.has(id)) return;
      referenced.set(id, { entity_id: id, entity_type: entityType });
    };
    const visit = (value) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      add(value.media_player_id, "media_player");
      add(value.sensor?.sensor_id, "sensor");
      add(value.select?.select_id, "select");
      for (const item of Object.values(value)) visit(item);
    };
    visit(userInterface?.pages || []);
    return [...referenced.values()];
  }

  #activityIncludedEntities(options) {
    const explicit = options.included_entities ?? options.entities ?? options.entity_ids ?? [];
    const values = new Map();
    for (const item of Array.isArray(explicit) ? explicit : []) {
      const current = typeof item === "string" ? { entity_id: item } : (item || {});
      const id = String(current.entity_id || current.id || "").trim();
      if (id) values.set(id, current);
    }
    for (const item of this.#activityWidgetEntities(options.user_interface)) {
      if (!values.has(item.entity_id)) values.set(item.entity_id, item);
    }
    return this.#enrichIncludedEntities([...values.values()]);
  }

  listActivities() {
    return this.db.prepare("SELECT * FROM activities ORDER BY name COLLATE NOCASE").all().map((row) => {
      const options = parseJson(row.options_json, {});
      options.user_interface = normalizeActivityUserInterface(options.user_interface);
      options.included_entities = this.#activityIncludedEntities(options);
      delete options.entities;
      delete options.entity_ids;
      options.button_mapping = normalizeButtonMappings(options.button_mapping);
      const on = parseJson(row.sequence_on_json, []);
      const off = parseJson(row.sequence_off_json, []);
      return {
        id: row.id,
        entity_id: row.id,
        entity_type: "activity",
        integration_id: row.integration_id || "uc:core",
        local_id: localEntityId(row.integration_id || "uc:core", row.id),
        name: { en: row.name },
        display_name: row.name,
        icon: row.icon,
        description: row.description ? { en: row.description } : undefined,
        features: Array.isArray(options.features) && options.features.length
          ? options.features
          : off.length ? ["on_off"] : ["start"],
        state: row.state,
        attributes: { ...parseJson(row.attributes_json, {}), state: row.state },
        entities: options.included_entities,
        options: {
          editable: true,
          ...options,
          sequences: options.sequences || { on, off }
        },
        sequence_on: on,
        sequence_off: off,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    });
  }

  getActivity(id) { return this.listActivities().find((item) => item.id === id) || null; }

  saveActivity(input) {
    const timestamp = nowIso();
    const id = slug(input.id || input.entity_id || displayName(input.name) || randomId("activity-"), "activity");
    const existing = this.getActivity(id);
    const integrationId = String(input.integration_id || existing?.integration_id || "uc:core");
    const attributes = { ...(existing?.attributes || {}), ...(input.attributes || {}) };
    const options = { ...(existing?.options || {}), ...(input.options || {}) };
    options.button_mapping = normalizeButtonMappings(options.button_mapping);
    options.user_interface = normalizeActivityUserInterface(options.user_interface);
    const explicitEntities = Array.isArray(input.options?.included_entities)
      ? input.options.included_entities
      : Array.isArray(input.entities)
        ? input.entities
        : Array.isArray(input.included_entities)
          ? input.included_entities
          : null;
    if (Array.isArray(input.options?.entity_ids)) {
      options.included_entities = input.options.entity_ids.map((entityId) => this.#includedEntity(entityId));
      delete options.entity_ids;
    } else if (explicitEntities) {
      options.included_entities = explicitEntities.map((entity) => {
        const current = typeof entity === "string" ? { entity_id: entity } : entity;
        return this.#includedEntity(current?.entity_id || current?.id, current);
      });
    }
    delete options.entities;
    const sequences = input.options?.sequences || {};
    const on = input.sequence_on ?? sequences.on ?? existing?.sequence_on ?? [];
    const off = input.sequence_off ?? sequences.off ?? existing?.sequence_off ?? [];
    this.db.prepare(`
      INSERT INTO activities (id,name,icon,description,state,options_json,sequence_on_json,sequence_off_json,created_at,updated_at,integration_id,attributes_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,icon=excluded.icon,description=excluded.description,options_json=excluded.options_json,
        sequence_on_json=excluded.sequence_on_json,sequence_off_json=excluded.sequence_off_json,
        integration_id=excluded.integration_id,attributes_json=excluded.attributes_json,updated_at=excluded.updated_at
    `).run(
      id, displayName(input.name, existing?.display_name || id), input.icon ?? existing?.icon ?? null,
      displayName(input.description, displayName(existing?.description, "")) || null, input.attributes?.state || existing?.state || "OFF", jsonString(options), jsonString(on), jsonString(off),
      existing?.created_at || timestamp, timestamp, integrationId, jsonString(attributes)
    );
    return this.getActivity(id);
  }

  setActivityState(id, state) {
    this.db.prepare("UPDATE activities SET state=?,updated_at=? WHERE id=?").run(String(state), nowIso(), id);
    return this.getActivity(id);
  }
  updateActivityAttributes(id, attributes = {}) {
    const existing = this.getActivity(id);
    if (!existing) return null;
    const merged = { ...(existing.attributes || {}), ...(attributes || {}) };
    const state = String(merged.state || existing.state || "OFF");
    merged.state = state;
    this.db.prepare("UPDATE activities SET state=?,attributes_json=?,updated_at=? WHERE id=?")
      .run(state, jsonString(merged), nowIso(), id);
    return this.getActivity(id);
  }
  deleteActivity(id) { return this.db.prepare("DELETE FROM activities WHERE id=?").run(id).changes > 0; }
  deleteAllActivities() { return this.db.prepare("DELETE FROM activities").run().changes; }

  listMacros() {
    return this.db.prepare("SELECT * FROM macros ORDER BY name COLLATE NOCASE").all().map((row) => {
      const sequence = parseJson(row.sequence_json, []);
      const options = parseJson(row.options_json, {});
      options.included_entities = this.#enrichIncludedEntities(options.included_entities);
      return {
        id: row.id,
        entity_id: row.id,
        entity_type: "macro",
        integration_id: row.integration_id || "uc:core",
        local_id: localEntityId(row.integration_id || "uc:core", row.id),
        name: { en: row.name },
        display_name: row.name,
        icon: row.icon,
        description: row.description ? { en: row.description } : undefined,
        features: ["start"],
        sequence,
        options: { editable: true, ...options, sequence },
        attributes: parseJson(row.attributes_json, {}),
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    });
  }

  getMacro(id) { return this.listMacros().find((item) => item.id === id) || null; }
  saveMacro(input) {
    const timestamp = nowIso();
    const id = slug(input.id || input.entity_id || displayName(input.name) || randomId("macro-"), "macro");
    const existing = this.getMacro(id);
    const integrationId = String(input.integration_id || existing?.integration_id || "uc:core");
    const attributes = { ...(existing?.attributes || {}), ...(input.attributes || {}) };
    const sequence = input.sequence ?? input.options?.sequence ?? existing?.sequence ?? [];
    const explicitEditable = Object.prototype.hasOwnProperty.call(input.options || {}, "editable")
      ? Boolean(input.options.editable)
      : undefined;
    const options = { ...(existing?.options || {}), ...(input.options || {}) };
    options.button_mapping = normalizeButtonMappings(options.button_mapping);
    if (Array.isArray(input.options?.entity_ids)) {
      options.included_entities = input.options.entity_ids.map((entityId) => this.#includedEntity(entityId));
      delete options.entity_ids;
    }
    delete options.sequence;
    delete options.editable;
    if (explicitEditable !== undefined) options.editable = explicitEditable;
    this.db.prepare(`
      INSERT INTO macros (id,name,icon,description,options_json,sequence_json,created_at,updated_at,integration_id,attributes_json)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,icon=excluded.icon,description=excluded.description,
        options_json=excluded.options_json,sequence_json=excluded.sequence_json,integration_id=excluded.integration_id,
        attributes_json=excluded.attributes_json,updated_at=excluded.updated_at
    `).run(id, displayName(input.name, existing?.display_name || id), input.icon ?? existing?.icon ?? null,
      displayName(input.description, displayName(existing?.description, "")) || null, jsonString(options),
      jsonString(sequence), existing?.created_at || timestamp, timestamp, integrationId, jsonString(attributes));
    return this.getMacro(id);
  }
  updateMacroAttributes(id, attributes = {}) {
    const existing = this.getMacro(id);
    if (!existing) return null;
    const merged = { ...(existing.attributes || {}), ...(attributes || {}) };
    this.db.prepare("UPDATE macros SET attributes_json=?,updated_at=? WHERE id=?").run(jsonString(merged), nowIso(), id);
    return this.getMacro(id);
  }
  deleteMacro(id) { return this.db.prepare("DELETE FROM macros WHERE id=?").run(id).changes > 0; }
  deleteAllMacros() { return this.db.prepare("DELETE FROM macros").run().changes; }

  listProfiles() {
    return this.db.prepare("SELECT * FROM profiles ORDER BY name COLLATE NOCASE").all().map((row) => ({
      id: row.id,
      profile_id: row.id,
      name: row.name,
      icon: row.icon || undefined,
      restricted: bool(row.restricted),
      description: row.description || undefined,
      active: bool(row.active),
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  getProfile(id) {
    const profile = this.listProfiles().find((item) => item.id === id);
    return profile ? { ...profile, pages: this.listPages(id), groups: this.listGroups(id) } : null;
  }

  saveProfile(input) {
    const timestamp = nowIso();
    const id = slug(input.id || input.profile_id || displayName(input.name) || randomId("profile-"), "profile");
    const existing = this.getProfile(id);
    this.db.prepare(`
      INSERT INTO profiles (id,name,active,icon,restricted,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,icon=excluded.icon,restricted=excluded.restricted,description=excluded.description,updated_at=excluded.updated_at
    `).run(
      id, String(input.name || existing?.name || id), existing?.active ? 1 : (input.active ? 1 : 0),
      input.icon ?? existing?.icon ?? null, (input.restricted ?? existing?.restricted) ? 1 : 0,
      input.description ?? existing?.description ?? null, existing?.created_at || timestamp, timestamp
    );
    return this.getProfile(id);
  }

  setActiveProfile(id) {
    if (!this.getProfile(id)) throw Object.assign(new Error(`Profile ${id} not found`), { status: 404 });
    this.db.exec("BEGIN");
    try {
      this.db.prepare("UPDATE profiles SET active=0").run();
      this.db.prepare("UPDATE profiles SET active=1,updated_at=? WHERE id=?").run(nowIso(), id);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.getProfile(id);
  }

  deleteProfile(id) {
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM profiles").get().count;
    if (count <= 1) throw Object.assign(new Error("The final profile cannot be deleted"), { status: 409 });
    const profile = this.getProfile(id);
    if (!profile) return false;
    const deleted = this.db.prepare("DELETE FROM profiles WHERE id=?").run(id).changes > 0;
    if (profile.active) this.setActiveProfile(this.listProfiles()[0].id);
    return deleted;
  }

  deleteAllProfiles() {
    this.db.prepare("DELETE FROM profiles").run();
    this.#seed();
    return this.listProfiles();
  }

  listPages(profileId = null) {
    const rows = profileId
      ? this.db.prepare("SELECT * FROM pages WHERE profile_id=? ORDER BY sort_order,name COLLATE NOCASE").all(profileId)
      : this.db.prepare("SELECT * FROM pages ORDER BY profile_id,sort_order,name COLLATE NOCASE").all();
    return rows.map((row) => {
      const items = pageItems(parseJson(row.elements_json, []));
      return {
        id: row.id,
        page_id: row.id,
        profile_id: row.profile_id,
        name: row.name,
        image: row.image || undefined,
        pos: Number(row.sort_order),
        sort_order: Number(row.sort_order),
        columns: Number(row.columns_count),
        rows: Number(row.rows_count),
        items,
        elements: items,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    });
  }

  getPage(id) { return this.listPages().find((item) => item.id === id) || null; }
  savePage(input) {
    const timestamp = nowIso();
    const id = slug(input.id || input.page_id || displayName(input.name) || randomId("page-"), "page");
    const existing = this.getPage(id);
    const profileId = String(input.profile_id || existing?.profile_id || "default");
    if (!this.getProfile(profileId)) throw Object.assign(new Error(`Profile ${profileId} does not exist`), { status: 404 });
    const items = pageItems(input.items ?? input.elements ?? existing?.items ?? []);
    this.db.prepare(`
      INSERT INTO pages (id,profile_id,name,sort_order,columns_count,rows_count,elements_json,image,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        profile_id=excluded.profile_id,name=excluded.name,sort_order=excluded.sort_order,
        columns_count=excluded.columns_count,rows_count=excluded.rows_count,elements_json=excluded.elements_json,
        image=excluded.image,updated_at=excluded.updated_at
    `).run(
      id, profileId, String(input.name || existing?.name || id), Number(input.pos ?? input.sort_order ?? existing?.pos ?? 0),
      Number(input.columns ?? existing?.columns ?? 4), Number(input.rows ?? existing?.rows ?? 7), jsonString(items),
      input.image ?? existing?.image ?? null, existing?.created_at || timestamp, timestamp
    );
    return this.getPage(id);
  }
  deletePage(id) { return this.db.prepare("DELETE FROM pages WHERE id=?").run(id).changes > 0; }
  deletePagesInProfile(profileId) { return this.db.prepare("DELETE FROM pages WHERE profile_id=?").run(profileId).changes; }

  listGroups(profileId = null) {
    const rows = profileId
      ? this.db.prepare("SELECT * FROM profile_groups WHERE profile_id=? ORDER BY name COLLATE NOCASE").all(profileId)
      : this.db.prepare("SELECT * FROM profile_groups ORDER BY profile_id,name COLLATE NOCASE").all();
    return rows.map((row) => ({
      id: row.id,
      group_id: row.id,
      profile_id: row.profile_id,
      name: row.name,
      icon: row.icon || undefined,
      description: row.description || undefined,
      entities: parseJson(row.entities_json, []),
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }
  getGroup(id) { return this.listGroups().find((item) => item.id === id) || null; }
  saveGroup(input) {
    const timestamp = nowIso();
    const id = slug(input.id || input.group_id || displayName(input.name) || randomId("group-"), "group");
    const existing = this.getGroup(id);
    const profileId = String(input.profile_id || existing?.profile_id || "default");
    if (!this.getProfile(profileId)) throw Object.assign(new Error(`Profile ${profileId} does not exist`), { status: 404 });
    this.db.prepare(`
      INSERT INTO profile_groups (id,profile_id,name,icon,description,entities_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET profile_id=excluded.profile_id,name=excluded.name,icon=excluded.icon,
        description=excluded.description,entities_json=excluded.entities_json,updated_at=excluded.updated_at
    `).run(id, profileId, String(input.name || existing?.name || id), input.icon ?? existing?.icon ?? null,
      input.description ?? existing?.description ?? null, jsonString(input.entities ?? existing?.entities ?? []),
      existing?.created_at || timestamp, timestamp);
    return this.getGroup(id);
  }
  deleteGroup(id) { return this.db.prepare("DELETE FROM profile_groups WHERE id=?").run(id).changes > 0; }
  deleteGroupsInProfile(profileId) { return this.db.prepare("DELETE FROM profile_groups WHERE profile_id=?").run(profileId).changes; }

  listActivityGroups() {
    return this.db.prepare("SELECT * FROM activity_groups ORDER BY name COLLATE NOCASE").all().map((row) => ({
      id: row.id,
      group_id: row.id,
      name: languageText(row.name),
      display_name: row.name,
      icon: row.icon || undefined,
      description: parseJson(row.description_json, {}),
      options: parseJson(row.options_json, {}),
      activities: parseJson(row.activities_json, []),
      state: row.state,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }
  getActivityGroup(id) { return this.listActivityGroups().find((item) => item.id === id) || null; }
  saveActivityGroup(input) {
    const timestamp = nowIso();
    const id = slug(input.id || input.group_id || displayName(input.name) || randomId("activity-group-"), "activity-group");
    const existing = this.getActivityGroup(id);
    const activities = Array.isArray(input.activity_ids)
      ? input.activity_ids.map((activityId) => {
          const activity = this.getActivity(activityId);
          return activity ? { entity_id: activity.entity_id, name: activity.name, icon: activity.icon } : { entity_id: activityId };
        })
      : (input.activities ?? existing?.activities ?? []);
    this.db.prepare(`
      INSERT INTO activity_groups (id,name,icon,description_json,options_json,activities_json,state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,icon=excluded.icon,description_json=excluded.description_json,
        options_json=excluded.options_json,activities_json=excluded.activities_json,updated_at=excluded.updated_at
    `).run(id, displayName(input.name, existing?.display_name || id), input.icon ?? existing?.icon ?? null,
      jsonString(input.description ?? existing?.description ?? {}), jsonString(input.options ?? existing?.options ?? {}),
      jsonString(activities), input.state || existing?.state || "OFF",
      existing?.created_at || timestamp, timestamp);
    const saved = this.getActivityGroup(id);
    const assigned = new Set((saved.activities || []).map((item) => item.entity_id || item));
    for (const activity of this.listActivities()) {
      const currentGroup = activity.options?.activity_group?.group_id;
      if (assigned.has(activity.id)) {
        this.saveActivity({ id: activity.id, options: { ...activity.options, activity_group: { group_id: saved.group_id, name: saved.name, icon: saved.icon } } });
      } else if (currentGroup === saved.group_id) {
        const options = { ...activity.options };
        delete options.activity_group;
        this.saveActivity({ id: activity.id, options });
      }
    }
    return this.getActivityGroup(id);
  }
  deleteActivityGroup(id) { return this.db.prepare("DELETE FROM activity_groups WHERE id=?").run(id).changes > 0; }
  deleteAllActivityGroups() { return this.db.prepare("DELETE FROM activity_groups").run().changes; }

  createExecution(kind, targetId, totalSteps) {
    const record = {
      id: randomId("exec-"), kind, target_id: targetId, status: "RUNNING",
      current_step: 0, total_steps: Number(totalSteps || 0), error: null,
      started_at: nowIso(), finished_at: null
    };
    this.db.prepare(`
      INSERT INTO executions (id,kind,target_id,status,current_step,total_steps,error,started_at,finished_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(record.id, record.kind, record.target_id, record.status, record.current_step, record.total_steps, null, record.started_at, null);
    return record;
  }
  updateExecution(id, patch) {
    const existing = this.db.prepare("SELECT * FROM executions WHERE id=?").get(id);
    if (!existing) return null;
    const value = { ...existing, ...patch };
    this.db.prepare("UPDATE executions SET status=?,current_step=?,total_steps=?,error=?,finished_at=? WHERE id=?")
      .run(value.status, value.current_step, value.total_steps, value.error || null, value.finished_at || null, id);
    return this.db.prepare("SELECT * FROM executions WHERE id=?").get(id);
  }
  listExecutions(limit = 50) { return this.db.prepare("SELECT * FROM executions ORDER BY started_at DESC LIMIT ?").all(Number(limit)); }

  #apiKeyRow(row) {
    if (!row) return null;
    return {
      id: row.id, key_id: row.id, name: row.name, scopes: parseJson(row.scopes_json, []),
      active: Boolean(Number(row.active)), valid_to: row.valid_to || null,
      description: row.description || null, created_at: row.created_at, creation_date: row.created_at
    };
  }

  createApiKey(name, keyHash, scopes = ["admin"], options = {}) {
    const value = {
      id: randomId("key-"), name: String(name || "API key"), key_hash: keyHash,
      scopes_json: jsonString(scopes), active: options.active === false ? 0 : 1,
      valid_to: options.valid_to || null, description: options.description || null, created_at: nowIso()
    };
    this.db.prepare("INSERT INTO api_keys (id,name,key_hash,scopes_json,active,valid_to,description,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(value.id, value.name, value.key_hash, value.scopes_json, value.active, value.valid_to, value.description, value.created_at);
    return this.#apiKeyRow(value);
  }
  findApiKey(keyHash) {
    const row = this.db.prepare("SELECT * FROM api_keys WHERE key_hash=?").get(keyHash);
    if (!row || !Number(row.active)) return null;
    if (row.valid_to && Date.parse(row.valid_to) <= Date.now()) return null;
    return this.#apiKeyRow(row);
  }
  getApiKey(id) { return this.#apiKeyRow(this.db.prepare("SELECT * FROM api_keys WHERE id=?").get(id)); }
  listApiKeys() {
    return this.db.prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all().map((row) => this.#apiKeyRow(row));
  }
  updateApiKey(id, patch = {}) {
    const current = this.db.prepare("SELECT * FROM api_keys WHERE id=?").get(id);
    if (!current) return null;
    const next = {
      ...current,
      name: patch.name === undefined ? current.name : String(patch.name || "API key"),
      active: patch.active === undefined ? current.active : (patch.active ? 1 : 0),
      valid_to: patch.valid_to === undefined ? current.valid_to : (patch.valid_to || null),
      description: patch.description === undefined ? current.description : (patch.description || null)
    };
    this.db.prepare("UPDATE api_keys SET name=?,active=?,valid_to=?,description=? WHERE id=?")
      .run(next.name, next.active, next.valid_to, next.description, id);
    return this.getApiKey(id);
  }
  deleteApiKey(id) { return this.db.prepare("DELETE FROM api_keys WHERE id=?").run(id).changes > 0; }
  deleteAllApiKeys() { return this.db.prepare("DELETE FROM api_keys").run().changes; }

  saveExternalAccessToken(system, input = {}, tokenId = null) {
    const normalizedSystem = String(system || "").trim();
    if (!normalizedSystem) throw Object.assign(new Error("External system is required"), { status: 400 });
    const id = String(tokenId || input.token_id || randomId("token-")).trim();
    if (!id) throw Object.assign(new Error("External token identifier is required"), { status: 400 });
    const existing = this.getExternalAccessToken(normalizedSystem, id);
    const creationDate = existing?.creation_date || nowIso();
    const value = {
      system: normalizedSystem, token_id: id,
      name: String(input.name ?? existing?.name ?? normalizedSystem),
      token: String(input.token ?? existing?.token ?? ""),
      description: input.description ?? existing?.description ?? null,
      url: input.url ?? existing?.url ?? null, data: input.data ?? existing?.data ?? null,
      creation_date: creationDate, updated_at: nowIso()
    };
    if (!value.token) throw Object.assign(new Error("External access token is required"), { status: 400 });
    this.db.prepare(`
      INSERT INTO external_access_tokens (system,token_id,name,token,description,url,data,creation_date,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(system,token_id) DO UPDATE SET
        name=excluded.name,token=excluded.token,description=excluded.description,url=excluded.url,data=excluded.data,updated_at=excluded.updated_at
    `).run(value.system, value.token_id, value.name, value.token, value.description, value.url, value.data, value.creation_date, value.updated_at);
    return this.getExternalAccessToken(value.system, value.token_id);
  }
  listExternalAccessTokens(system = null) {
    const rows = system
      ? this.db.prepare("SELECT * FROM external_access_tokens WHERE system=? ORDER BY creation_date").all(String(system))
      : this.db.prepare("SELECT * FROM external_access_tokens ORDER BY system,creation_date").all();
    return rows.map((row) => ({ ...row }));
  }
  listExternalSystems() {
    const rows = this.db.prepare("SELECT system,MIN(name) AS name,COUNT(*) AS count FROM external_access_tokens GROUP BY system ORDER BY system").all();
    return rows.map((row) => ({ system: row.system, name: row.name || row.system, tokens: Number(row.count) }));
  }
  getExternalAccessToken(system, tokenId) {
    const row = this.db.prepare("SELECT * FROM external_access_tokens WHERE system=? AND token_id=?").get(String(system), String(tokenId));
    return row ? { ...row } : null;
  }
  deleteExternalAccessToken(system, tokenId) {
    return this.db.prepare("DELETE FROM external_access_tokens WHERE system=? AND token_id=?").run(String(system), String(tokenId)).changes > 0;
  }
  deleteExternalAccessTokens(system = null) {
    return system
      ? this.db.prepare("DELETE FROM external_access_tokens WHERE system=?").run(String(system)).changes
      : this.db.prepare("DELETE FROM external_access_tokens").run().changes;
  }

  #resourceDirectory(type) {
    const value = String(type || "").replace(/[^a-zA-Z]/g, "").toLowerCase();
    if (!value) throw Object.assign(new Error("Invalid resource type"), { status: 400 });
    const directory = path.join(this.resourcesDir, value);
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  listResources(type = null, includeData = false) {
    const rows = type
      ? this.db.prepare("SELECT * FROM resources WHERE type=? ORDER BY id").all(type)
      : this.db.prepare("SELECT * FROM resources ORDER BY type,id").all();
    return rows.map((row) => {
      const item = {
        type: row.type,
        id: row.id,
        identifier: `custom:${row.id}`,
        filename: row.filename,
        mime_type: row.mime_type,
        metadata: parseJson(row.metadata_json, {}),
        created_at: row.created_at,
        url: `/api/resources/${encodeURIComponent(row.type)}/${encodeURIComponent(row.id)}/content`
      };
      if (includeData) {
        const filename = path.join(this.#resourceDirectory(row.type), row.filename);
        if (fs.existsSync(filename)) item.data_base64 = fs.readFileSync(filename).toString("base64");
      }
      return item;
    });
  }

  getResource(type, id) {
    const row = this.db.prepare("SELECT * FROM resources WHERE type=? AND id=?").get(type, id);
    if (!row) return null;
    const filename = path.join(this.#resourceDirectory(row.type), row.filename);
    return {
      type: row.type, id: row.id, identifier: `custom:${row.id}`, filename: row.filename,
      mime_type: row.mime_type, metadata: parseJson(row.metadata_json, {}), created_at: row.created_at,
      path: filename, size: fs.existsSync(filename) ? fs.statSync(filename).size : 0,
      url: `/api/resources/${encodeURIComponent(row.type)}/${encodeURIComponent(row.id)}/content`
    };
  }

  saveResource({ type, id, filename, mime_type, metadata = {}, data }) {
    const timestamp = nowIso();
    const existing = this.getResource(type, id);
    if (existing) throw Object.assign(new Error(`Resource ${id} already exists`), { status: 422 });
    const directory = this.#resourceDirectory(type);
    const safeFilename = path.basename(filename || id);
    const target = path.join(directory, safeFilename);
    fs.writeFileSync(target, data, { flag: "wx" });
    try {
      this.db.prepare("INSERT INTO resources (type,id,filename,mime_type,metadata_json,created_at) VALUES (?,?,?,?,?,?)")
        .run(type, id, safeFilename, mime_type, jsonString(metadata), timestamp);
    } catch (error) {
      try { fs.unlinkSync(target); } catch {}
      throw error;
    }
    return this.getResource(type, id);
  }

  deleteResource(type, id) {
    const existing = this.getResource(type, id);
    if (!existing) return false;
    this.db.prepare("DELETE FROM resources WHERE type=? AND id=?").run(type, id);
    try { fs.unlinkSync(existing.path); } catch {}
    return true;
  }

  deleteResources(type = null) {
    const items = this.listResources(type);
    for (const item of items) this.deleteResource(item.type, item.id);
    return items.length;
  }

  supportedResourceTypes() {
    return [...new Set(["icon", "background", ...this.listResources().map((item) => item.type)])];
  }

  exportData() {
    return {
      format: "uc-virtual-remote-backup-v4",
      created_at: nowIso(),
      source_versions: {
        rest_core_api: "0.32.0",
        websocket_core_api: "0.25.0-beta",
        integration_api: "0.10.0-beta",
        remote_ui: "0.38.4"
      },
      settings: Object.fromEntries(this.db.prepare("SELECT key,value_json FROM settings").all().map((row) => [row.key, parseJson(row.value_json)])),
      integrations: this.listIntegrations(),
      available_entities: this.listAvailableEntities(),
      configured_entities: this.listConfiguredEntities(),
      activities: this.listActivities(),
      macros: this.listMacros(),
      activity_groups: this.listActivityGroups(),
      profiles: this.listProfiles(),
      pages: this.listPages(),
      groups: this.listGroups(),
      resources: this.listResources(null, true),
      media_queues: this.db.prepare("SELECT * FROM media_queues ORDER BY entity_id").all().map((row) => ({
        entity_id: row.entity_id,
        items: parseJson(row.items_json, []),
        position: Number(row.position || 0),
        repeat_mode: row.repeat_mode || "OFF",
        shuffle: Boolean(row.shuffle),
        updated_at: row.updated_at
      })),
      docks: this.db.prepare("SELECT config_json FROM docks ORDER BY id").all().map((row) => parseJson(row.config_json, {})),
      custom_ir_code_sets: this.db.prepare("SELECT * FROM ir_code_sets WHERE kind='CUSTOM' ORDER BY id").all().map((row) => ({
        code_set_id: row.id,
        name: row.name,
        metadata: parseJson(row.metadata_json, {}),
        codes: parseJson(row.codes_json, {})
      }))
    };
  }

  importData(payload, options = {}) {
    if (!["uc-virtual-remote-backup-v1", "uc-virtual-remote-backup-v2", "uc-virtual-remote-backup-v3", "uc-virtual-remote-backup-v4"].includes(payload?.format)) {
      throw Object.assign(new Error("Unsupported backup format"), { status: 400 });
    }
    const merge = Boolean(options.merge);
    if (!merge) this.deleteResources();
    this.db.exec("BEGIN");
    try {
      if (!merge) for (const table of [
        "media_sessions", "media_queues", "dock_output_log", "dock_updates", "dock_setups", "ir_learn_sessions",
        "ir_code_sets", "docks", "resources", "profile_groups", "pages", "profiles", "activity_groups", "macros", "activities",
        "configured_entities", "available_entities", "integrations", "settings"
      ]) this.db.prepare(`DELETE FROM ${table}`).run();
      for (const [key, value] of Object.entries(payload.settings || {})) this.setSetting(key, value);
      for (const integration of payload.integrations || []) this.saveIntegration(integration);
      for (const entity of payload.available_entities || []) this.upsertAvailableEntity(entity.integration_id, entity);
      for (const entity of payload.configured_entities || []) {
        const source = this.getAvailableEntity(entity.integration_id, entity.local_id);
        if (source) {
          this.configureEntity(entity.integration_id, entity.local_id, entity);
          this.updateEntityAttributes(entity.entity_id || entity.id, entity.attributes || {});
        }
      }
      for (const activity of payload.activities || []) {
        const saved = this.saveActivity(activity);
        const state = activity.state || activity.attributes?.state || "OFF";
        this.setActivityState(saved.id, typeof state === "string" ? state : "OFF");
      }
      for (const macro of payload.macros || []) this.saveMacro(macro);
      for (const group of payload.activity_groups || []) this.saveActivityGroup(group);
      for (const profile of payload.profiles || []) this.saveProfile(profile);
      for (const page of payload.pages || []) this.savePage(page);
      for (const group of payload.groups || []) this.saveGroup(group);
      for (const resource of payload.resources || []) {
        if (!resource.data_base64) continue;
        if (merge && this.getResource(resource.type, resource.id)) this.deleteResource(resource.type, resource.id);
        this.saveResource({
          type: resource.type,
          id: resource.id,
          filename: resource.filename || resource.id,
          mime_type: resource.mime_type || "application/octet-stream",
          metadata: resource.metadata || {},
          data: Buffer.from(resource.data_base64, "base64")
        });
      }
      for (const queue of payload.media_queues || []) {
        this.db.prepare("INSERT OR REPLACE INTO media_queues (entity_id,items_json,position,repeat_mode,shuffle,updated_at) VALUES (?,?,?,?,?,?)")
          .run(queue.entity_id, jsonString(queue.items || []), Number(queue.position || 0), queue.repeat_mode || "OFF", queue.shuffle ? 1 : 0, queue.updated_at || nowIso());
      }
      for (const dock of payload.docks || []) {
        const id = String(dock.dock_id || dock.id || randomId("dock-"));
        this.db.prepare("INSERT OR REPLACE INTO docks (id,active,config_json,created_at,updated_at) VALUES (?,?,?,?,?)")
          .run(id, dock.active === false ? 0 : 1, jsonString({ ...dock, id, dock_id: id }), dock.created_at || nowIso(), dock.updated_at || nowIso());
      }
      for (const codeSet of payload.custom_ir_code_sets || []) {
        const id = String(codeSet.code_set_id || codeSet.id || randomId("codeset-"));
        this.db.prepare("INSERT OR REPLACE INTO ir_code_sets (id,kind,manufacturer_id,name,metadata_json,codes_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
          .run(id, "CUSTOM", null, codeSet.name || id, jsonString(codeSet.metadata || {}), jsonString(codeSet.codes || {}), codeSet.created_at || nowIso(), codeSet.updated_at || nowIso());
      }
      const active = (payload.profiles || []).find((profile) => profile.active);
      if (active) {
        this.db.prepare("UPDATE profiles SET active=0").run();
        this.db.prepare("UPDATE profiles SET active=1,updated_at=? WHERE id=?").run(nowIso(), active.id || active.profile_id);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.#seed();
    return this.exportData();
  }
}
