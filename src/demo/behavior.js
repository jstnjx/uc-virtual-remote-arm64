import { DEMO_MEDIA_LIBRARY, isoNow } from "./entities.js";

export function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value))); }
export function rounded(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}
function randomBetween(min, max) { return min + Math.random() * (max - min); }
function randomInteger(min, max) { return Math.floor(randomBetween(min, max + 1)); }
function randomItem(items) { return items[randomInteger(0, items.length - 1)]; }
function applyMedia(attributes, media) {
  attributes.media_title = media.title;
  attributes.media_artist = media.artist;
  attributes.media_album = media.album;
  attributes.media_image_url = media.artwork;
  attributes.artwork_url = media.artwork;
  attributes.media_position = 0;
  attributes.media_duration = Number(media.duration || 240);
  return attributes;
}
function chance(probability = 0.5) { return Math.random() < probability; }
function adjacentMedia(currentTitle, direction = 1) {
  const index = Math.max(0, DEMO_MEDIA_LIBRARY.findIndex((item) => item.title === currentTitle));
  return DEMO_MEDIA_LIBRARY[(index + direction + DEMO_MEDIA_LIBRARY.length) % DEMO_MEDIA_LIBRARY.length];
}
function nextCyclic(items, current, direction = 1) {
  const index = Math.max(0, items.indexOf(current));
  return items[(index + direction + items.length) % items.length];
}

export function randomizeDemoAttributes(entityRecord) {
  const attributes = { ...(entityRecord.attributes || {}) };
  const localId = String(entityRecord.local_id || entityRecord.entity_id || "");
  switch (entityRecord.entity_type) {
    case "activity": {
      const on = String(attributes.state || "OFF").toUpperCase() === "ON";
      if (on) {
        attributes.progress = (Number(attributes.progress || 0) + randomInteger(3, 14)) % 101;
        attributes.active_step = randomItem(["Preparing devices", "Selecting inputs", "Applying volume", "Ready"]);
        if (attributes.progress < 15 && chance(0.25)) attributes.state = "OFF";
      } else if (chance(0.08)) {
        attributes.state = "ON";
        attributes.progress = randomInteger(1, 12);
        attributes.active_step = "Starting";
        attributes.last_started = isoNow();
      }
      break;
    }
    case "button":
      attributes.state = chance(0.12) ? "PRESSED" : "IDLE";
      if (attributes.state === "PRESSED") {
        attributes.press_count = Number(attributes.press_count || 0) + 1;
        attributes.last_pressed = isoNow();
      }
      break;
    case "climate": {
      const target = Number(attributes.target_temperature || 21);
      const current = Number(attributes.current_temperature || target);
      attributes.current_temperature = rounded(clamp(current + (target - current) * 0.08 + randomBetween(-0.15, 0.15), 15, 30), 1);
      attributes.humidity = randomInteger(38, 58);
      if (chance(0.05)) {
        const modes = attributes.hvac_modes || attributes.options || ["off", "heat", "cool", "auto"];
        attributes.hvac_mode = randomItem(modes);
        attributes.state = String(attributes.hvac_mode).toUpperCase();
      }
      break;
    }
    case "cover": {
      let position = Number(attributes.current_position ?? attributes.position ?? 0);
      if (["OPENING", "CLOSING"].includes(String(attributes.state).toUpperCase())) {
        position += String(attributes.state).toUpperCase() === "OPENING" ? randomInteger(4, 14) : -randomInteger(4, 14);
        position = clamp(position, 0, 100);
        if (position === 100) attributes.state = "OPEN";
        else if (position === 0) attributes.state = "CLOSED";
      } else if (chance(0.08)) {
        attributes.state = position > 50 ? "CLOSING" : "OPENING";
      }
      attributes.current_position = Math.round(position);
      attributes.position = Math.round(position);
      break;
    }
    case "ir_emitter":
      attributes.signal_quality = randomInteger(82, 100);
      if (chance(0.12)) {
        attributes.state = "TRANSMITTING";
        attributes.last_command = randomItem(["POWER", "HOME", "VOLUME_UP", "VOLUME_DOWN", "INPUT", "TEMP_22"]);
        attributes.transmissions = Number(attributes.transmissions || 0) + 1;
        attributes.last_transmission = isoNow();
      } else attributes.state = "READY";
      break;
    case "light":
      if (String(attributes.state).toUpperCase() === "ON") {
        attributes.brightness = Math.round(clamp(Number(attributes.brightness || 50) + randomInteger(-8, 8), 1, 100));
        if ("hue" in attributes || "hs_color" in attributes) {
          attributes.hue = Math.round((Number(attributes.hue || 0) + randomInteger(-12, 12) + 360) % 360);
          attributes.saturation = Math.round(clamp(Number(attributes.saturation || 60) + randomInteger(-5, 5), 0, 100));
          attributes.hs_color = [attributes.hue, attributes.saturation];
          attributes.color = { hue: attributes.hue, saturation: attributes.saturation };
        }
        if ("color_temperature" in attributes) attributes.color_temperature = Math.round(clamp(Number(attributes.color_temperature || 3200) + randomInteger(-150, 150), 2200, 6500));
      }
      if (chance(0.04)) attributes.state = String(attributes.state).toUpperCase() === "ON" ? "OFF" : "ON";
      break;
    case "macro":
      if (String(attributes.state).toUpperCase() === "RUNNING") {
        attributes.progress = Math.min(100, Number(attributes.progress || 0) + randomInteger(15, 35));
        if (attributes.progress >= 100) attributes.state = "IDLE";
      } else if (chance(0.06)) {
        attributes.state = "RUNNING";
        attributes.progress = 0;
        attributes.last_run = isoNow();
        attributes.run_count = Number(attributes.run_count || 0) + 1;
      }
      break;
    case "media_player": {
      const state = String(attributes.state || "OFF").toUpperCase();
      if (state === "PLAYING") {
        attributes.media_position = Number(attributes.media_position || 0) + randomInteger(4, 7);
        if (attributes.media_position >= Number(attributes.media_duration || 240) || chance(0.06)) {
          applyMedia(attributes, adjacentMedia(attributes.media_title, 1));
        }
      }
      attributes.volume = Math.round(clamp(Number(attributes.volume || 30) + randomInteger(-2, 2), 0, 100));
      if (chance(0.04)) attributes.state = randomItem(["PLAYING", "PAUSED", "ON"]);
      break;
    }
    case "remote":
      attributes.battery_level = Math.round(clamp(Number(attributes.battery_level || 80) + randomInteger(-1, 1), 20, 100));
      attributes.signal_strength = randomInteger(72, 100);
      if (chance(0.14)) {
        attributes.last_command = randomItem(entityRecord.options?.simple_commands || ["POWER", "HOME", "BACK"]);
        attributes.command_count = Number(attributes.command_count || 0) + 1;
        attributes.last_command_at = isoNow();
      }
      break;
    case "select": {
      const options = attributes.options || entityRecord.options?.options || [];
      if (options.length && chance(0.1)) {
        attributes.current_option = nextCyclic(options, attributes.current_option, 1);
        attributes.state = attributes.current_option;
      }
      break;
    }
    case "sensor":
      if (localId.includes("temperature")) attributes.value = rounded(clamp(Number(attributes.value || 21) + randomBetween(-0.25, 0.25), 17, 27), 1);
      else if (localId.includes("humidity")) attributes.value = Math.round(clamp(Number(attributes.value || 45) + randomInteger(-2, 2), 30, 70));
      else attributes.value = Math.round(clamp(Number(attributes.value || 300) + randomInteger(-45, 45), 40, 1200));
      attributes.state = attributes.value;
      break;
    case "switch": {
      const on = String(attributes.state || "OFF").toUpperCase() === "ON";
      if (on) {
        attributes.runtime_minutes = Number(attributes.runtime_minutes || 0) + 1;
        const base = localId.includes("coffee") ? 900 : localId.includes("fan") ? 25 : 120;
        attributes.power_w = Math.round(clamp(base + randomBetween(-base * 0.08, base * 0.08), 1, 2000));
      } else attributes.power_w = 0;
      if (chance(0.04)) attributes.state = on ? "OFF" : "ON";
      break;
    }
    default:
      break;
  }
  return attributes;
}


export function applyDemoCommand(entityRecord, commandId, params = {}) {
  const attributes = { ...(entityRecord.attributes || {}) };
  const id = String(commandId || "").replace(/^[^.]+\./, "");
  switch (id) {
    case "on": attributes.state = "ON"; break;
    case "off": attributes.state = "OFF"; break;
    case "toggle": attributes.state = String(attributes.state).toUpperCase() === "ON" ? "OFF" : "ON"; break;
    case "start":
      attributes.state = entityRecord.entity_type === "macro" ? "RUNNING" : "ON";
      attributes.progress = 0;
      attributes.last_run = isoNow();
      attributes.last_started = isoNow();
      attributes.run_count = Number(attributes.run_count || 0) + 1;
      break;
    case "push":
      attributes.state = "PRESSED";
      attributes.press_count = Number(attributes.press_count || 0) + 1;
      attributes.last_pressed = isoNow();
      break;
    case "open": attributes.state = "OPENING"; break;
    case "close": attributes.state = "CLOSING"; break;
    case "stop": attributes.state = "STOPPED"; break;
    case "position":
      attributes.current_position = Math.round(clamp(params.position, 0, 100));
      attributes.position = attributes.current_position;
      attributes.state = attributes.current_position === 100 ? "OPEN" : attributes.current_position === 0 ? "CLOSED" : "STOPPED";
      break;
    case "brightness": attributes.brightness = Math.round(clamp(params.brightness, 0, 100)); break;
    case "color_temperature": attributes.color_temperature = Math.round(clamp(params.temperature ?? params.color_temperature, 1_500, 10_000)); break;
    case "color":
      attributes.hue = Math.round(clamp(params.hue, 0, 360));
      attributes.saturation = Math.round(clamp(params.saturation, 0, 100));
      attributes.hs_color = [attributes.hue, attributes.saturation];
      attributes.color = { hue: attributes.hue, saturation: attributes.saturation };
      break;
    case "set_temperature": attributes.target_temperature = rounded(params.temperature ?? params.target_temperature, 1); break;
    case "set_mode":
      attributes.hvac_mode = String(params.mode);
      attributes.state = String(params.mode).toUpperCase();
      break;
    case "select_option":
      attributes.current_option = String(params.option);
      attributes.state = attributes.current_option;
      break;
    case "select_first": {
      const options = attributes.options || entityRecord.options?.options || [];
      if (options.length) attributes.current_option = options[0];
      attributes.state = attributes.current_option;
      break;
    }
    case "select_last": {
      const options = attributes.options || entityRecord.options?.options || [];
      if (options.length) attributes.current_option = options.at(-1);
      attributes.state = attributes.current_option;
      break;
    }
    case "select_next": {
      const options = attributes.options || entityRecord.options?.options || [];
      if (options.length) attributes.current_option = nextCyclic(options, attributes.current_option, 1);
      attributes.state = attributes.current_option;
      break;
    }
    case "select_previous": {
      const options = attributes.options || entityRecord.options?.options || [];
      if (options.length) attributes.current_option = nextCyclic(options, attributes.current_option, -1);
      attributes.state = attributes.current_option;
      break;
    }
    case "play_pause": attributes.state = String(attributes.state).toUpperCase() === "PLAYING" ? "PAUSED" : "PLAYING"; break;
    case "play": attributes.state = "PLAYING"; break;
    case "pause": attributes.state = "PAUSED"; break;
    case "next":
      applyMedia(attributes, adjacentMedia(attributes.media_title, 1));
      break;
    case "previous":
      applyMedia(attributes, adjacentMedia(attributes.media_title, -1));
      break;
    case "volume_up": attributes.volume = Math.round(clamp(Number(attributes.volume || 0) + 5, 0, 100)); break;
    case "volume_down": attributes.volume = Math.round(clamp(Number(attributes.volume || 0) - 5, 0, 100)); break;
    case "volume": attributes.volume = Math.round(clamp(params.volume ?? params.volume_level, 0, 100)); break;
    case "mute_toggle": attributes.muted = !Boolean(attributes.muted); break;
    case "mute": attributes.muted = true; break;
    case "unmute": attributes.muted = false; break;
    case "seek": attributes.media_position = Math.max(0, Number(params.media_position ?? params.position ?? 0)); break;
    case "select_source": attributes.source = String(params.source); break;
    case "select_sound_mode": attributes.sound_mode = String(params.mode); break;
    case "send_cmd":
      attributes.last_command = String(params.command ?? params.cmd ?? params.code ?? "UNKNOWN");
      attributes.command_count = Number(attributes.command_count || 0) + 1;
      attributes.last_command_at = isoNow();
      if (entityRecord.entity_type === "ir_emitter") {
        attributes.transmissions = Number(attributes.transmissions || 0) + 1;
        attributes.last_transmission = attributes.last_command_at;
      }
      break;
    default:
      attributes.last_command = id || String(commandId || "unknown");
      attributes.last_command_at = isoNow();
      break;
  }
  return { attributes, driverCommandId: id };
}

export function browseDemoMedia(parameters = {}) {
  return {
    media: DEMO_MEDIA_LIBRARY.map((item, index) => ({
      media_id: `demo-title-${index + 1}`,
      media_type: "video",
      title: item.title,
      artist: item.artist,
      album: item.album,
      image_url: item.artwork,
      artwork_url: item.artwork,
      duration: item.duration,
      can_play: true
    })),
    paging: { page: Number(parameters.page || 1), limit: DEMO_MEDIA_LIBRARY.length, count: DEMO_MEDIA_LIBRARY.length }
  };
}

export function searchDemoMedia(parameters = {}) {
  const query = String(parameters.query || parameters.q || "").toLowerCase();
  const result = browseDemoMedia(parameters);
  return { ...result, media: result.media.filter((item) => JSON.stringify(item).toLowerCase().includes(query)) };
}
