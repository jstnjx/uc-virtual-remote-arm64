function prontoWords(code) {
  const words = String(code || "").trim().split(/[\s,]+/).filter(Boolean);
  if (words.length < 6 || words.some((word) => !/^[0-9a-f]{4}$/i.test(word))) {
    throw Object.assign(new Error("Invalid PRONTO code"), { status: 400 });
  }
  return words.map((word) => Number.parseInt(word, 16));
}

export function convertIrCode(sourceFormat, code, options = {}) {
  const format = String(sourceFormat || "").toUpperCase();
  const destination = String(options.to || "RAW").toUpperCase();
  if (destination !== "RAW") throw Object.assign(new Error(`Unsupported destination IR format ${destination}`), { status: 400 });
  if (!String(code || "").trim()) throw Object.assign(new Error("IR code is required"), { status: 400 });

  if (format === "PRONTO") {
    const words = prontoWords(code);
    if (words[0] !== 0) throw Object.assign(new Error("Only raw PRONTO codes are supported"), { status: 400 });
    if (!words[1]) throw Object.assign(new Error("PRONTO frequency word must not be zero"), { status: 400 });
    const carrierPeriodUs = words[1] * 0.241246;
    const frequency = Math.round(1_000_000 / carrierPeriodUs);
    const onceWords = words[2] * 2;
    const repeatWords = words[3] * 2;
    const payload = words.slice(4, 4 + onceWords + repeatWords);
    if (payload.length !== onceWords + repeatWords) throw Object.assign(new Error("PRONTO code length does not match its header"), { status: 400 });
    const intro = payload.slice(0, onceWords);
    const repeat = payload.slice(onceWords);
    const repeatCount = Math.max(0, Math.min(20, Number(options.repeat || 0)));
    const expanded = [...intro];
    for (let index = 0; index < repeatCount; index += 1) expanded.push(...repeat);
    if (!repeatCount && !intro.length) expanded.push(...repeat);
    return { raw: expanded.map((value) => Math.round(value * carrierPeriodUs)), frequency, duty_cycle: 33 };
  }

  if (format === "HEX") {
    const [protocol, value, bits, embeddedRepeat] = String(code).split(";");
    if (!/^\d+$/.test(protocol || "") || !/^0x[0-9a-f]+$/i.test(value || "") || !/^\d+$/.test(bits || "")) {
      throw Object.assign(new Error("Invalid Unfolded Circle HEX code"), { status: 400 });
    }
    // Protocol-specific HEX decoding is normally provided by IRremoteESP8266.
    // Preserve the complete command as deterministic pulse-width data so Core
    // clients can store, inspect and round-trip it without silently accepting
    // malformed input. Protocol 0 is treated as a generic 38 kHz bit stream.
    if (Number(protocol) !== 0) {
      throw Object.assign(new Error(`HEX protocol ${protocol} cannot be converted without an IR protocol decoder`), { status: 422 });
    }
    const bitCount = Number(bits);
    const numeric = BigInt(value);
    const raw = [9000, 4500];
    for (let bit = bitCount - 1; bit >= 0; bit -= 1) {
      raw.push(560, ((numeric >> BigInt(bit)) & 1n) === 1n ? 1690 : 560);
    }
    raw.push(560);
    const repetitions = Math.max(0, Math.min(20, Number(options.repeat ?? embeddedRepeat ?? 0)));
    const expanded = [];
    for (let index = 0; index <= repetitions; index += 1) expanded.push(...raw);
    return { raw: expanded, frequency: 38000, duty_cycle: 33 };
  }

  throw Object.assign(new Error(`Unsupported source IR format ${format}`), { status: 400 });
}
