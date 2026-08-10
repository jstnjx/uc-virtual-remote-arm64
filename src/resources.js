import path from "node:path";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const RESOURCE_RULES = Object.freeze({
  icon: { width: 90, height: 90, maxSize: 1024 * 1024, formats: ["image/png", "image/jpeg", "image/webp"] },
  background: { width: 480, height: 275, maxSize: 5 * 1024 * 1024, formats: ["image/png", "image/jpeg", "image/webp"] }
});

export function normalizeResourceId(filename) {
  const extension = path.extname(String(filename || "")).toLowerCase().replace(/[^.a-z0-9]/g, "");
  const stem = path.basename(String(filename || "resource"), path.extname(String(filename || "")))
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100) || "resource";
  return `${stem}${extension || ".png"}`;
}

// Core resource identifiers are normalized filenames, but an already valid
// identifier must remain byte-for-byte stable. This is important for backup
// restore and Remote Sync: entity icon references use `custom:<resource-id>`
// and would break if a valid source ID were lower-cased a second time.
export function resourceIdFromFilename(filename) {
  const basename = path.basename(String(filename || "resource")).normalize("NFC");
  if (basename !== "." && basename !== ".." && /^[A-Za-z0-9._-]+$/.test(basename)) return basename.slice(0, 255);
  return normalizeResourceId(basename);
}

export function mimeFromFilename(filename) {
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" })[path.extname(filename).toLowerCase()] || "application/octet-stream";
}

export function extensionForMime(mimeType) {
  return ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" })[String(mimeType || "").toLowerCase()] || "";
}

export function imageDimensions(buffer, mimeType = "") {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) throw new Error("Invalid or empty image file");
  const mime = String(mimeType || "").toLowerCase();
  if (mime === "image/png" || buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    if (buffer.length < 24) throw new Error("Invalid PNG image");
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: "png" };
  }
  if (mime === "image/jpeg" || (buffer[0] === 0xff && buffer[1] === 0xd8)) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), format: "jpeg" };
      }
      if (marker === 0xd9 || marker === 0xda) break;
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
    throw new Error("Could not read JPEG dimensions");
  }
  if (mime === "image/webp" || (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP")) {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X" && buffer.length >= 30) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
        format: "webp"
      };
    }
    if (chunk === "VP8 " && buffer.length >= 30) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff, format: "webp" };
    }
    if (chunk === "VP8L" && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: "webp" };
    }
    throw new Error("Could not read WebP dimensions");
  }
  throw new Error("Unsupported image format. Use PNG, JPEG, or WebP");
}

export function validateResource(type, buffer, mimeType) {
  const rules = RESOURCE_RULES[type];
  if (!rules) throw Object.assign(new Error(`Unsupported resource type: ${type}`), { status: 404 });
  if (!rules.formats.includes(mimeType)) throw Object.assign(new Error("Unsupported image format. Use PNG, JPEG, or WebP"), { status: 400 });
  if (buffer.length > rules.maxSize) throw Object.assign(new Error(`File exceeds the ${Math.round(rules.maxSize / 1024 / 1024)} MB limit`), { status: 400 });
  const dimensions = imageDimensions(buffer, mimeType);
  if (dimensions.width !== rules.width || dimensions.height !== rules.height) {
    throw Object.assign(new Error(`${type === "icon" ? "Icons" : "Background images"} must be exactly ${rules.width}×${rules.height}px; received ${dimensions.width}×${dimensions.height}px`), { status: 400 });
  }
  return { ...dimensions, size: buffer.length };
}

export function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw Object.assign(new Error("Invalid base64 image payload"), { status: 400 });
  return { mimeType: match[1].toLowerCase(), buffer: Buffer.from(match[2].replace(/\s/g, ""), "base64") };
}
