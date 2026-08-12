import assert from "node:assert/strict";
import test from "node:test";
import { EventBus } from "../src/core/event-bus.js";
import { VoiceAssistantService } from "../src/voice/service.js";

function fixture() {
  const sent = [];
  const commands = [];
  const entity = {
    entity_id: "demo.assistant",
    local_id: "assistant",
    integration_id: "demo",
    entity_type: "voice_assistant",
    name: { en: "Assistant" },
    attributes: { state: "ON" },
    features: ["transcription", "response_text", "response_speech"],
    options: {
      audio_cfg: { channels: 1, sample_rate: 16000, sample_format: "I16", format: "PCM" },
      profiles: [{ id: "default", name: { en: "Default" } }],
      preferred_profile: "default",
    },
  };
  const connection = {
    connected: true,
    socket: { send: (data) => sent.push(Buffer.from(data)) },
    command: async (...args) => { commands.push(args); return { code: 200 }; },
  };
  const platform = {
    events: new EventBus(),
    db: {
      getConfiguredEntity: (id) => id === entity.entity_id ? entity : null,
      listConfiguredEntities: () => [entity],
    },
    integrations: {
      connections: new Map([["demo-record", connection]]),
      resolveIntegration: (id) => id === "demo" ? { record_id: "demo-record" } : null,
      connect: async () => connection,
    },
  };
  return { platform, entity, connection, sent, commands };
}

test("voice assistant buffers audio until ready then streams begin/data/end", async () => {
  const { platform, entity, sent, commands } = fixture();
  const voice = new VoiceAssistantService(platform);

  const started = await voice.start(entity.entity_id, { session_id: 42, speech_response: true });
  assert.equal(started.state, "WAITING_READY");
  assert.equal(commands.length, 1);
  assert.equal(commands[0][0], "assistant");
  assert.equal(commands[0][1], "voice_start");
  assert.equal(commands[0][2].session_id, 42);
  assert.equal(commands[0][2].speech_response, true);

  voice.pushAudio(entity.entity_id, 42, Buffer.from([1, 2, 3, 4]));
  assert.equal(sent.length, 0, "audio must not be sent before assistant ready");

  platform.events.publish("assistant.event", {
    integration_id: "demo",
    entity_id: "assistant",
    session_id: 42,
    type: "ready",
  });
  assert.equal(sent.length, 2, "ready must send voice_begin then buffered voice_data");
  assert.equal(sent[0][0] >> 3, 1, "first protobuf field is voice_begin");
  assert.equal(sent[1][0] >> 3, 2, "second protobuf field is voice_data");

  voice.pushAudio(entity.entity_id, 42, Buffer.from([5, 6]));
  assert.equal(sent.length, 3);
  assert.equal(sent[2][0] >> 3, 2);

  const ended = voice.end(entity.entity_id, 42);
  assert.equal(ended.state, "PROCESSING");
  assert.equal(sent.length, 4);
  assert.equal(sent[3][0] >> 3, 3, "final protobuf field is voice_end");

  platform.events.publish("assistant.event", {
    integration_id: "demo",
    entity_id: "assistant",
    session_id: 42,
    type: "finished",
  });
  assert.equal(voice.status().sessions[0].state, "FINISHED");
});

test("voice assistant discovery exposes configured profiles and audio settings", () => {
  const { platform } = fixture();
  const voice = new VoiceAssistantService(platform);
  const assistants = voice.assistants();
  assert.equal(assistants.length, 1);
  assert.equal(assistants[0].entity_id, "demo.assistant");
  assert.equal(assistants[0].preferred_profile, "default");
  assert.equal(assistants[0].audio_cfg.sample_rate, 16000);
});
