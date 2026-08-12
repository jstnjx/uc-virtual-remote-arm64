import crypto from "node:crypto";
import { encodeVoiceBegin, encodeVoiceData, encodeVoiceEnd, normalizeAudioConfiguration } from "./protobuf.js";

const MAX_BUFFERED_AUDIO = 2 * 1024 * 1024;
const MAX_AUDIO_CHUNK = 512 * 1024;

function uint32SessionId(value) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0 && number <= 0xffffffff) return number >>> 0;
  return crypto.randomBytes(4).readUInt32BE(0) || 1;
}

function assistantRecord(entity) {
  const options = entity?.options && typeof entity.options === "object" ? entity.options : {};
  return {
    id: entity.entity_id,
    entity_id: entity.entity_id,
    integration_id: entity.integration_id,
    name: entity.name,
    icon: entity.icon,
    features: Array.isArray(entity.features) ? entity.features : [],
    state: entity.attributes?.state || "UNKNOWN",
    profiles: Array.isArray(options.profiles) ? options.profiles : [],
    preferred_profile: options.preferred_profile || null,
    audio_cfg: normalizeAudioConfiguration(options.audio_cfg || {}),
  };
}

export class VoiceAssistantService {
  constructor(platform) {
    this.platform = platform;
    this.sessions = new Map();
    this.platform.events.on("assistant.event", (event) => this.#assistantEvent(event.data || {}));
  }

  assistants() {
    return this.platform.db.listConfiguredEntities()
      .filter((entity) => entity.entity_type === "voice_assistant")
      .map(assistantRecord);
  }

  status() {
    return {
      assistants: this.assistants(),
      sessions: [...this.sessions.values()].map((session) => this.#publicSession(session)),
    };
  }

  async start(entityId, input = {}) {
    const entity = this.platform.db.getConfiguredEntity(entityId);
    if (!entity) throw Object.assign(new Error(`Configured entity ${entityId} not found`), { status: 404 });
    if (entity.entity_type !== "voice_assistant") {
      throw Object.assign(new Error(`${entityId} is not a voice assistant`), { status: 422 });
    }

    const sessionId = uint32SessionId(input.session_id);
    if (this.sessions.has(sessionId)) {
      throw Object.assign(new Error(`Voice session ${sessionId} already exists`), { status: 409 });
    }

    const resolved = this.platform.integrations.resolveIntegration(entity.integration_id);
    if (!resolved) throw Object.assign(new Error(`Integration ${entity.integration_id} not found`), { status: 404 });
    let connection = this.platform.integrations.connections.get(resolved.record_id);
    if (!connection?.connected) {
      await this.platform.integrations.connect(resolved.record_id);
      connection = this.platform.integrations.connections.get(resolved.record_id);
    }
    if (!connection?.connected) {
      throw Object.assign(new Error(`Integration ${entity.integration_id} is not connected`), { status: 503 });
    }

    const requestedAudio = input.audio_cfg || entity.options?.audio_cfg || {};
    const audioCfg = normalizeAudioConfiguration(requestedAudio);
    const session = {
      session_id: sessionId,
      entity_id: entity.entity_id,
      local_entity_id: entity.local_id,
      integration_id: entity.integration_id,
      connection_record_id: resolved.record_id,
      connection,
      audio_cfg: audioCfg,
      ready: false,
      begin_sent: false,
      ended: false,
      state: "STARTING",
      queued: [],
      queued_bytes: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_event: null,
    };
    this.sessions.set(sessionId, session);

    const params = {
      session_id: sessionId,
      audio_cfg: audioCfg,
      ...(input.speech_response === undefined ? {} : { speech_response: Boolean(input.speech_response) }),
      ...(input.timeout === undefined ? {} : { timeout: Number(input.timeout) }),
      ...(input.profile_id ? { profile_id: String(input.profile_id) } : {}),
    };

    try {
      await connection.command(entity.local_id, "voice_start", params, "voice_assistant");
      session.state = "WAITING_READY";
      session.updated_at = new Date().toISOString();
      this.platform.events.publish("voice.session", this.#publicSession(session));
      return this.#publicSession(session);
    } catch (error) {
      this.sessions.delete(sessionId);
      throw error;
    }
  }

  pushAudio(entityId, sessionId, samples) {
    const session = this.#session(entityId, sessionId);
    if (session.ended) throw Object.assign(new Error(`Voice session ${session.session_id} has ended`), { status: 409 });
    const chunk = Buffer.isBuffer(samples) ? samples : Buffer.from(samples || []);
    if (!chunk.length) return this.#publicSession(session);
    if (chunk.length > MAX_AUDIO_CHUNK) {
      throw Object.assign(new Error(`Voice audio chunk exceeds ${MAX_AUDIO_CHUNK} bytes`), { status: 413 });
    }

    if (!session.ready) {
      if (session.queued_bytes + chunk.length > MAX_BUFFERED_AUDIO) {
        throw Object.assign(new Error("Voice assistant is not ready and the audio buffer is full"), { status: 429 });
      }
      session.queued.push(Buffer.from(chunk));
      session.queued_bytes += chunk.length;
      session.updated_at = new Date().toISOString();
      return this.#publicSession(session);
    }

    this.#ensureBegin(session);
    session.connection.socket.send(Buffer.from(encodeVoiceData(session.session_id, chunk)));
    session.updated_at = new Date().toISOString();
    return this.#publicSession(session);
  }

  end(entityId, sessionId) {
    const session = this.#session(entityId, sessionId);
    if (!session.ended) {
      if (session.ready) {
        this.#ensureBegin(session);
        session.connection.socket.send(Buffer.from(encodeVoiceEnd(session.session_id)));
      }
      session.ended = true;
      session.state = "PROCESSING";
      session.queued = [];
      session.queued_bytes = 0;
      session.updated_at = new Date().toISOString();
      this.platform.events.publish("voice.session", this.#publicSession(session));
    }
    return this.#publicSession(session);
  }

  cancel(entityId, sessionId, reason = "CANCELLED") {
    const session = this.#session(entityId, sessionId);
    if (!session.ended && session.ready) {
      this.#ensureBegin(session);
      session.connection.socket.send(Buffer.from(encodeVoiceEnd(session.session_id)));
    }
    session.ended = true;
    session.state = "CANCELLED";
    session.last_event = { type: "error", data: { code: reason, message: "Voice session cancelled" } };
    session.queued = [];
    session.queued_bytes = 0;
    session.updated_at = new Date().toISOString();
    this.platform.events.publish("voice.session", this.#publicSession(session));
    return this.#publicSession(session);
  }

  #assistantEvent(data) {
    const sessionId = Number(data.session_id || data.id);
    if (!Number.isInteger(sessionId)) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (data.entity_id && ![session.entity_id, session.local_entity_id].includes(String(data.entity_id))) return;

    const type = String(data.type || data.event || "").toLowerCase();
    session.last_event = data;
    session.updated_at = new Date().toISOString();
    if (type === "ready") {
      session.ready = true;
      session.state = "STREAMING";
      this.#ensureBegin(session);
      for (const chunk of session.queued) {
        session.connection.socket.send(Buffer.from(encodeVoiceData(session.session_id, chunk)));
      }
      session.queued = [];
      session.queued_bytes = 0;
    } else if (type === "finished") {
      session.ended = true;
      session.state = "FINISHED";
    } else if (type === "error") {
      session.ended = true;
      session.state = "ERROR";
    } else if (type) {
      session.state = session.ended ? "PROCESSING" : session.state;
    }
    this.platform.events.publish("voice.session", this.#publicSession(session));
  }

  #ensureBegin(session) {
    if (session.begin_sent) return;
    if (!session.connection?.socket?.send) {
      throw Object.assign(new Error("Voice integration connection is unavailable"), { status: 503 });
    }
    session.connection.socket.send(Buffer.from(encodeVoiceBegin(session.session_id, session.audio_cfg)));
    session.begin_sent = true;
  }

  #session(entityId, sessionId) {
    const id = Number(sessionId);
    const session = this.sessions.get(id);
    if (!session || session.entity_id !== entityId) {
      throw Object.assign(new Error(`Voice session ${sessionId} not found for ${entityId}`), { status: 404 });
    }
    return session;
  }

  #publicSession(session) {
    return {
      session_id: session.session_id,
      entity_id: session.entity_id,
      integration_id: session.integration_id,
      audio_cfg: session.audio_cfg,
      ready: session.ready,
      state: session.state,
      ended: session.ended,
      queued_bytes: session.queued_bytes,
      created_at: session.created_at,
      updated_at: session.updated_at,
      last_event: session.last_event,
    };
  }
}
