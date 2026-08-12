import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInputSource } from "../src/voice/service.js";

test("voice input source supports manual, ALSA and network capture", () => {
  assert.deepEqual(normalizeInputSource("manual"), { type: "manual" });
  assert.deepEqual(normalizeInputSource({ type: "microphone", device: "hw:1,0" }), {
    type: "alsa",
    device: "hw:1,0",
  });
  assert.deepEqual(normalizeInputSource({ type: "network", url: "https://example.test/audio" }), {
    type: "url",
    url: "https://example.test/audio",
  });
  assert.deepEqual(normalizeInputSource({ type: "url", url: "rtsp://example.test/live" }), {
    type: "url",
    url: "rtsp://example.test/live",
  });
});

test("voice input source rejects unsupported URL protocols", () => {
  assert.throws(
    () => normalizeInputSource({ type: "url", url: "file:///tmp/audio.raw" }),
    /Unsupported network voice input protocol/,
  );
});
