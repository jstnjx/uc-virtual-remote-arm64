const SAMPLE_FORMATS = Object.freeze({
  SAMPLE_FORMAT_UNKNOWN: 0,
  I8: 1,
  I16: 2,
  I32: 3,
  U8: 4,
  U16: 5,
  U32: 6,
  F32: 7,
});

const AUDIO_FORMATS = Object.freeze({
  AUDIO_FORMAT_UNKNOWN: 0,
  PCM: 1,
});

function varint(value) {
  let remaining = BigInt(Math.max(0, Number(value) || 0));
  const output = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining) byte |= 0x80;
    output.push(byte);
  } while (remaining);
  return Buffer.from(output);
}

function tag(field, wireType) {
  return varint((field << 3) | wireType);
}

function uint32(field, value) {
  return Buffer.concat([tag(field, 0), varint(Number(value) >>> 0)]);
}

function bytes(field, value) {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  return Buffer.concat([tag(field, 2), varint(payload.length), payload]);
}

function message(field, parts) {
  return bytes(field, Buffer.concat(parts.filter(Boolean)));
}

export function normalizeAudioConfiguration(value = {}) {
  const channels = [1, 2].includes(Number(value.channels)) ? Number(value.channels) : 1;
  const sampleRate = Math.max(8000, Math.min(192000, Number(value.sample_rate || value.sampleRate || 16000)));
  const sampleFormatName = String(value.sample_format || value.sampleFormat || "I16").toUpperCase();
  const sampleFormat = SAMPLE_FORMATS[sampleFormatName] ?? SAMPLE_FORMATS.I16;
  const formatName = String(value.format || "PCM").toUpperCase();
  const format = AUDIO_FORMATS[formatName] ?? AUDIO_FORMATS.PCM;
  return {
    channels,
    sample_rate: sampleRate,
    sample_format: Object.keys(SAMPLE_FORMATS).find((key) => SAMPLE_FORMATS[key] === sampleFormat) || "I16",
    format: Object.keys(AUDIO_FORMATS).find((key) => AUDIO_FORMATS[key] === format) || "PCM",
  };
}

function audioConfiguration(value) {
  const cfg = normalizeAudioConfiguration(value);
  return [
    uint32(1, cfg.channels),
    uint32(2, cfg.sample_rate),
    uint32(3, SAMPLE_FORMATS[cfg.sample_format]),
    uint32(4, AUDIO_FORMATS[cfg.format]),
  ];
}

export function encodeVoiceBegin(sessionId, configuration = {}) {
  const voiceBegin = [
    uint32(1, sessionId),
    message(2, audioConfiguration(configuration)),
  ];
  return message(1, voiceBegin);
}

export function encodeVoiceData(sessionId, samples) {
  return message(2, [
    uint32(1, sessionId),
    bytes(2, samples),
  ]);
}

export function encodeVoiceEnd(sessionId) {
  return message(3, [uint32(1, sessionId)]);
}

export const VoiceSampleFormat = SAMPLE_FORMATS;
export const VoiceAudioFormat = AUDIO_FORMATS;
