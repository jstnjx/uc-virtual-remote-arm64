import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { encodeVoiceBegin, encodeVoiceData, encodeVoiceEnd, normalizeAudioConfiguration } from "../src/voice/protobuf.js";
import { WebSocketPeer } from "../src/protocol/websocket.js";

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.frames = [];
    this.remoteAddress = "127.0.0.1";
    this.destroyed = false;
  }

  write(data, callback) {
    this.frames.push(Buffer.from(data));
    callback?.();
    return true;
  }

  end() {}
  destroy() { this.destroyed = true; }
}

test("voice stream protobuf matches the published wire schema", () => {
  const cfg = normalizeAudioConfiguration({ channels: 1, sample_rate: 16000, sample_format: "I16", format: "PCM" });
  assert.deepEqual(cfg, { channels: 1, sample_rate: 16000, sample_format: "I16", format: "PCM" });
  assert.equal(encodeVoiceBegin(1, cfg).toString("hex"), "0a0d08011209080110807d18022001");
  assert.equal(encodeVoiceData(1, Buffer.from([1, 2])).toString("hex"), "1206080112020102");
  assert.equal(encodeVoiceEnd(1).toString("hex"), "1a020801");
});

test("WebSocketPeer sends Buffer payloads as binary frames", () => {
  const socket = new FakeSocket();
  const peer = new WebSocketPeer(socket);
  peer.send(Buffer.from([0xde, 0xad]));
  peer.send("json");
  assert.equal(socket.frames[0][0], 0x82, "Buffer frame must use binary opcode 0x2");
  assert.equal(socket.frames[1][0], 0x81, "String frame must use text opcode 0x1");
});
