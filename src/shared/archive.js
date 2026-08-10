import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export function readJson(filename, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filename, "utf8")); }
  catch { return fallback; }
}

export function findDirectory(root, predicate) {
  const stack = [path.resolve(root)];
  while (stack.length) {
    const directory = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch { continue; }
    if (predicate(directory, entries)) return directory;
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(path.join(directory, entry.name));
    }
  }
  return null;
}

function findEocd(buffer) {
  const signature = 0x06054b50;
  const minimum = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  throw new Error("Invalid ZIP archive: end-of-central-directory record not found");
}

export function extractZip(zipFile, destination, options = {}) {
  const archive = fs.readFileSync(zipFile);
  const eocd = findEocd(archive);
  const entries = archive.readUInt16LE(eocd + 10);
  const maximumEntries = Number(options.maximumEntries || 10000);
  const maximumUncompressedBytes = Number(options.maximumUncompressedBytes || 512 * 1024 * 1024);
  if (entries > maximumEntries) throw new Error(`ZIP archive contains too many entries: ${entries}`);
  let cursor = archive.readUInt32LE(eocd + 16);
  const root = path.resolve(destination);
  let totalUncompressedBytes = 0;
  fs.mkdirSync(root, { recursive: true });

  for (let index = 0; index < entries; index += 1) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Invalid ZIP archive: central directory entry is corrupt");
    }
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const filenameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const filename = archive
      .subarray(cursor + 46, cursor + 46 + filenameLength)
      .toString("utf8")
      .replace(/\\/g, "/");
    cursor += 46 + filenameLength + extraLength + commentLength;

    if (!filename || filename.endsWith("/")) continue;
    if (flags & 0x1) throw new Error(`Encrypted ZIP entries are not supported: ${filename}`);
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff) {
      throw new Error(`ZIP64 entries are not supported: ${filename}`);
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > maximumUncompressedBytes) {
      throw new Error("ZIP archive exceeds the permitted extracted size");
    }
    const output = path.resolve(root, filename);
    if (output !== root && !output.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Unsafe ZIP entry path: ${filename}`);
    }
    if (archive.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local entry: ${filename}`);
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    let payload;
    if (method === 0) payload = Buffer.from(compressed);
    else if (method === 8) payload = zlib.inflateRawSync(compressed);
    else throw new Error(`Unsupported ZIP compression method ${method}: ${filename}`);
    if (payload.length !== uncompressedSize) throw new Error(`ZIP entry size mismatch: ${filename}`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, payload);
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((Math.floor(date.getSeconds() / 2)) & 31),
    date: (((year - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31)
  };
}

export function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();
  for (const item of entries) {
    const name = Buffer.from(String(item.name || "").replace(/\\/g, "/").replace(/^\/+/, ""));
    if (!name.length || name.toString().includes("../")) throw new Error("Invalid ZIP entry name");
    const data = Buffer.isBuffer(item.data) ? item.data : Buffer.from(String(item.data ?? ""));
    const checksum = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, eocd]);
}
