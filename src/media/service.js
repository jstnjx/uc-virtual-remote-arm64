import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { nowIso, parseJson } from "../shared/util.js";
import { logger } from "../shared/logger.js";

const log = logger("media-service");
const DEFAULT_CACHE_TTL = 60_000;
const ARTWORK_CACHE_TTL = 24 * 60 * 60 * 1000;
const MAX_ARTWORK_BYTES = 16 * 1024 * 1024;

function stableHash(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function pageInput(query = {}) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.max(1, Math.min(500, Number(query.limit || 50)));
  return { page, limit };
}

function slice(items, query = {}, reportedCount = null) {
  const { page, limit } = pageInput(query);
  const values = Array.isArray(items) ? items : [];
  const hasReportedCount = reportedCount !== null && reportedCount !== undefined && reportedCount !== "";
  const count = hasReportedCount && Number.isFinite(Number(reportedCount)) ? Number(reportedCount) : values.length;
  const alreadyPaged = count > values.length || (page > 1 && values.length <= limit);
  return {
    items: alreadyPaged ? values : values.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, count }
  };
}

function mediaPayload(value) {
  if (!value || typeof value !== "object") return {};
  return value.msg_data ?? value;
}

function mediaItems(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["items", "media_items", "results", "media_search"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function mimeExtension(mime = "") {
  return ({
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg"
  })[String(mime).split(";")[0].toLowerCase()] || ".bin";
}

export class MediaService {
  constructor(platform) {
    this.platform = platform;
    this.db = platform.db.db;
    this.directory = platform.db.mediaDir;
    fs.mkdirSync(this.directory, { recursive: true });
  }

  async browse(entityId, query = {}) {
    const key = this.#cacheKey("browse", entityId, query);
    const cached = this.#getCached(key);
    if (cached) return cached;
    const raw = await this.platform.integrations.browseMedia(entityId, query);
    const payload = mediaPayload(raw);
    const root = payload.media && typeof payload.media === "object" ? payload.media : payload;
    const originalItems = mediaItems(root);
    const count = payload.paging?.count ?? payload.pagination?.count ?? root.paging?.count ?? root.pagination?.count;
    const paged = slice(originalItems, query, count);
    const media = await this.#decorate({ ...root, items: paged.items });
    const result = { media, pagination: paged.pagination };
    this.#setCached(key, entityId, "browse", query, result, paged.pagination.count);
    return result;
  }

  async search(entityId, query = {}) {
    const key = this.#cacheKey("search", entityId, query);
    const cached = this.#getCached(key);
    if (cached) return cached;
    const raw = await this.platform.integrations.searchMedia(entityId, query);
    const payload = mediaPayload(raw);
    const values = mediaItems(payload);
    const count = payload.paging?.count ?? payload.pagination?.count;
    const paged = slice(values, query, count);
    const items = await Promise.all(paged.items.map((item) => this.#decorate(item)));
    const result = { items, pagination: paged.pagination };
    this.#setCached(key, entityId, "search", query, result, paged.pagination.count);
    return result;
  }

  clearEntityCache(entityId) {
    this.db.prepare("DELETE FROM media_cache WHERE entity_id=?").run(entityId);
  }

  getQueue(entityId) {
    const row = this.db.prepare("SELECT * FROM media_queues WHERE entity_id=?").get(entityId);
    if (!row) return { entity_id: entityId, items: [], position: 0, repeat_mode: "OFF", shuffle: false, updated_at: null };
    return {
      entity_id: row.entity_id,
      items: parseJson(row.items_json, []),
      position: Number(row.position || 0),
      repeat_mode: row.repeat_mode || "OFF",
      shuffle: Boolean(row.shuffle),
      updated_at: row.updated_at
    };
  }

  setQueue(entityId, input = {}) {
    const current = this.getQueue(entityId);
    const value = {
      entity_id: entityId,
      items: Array.isArray(input.items) ? input.items : current.items,
      position: Math.max(0, Number(input.position ?? current.position ?? 0)),
      repeat_mode: String(input.repeat_mode ?? current.repeat_mode ?? "OFF"),
      shuffle: Boolean(input.shuffle ?? current.shuffle),
      updated_at: nowIso()
    };
    this.db.prepare(`
      INSERT INTO media_queues (entity_id,items_json,position,repeat_mode,shuffle,updated_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(entity_id) DO UPDATE SET items_json=excluded.items_json,position=excluded.position,
        repeat_mode=excluded.repeat_mode,shuffle=excluded.shuffle,updated_at=excluded.updated_at
    `).run(value.entity_id, JSON.stringify(value.items), value.position, value.repeat_mode, value.shuffle ? 1 : 0, value.updated_at);
    this.platform.events.publish("media.queue", value);
    return value;
  }

  clearQueue(entityId) {
    this.db.prepare("DELETE FROM media_queues WHERE entity_id=?").run(entityId);
    const value = this.getQueue(entityId);
    this.platform.events.publish("media.queue", value);
    return value;
  }

  session(event = {}) {
    const id = String(event.session_id || event.id || `${event.integration_id || "media"}:${event.entity_id || "session"}`);
    const value = { ...event, id, updated_at: nowIso() };
    this.db.prepare(`
      INSERT INTO media_sessions (id,integration_id,entity_id,kind,state_json,updated_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET integration_id=excluded.integration_id,entity_id=excluded.entity_id,
        kind=excluded.kind,state_json=excluded.state_json,updated_at=excluded.updated_at
    `).run(id, event.integration_id || null, event.entity_id || null, event.kind || event.source_event || "MEDIA", JSON.stringify(value), value.updated_at);
    return value;
  }

  listSessions() {
    return this.db.prepare("SELECT state_json FROM media_sessions ORDER BY updated_at DESC").all().map((row) => parseJson(row.state_json, {}));
  }

  artworkRecord(id) {
    const row = this.db.prepare("SELECT * FROM media_artwork WHERE id=?").get(id);
    if (!row) return null;
    return { ...row, path: path.join(this.directory, row.filename) };
  }

  async resolveArtwork(id) {
    const record = this.artworkRecord(id);
    if (!record) return null;
    if (fs.existsSync(record.path) && Number(record.expires_at || 0) > Date.now()) return record;
    if (!record.source_url) return fs.existsSync(record.path) ? record : null;
    let url;
    try { url = new URL(record.source_url); } catch { return null; }
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: record.etag ? { "If-None-Match": record.etag } : {} });
      if (response.status === 304 && fs.existsSync(record.path)) {
        this.db.prepare("UPDATE media_artwork SET expires_at=?,updated_at=? WHERE id=?").run(Date.now() + ARTWORK_CACHE_TTL, nowIso(), id);
        return this.artworkRecord(id);
      }
      if (!response.ok) throw new Error(`Artwork request returned HTTP ${response.status}`);
      const mime = String(response.headers.get("content-type") || "application/octet-stream").split(";")[0].toLowerCase();
      if (!mime.startsWith("image/")) throw new Error(`Unsupported artwork MIME type ${mime}`);
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > MAX_ARTWORK_BYTES) throw new Error("Artwork is too large");
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > MAX_ARTWORK_BYTES) throw new Error("Artwork is too large");
      const filename = `${id}${mimeExtension(mime)}`;
      const target = path.join(this.directory, filename);
      fs.writeFileSync(target, data);
      if (record.filename !== filename) fs.rmSync(record.path, { force: true });
      this.db.prepare("UPDATE media_artwork SET filename=?,mime_type=?,etag=?,size=?,expires_at=?,updated_at=? WHERE id=?")
        .run(filename, mime, response.headers.get("etag"), data.length, Date.now() + ARTWORK_CACHE_TTL, nowIso(), id);
      return this.artworkRecord(id);
    } catch (error) {
      log.warn(`Unable to cache artwork ${record.source_url}:`, error.message);
      return fs.existsSync(record.path) ? record : null;
    } finally { clearTimeout(timer); }
  }

  async #decorate(value) {
    if (!value || typeof value !== "object") return value;
    const result = { ...value };
    for (const key of ["thumbnail", "image", "image_url", "media_image_url", "artwork_url"]) {
      if (typeof result[key] === "string" && result[key]) result[key] = this.#registerArtwork(result[key]);
    }
    for (const [dataKey, mimeKey, targetKey] of [
      ["thumbnail_data", "thumbnail_mime_type", "thumbnail"],
      ["image_data", "image_mime_type", "image_url"],
      ["artwork_data", "artwork_mime_type", "artwork_url"]
    ]) {
      if (typeof result[dataKey] === "string" && result[dataKey]) {
        result[targetKey] = this.#storeBinary(result[dataKey], result[mimeKey] || "image/png");
        delete result[dataKey];
      }
    }
    for (const [dataKey, mimeKey, targetKey] of [
      ["resource_data", "resource_mime_type", "resource_url"],
      ["binary_data", "binary_mime_type", "binary_url"]
    ]) {
      if (typeof result[dataKey] === "string" && result[dataKey]) {
        result[targetKey] = this.#storeBinary(result[dataKey], result[mimeKey] || "application/octet-stream", "resource");
        delete result[dataKey];
      }
    }
    if (Array.isArray(result.items)) result.items = await Promise.all(result.items.map((item) => this.#decorate(item)));
    return result;
  }

  #registerArtwork(sourceUrl) {
    if (sourceUrl.startsWith("/media/artwork/") || (!sourceUrl.startsWith("data:") && !/^https?:\/\//i.test(sourceUrl))) return sourceUrl;
    if (sourceUrl.startsWith("data:")) {
      const match = sourceUrl.match(/^data:([^;,]+);base64,(.+)$/s);
      if (!match) return sourceUrl;
      return this.#storeBinary(match[2], match[1]);
    }
    const id = stableHash(sourceUrl).slice(0, 32);
    const existing = this.artworkRecord(id);
    if (!existing) {
      this.db.prepare("INSERT INTO media_artwork (id,source_url,filename,mime_type,etag,size,expires_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
        .run(id, sourceUrl, `${id}.bin`, null, null, 0, 0, nowIso());
    }
    return `/media/artwork/${id}`;
  }

  #storeBinary(base64, mime, route = "artwork") {
    const data = Buffer.from(base64, "base64");
    if (data.length > MAX_ARTWORK_BYTES) return "";
    const id = stableHash(data).slice(0, 32);
    const filename = `${id}${mimeExtension(mime)}`;
    const target = path.join(this.directory, filename);
    if (!fs.existsSync(target)) fs.writeFileSync(target, data);
    this.db.prepare(`
      INSERT INTO media_artwork (id,source_url,filename,mime_type,etag,size,expires_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET filename=excluded.filename,mime_type=excluded.mime_type,
        size=excluded.size,expires_at=excluded.expires_at,updated_at=excluded.updated_at
    `).run(id, null, filename, mime, null, data.length, Number.MAX_SAFE_INTEGER, nowIso());
    return `/media/${route}/${id}`;
  }

  #cacheKey(kind, entityId, query) { return stableHash({ kind, entityId, query }); }

  #getCached(key) {
    const row = this.db.prepare("SELECT response_json,expires_at FROM media_cache WHERE cache_key=?").get(key);
    if (!row || Number(row.expires_at) <= Date.now()) return null;
    return parseJson(row.response_json, null);
  }

  #setCached(key, entityId, kind, query, response, count) {
    this.db.prepare(`
      INSERT INTO media_cache (cache_key,entity_id,kind,request_json,response_json,item_count,expires_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(cache_key) DO UPDATE SET response_json=excluded.response_json,item_count=excluded.item_count,
        expires_at=excluded.expires_at,updated_at=excluded.updated_at
    `).run(key, entityId, kind, JSON.stringify(query || {}), JSON.stringify(response), Number(count || 0), Date.now() + DEFAULT_CACHE_TTL, nowIso());
  }
}
