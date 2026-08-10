import dgram from "node:dgram";

const MDNS_ADDRESS = "224.0.0.251";
const MDNS_PORT = 5353;
const SERVICE = "_uc-integration._tcp.local.";
const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_TXT = 16;
const TYPE_SRV = 33;

function encodeName(name) {
  const parts = [];
  for (const label of String(name).replace(/\.$/, "").split(".")) {
    const data = Buffer.from(label);
    parts.push(Buffer.from([data.length]), data);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function parseName(buffer, start, seen = new Set()) {
  let offset = start;
  let nextOffset = start;
  let jumped = false;
  const labels = [];
  while (offset < buffer.length) {
    if (seen.has(offset)) throw new Error("DNS compression loop");
    seen.add(offset);
    const length = buffer[offset];
    if (length === 0) {
      if (!jumped) nextOffset = offset + 1;
      return { name: `${labels.join(".")}.`, nextOffset };
    }
    if ((length & 0xc0) === 0xc0) {
      const pointer = ((length & 0x3f) << 8) | buffer[offset + 1];
      if (!jumped) nextOffset = offset + 2;
      jumped = true;
      const nested = parseName(buffer, pointer, seen);
      labels.push(nested.name.replace(/\.$/, ""));
      return { name: `${labels.join(".")}.`, nextOffset };
    }
    offset += 1;
    labels.push(buffer.subarray(offset, offset + length).toString("utf8"));
    offset += length;
    if (!jumped) nextOffset = offset;
  }
  throw new Error("Invalid DNS name");
}

function parsePacket(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return [];
  let offset = 12;
  const questions = buffer.readUInt16BE(4);
  const count = buffer.readUInt16BE(6) + buffer.readUInt16BE(8) + buffer.readUInt16BE(10);
  for (let index = 0; index < questions; index += 1) {
    const name = parseName(buffer, offset);
    offset = name.nextOffset + 4;
  }
  const records = [];
  for (let index = 0; index < count; index += 1) {
    const parsed = parseName(buffer, offset);
    offset = parsed.nextOffset;
    const type = buffer.readUInt16BE(offset);
    const length = buffer.readUInt16BE(offset + 8);
    const dataOffset = offset + 10;
    const end = dataOffset + length;
    const record = { name: parsed.name, type };
    if (type === TYPE_A && length === 4) record.address = [...buffer.subarray(dataOffset, end)].join(".");
    if (type === TYPE_PTR) record.ptr = parseName(buffer, dataOffset).name;
    if (type === TYPE_SRV && length >= 6) {
      record.port = buffer.readUInt16BE(dataOffset + 4);
      record.target = parseName(buffer, dataOffset + 6).name;
    }
    if (type === TYPE_TXT) {
      record.txt = {};
      let cursor = dataOffset;
      while (cursor < end) {
        const size = buffer[cursor++];
        const text = buffer.subarray(cursor, cursor + size).toString("utf8");
        cursor += size;
        const split = text.indexOf("=");
        record.txt[split >= 0 ? text.slice(0, split) : text] = split >= 0 ? text.slice(split + 1) : "";
      }
    }
    records.push(record);
    offset = end;
  }
  return records;
}

function queryPacket() {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4);
  const type = Buffer.alloc(4);
  type.writeUInt16BE(TYPE_PTR, 0);
  type.writeUInt16BE(1, 2);
  return Buffer.concat([header, encodeName(SERVICE), type]);
}

function extract(records, observed) {
  const byName = new Map();
  for (const record of records) {
    const key = record.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(record);
  }
  const instances = new Set();
  for (const record of records) if (record.name.toLowerCase() === SERVICE && record.ptr) instances.add(record.ptr);
  const results = [];
  for (const instance of instances) {
    const values = byName.get(instance.toLowerCase()) || [];
    const srv = values.find((item) => item.type === TYPE_SRV);
    const txt = values.find((item) => item.type === TYPE_TXT)?.txt || {};
    if (!srv?.port) continue;
    const addresses = byName.get(String(srv.target || "").toLowerCase()) || [];
    const address = addresses.find((item) => item.type === TYPE_A)?.address || observed.get(instance.toLowerCase()) || null;
    const host = address || String(srv.target || "").replace(/\.$/, "");
    results.push({
      instance,
      name: txt.name || instance.split(".")[0],
      driver_id: txt.id || txt.driver_id || instance.split(".")[0],
      version: txt.ver || txt.version || null,
      developer: txt.developer || null,
      host,
      port: srv.port,
      url: host ? `ws://${host}:${srv.port}/` : null,
      txt
    });
  }
  return results;
}

export async function discoverIntegrations(timeoutMs = 3000) {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const records = [];
  const observed = new Map();
  socket.on("message", (message, rinfo) => {
    try {
      const parsed = parsePacket(message);
      records.push(...parsed);
      for (const record of parsed) {
        if (record.ptr) observed.set(record.ptr.toLowerCase(), rinfo.address);
        observed.set(record.name.toLowerCase(), rinfo.address);
      }
    } catch { /* ignore malformed packets */ }
  });
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, "0.0.0.0", () => {
      socket.removeAllListeners("error");
      socket.on("error", () => {});
      try { socket.addMembership(MDNS_ADDRESS); } catch {}
      socket.send(queryPacket(), MDNS_PORT, MDNS_ADDRESS, resolve);
    });
  });
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  socket.close();
  return extract(records, observed).filter((item, index, all) => item.url && all.findIndex((other) => other.url === item.url) === index);
}
