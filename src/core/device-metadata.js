const t = (en) => ({ en });

export function screenLayout() {
  return {
    grid: {
      default: { width: 4, height: 6 },
      min: { width: 1, height: 1 },
      max: { width: 4, height: 12 }
    }
  };
}

// Keep the identifiers and order aligned with the physical Remote 3/Core
// model. The Web Configurator treats every entry as an addressable mapping
// slot, including buttons that do not currently have a command assigned.
const DEVICE_BUTTON_DEFINITIONS = Object.freeze([
  ["BACK", "uc:arrow-left", "Back", 2, 1],
  ["HOME", "uc:home", "Home", 3, 1],
  ["POWER", "uc:power-off", "Power", 4, 1],
  ["VOLUME_UP", "uc:volume-up", "Volume up", 1, 2],
  ["DPAD_UP", "uc:chevron-up", "Up", 3, 2],
  ["CHANNEL_UP", "uc:chevron-up", "Channel up", 5, 2],
  ["DPAD_LEFT", "uc:chevron-left", "Left", 2, 3],
  ["DPAD_MIDDLE", "uc:circle", "OK", 3, 3],
  ["DPAD_RIGHT", "uc:chevron-right", "Right", 4, 3],
  ["VOLUME_DOWN", "uc:volume-down", "Volume down", 1, 4],
  ["DPAD_DOWN", "uc:chevron-down", "Down", 3, 4],
  ["CHANNEL_DOWN", "uc:chevron-down", "Channel down", 5, 4],
  ["MUTE", "uc:volume-mute", "Mute", 1, 5],
  ["RECORD", "uc:circle", "Record", 2, 5],
  ["MENU", "uc:ellipsis-h", "Options", 4, 5],
  ["VOICE", "uc:microphone", "Microphone", 5, 5],
  ["PREV", "uc:backward", "Previous", 1, 6],
  ["STOP", "uc:stop", "Stop", 2, 6],
  ["PLAY", "uc:play", "Play / pause", 4, 6],
  ["NEXT", "uc:forward", "Next", 5, 6]
]);

export const DEVICE_BUTTON_IDS = Object.freeze(
  DEVICE_BUTTON_DEFINITIONS.map(([button]) => button)
);

/**
 * Return the Core button-mapping collection expected by the Web Configurator.
 *
 * The configurator passes the selected mapping object into the command editor
 * and reads its `button` property. A missing entry therefore cannot be
 * represented by omitting it from the array: unassigned physical keys must be
 * present as `{ button: "BACK" }`, just like backups from a physical Remote 3.
 */
export function normalizeButtonMappings(value = []) {
  const source = Array.isArray(value)
    ? value
    : Object.entries(value && typeof value === "object" ? value : {}).map(([button, mapping]) => ({
      button,
      ...(mapping && typeof mapping === "object" ? mapping : {})
    }));

  const mappings = new Map();
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const button = String(item.button || "").trim();
    if (!button) continue;
    mappings.set(button, { ...(mappings.get(button) || {}), ...item, button });
  }

  const result = DEVICE_BUTTON_IDS.map((button) => ({ button, ...(mappings.get(button) || {}) }));
  const known = new Set(DEVICE_BUTTON_IDS);
  for (const [button, mapping] of mappings) {
    if (!known.has(button)) result.push({ ...mapping, button });
  }
  return result;
}

export function buttonLayout() {
  const buttons = DEVICE_BUTTON_DEFINITIONS.map(([button, icon, name, x, y]) => ({
    button,
    icon,
    name: t(name),
    location: { x, y },
    size: { width: 1, height: 1 }
  }));
  return [{
    id: "remote3",
    type: "keypad",
    name: t("Remote 3"),
    grid: { width: 5, height: 6 },
    buttons,
    touch_slider: {
      id: "TOUCH_SLIDER",
      name: t("Touch slider"),
      supports: ["short_press", "long_press", "double_press", "slide"]
    }
  }];
}

export function iconMapping() {
  return {
    home: "uE900", power: "uE901", back: "uE902", menu: "uE903", microphone: "uE904",
    play: "uE905", pause: "uE906", stop: "uE907", record: "uE908", next: "uE909", previous: "uE90A",
    volume_up: "uE90B", volume_down: "uE90C", volume_mute: "uE90D", channel_up: "uE90E", channel_down: "uE90F",
    arrow_up: "uE910", arrow_down: "uE911", arrow_left: "uE912", arrow_right: "uE913", select: "uE914",
    cool: "uE91E", heat: "uE91F"
  };
}

function param(param, name, type, extra = {}) {
  return { param, name: t(name), type, ...extra };
}

function command(id, entityType, cmdId, name, features = [], params = undefined) {
  return { id, entity_type: entityType, cmd_id: cmdId, name: t(name), features, ...(params ? { params } : {}) };
}

const COMMANDS = [
  command("activity.start", "activity", "start", "Start", ["start"]),
  command("activity.on", "activity", "on", "Turn on", ["on_off"]),
  command("activity.off", "activity", "off", "Turn off", ["on_off"]),
  command("macro.start", "macro", "start", "Run", ["start"]),
  command("button.push", "button", "push", "Push", ["push"]),

  command("switch.on", "switch", "on", "Turn on", ["on_off"]),
  command("switch.off", "switch", "off", "Turn off", ["on_off"]),
  command("switch.toggle", "switch", "toggle", "Toggle", ["toggle"]),

  command("light.on", "light", "on", "Turn on", ["on_off"]),
  command("light.off", "light", "off", "Turn off", ["on_off"]),
  command("light.toggle", "light", "toggle", "Toggle", ["toggle"]),
  command("light.brightness", "light", "brightness", "Set brightness", ["dim", "brightness"], [
    param("brightness", "Brightness", "number", { min: 0, max: 100 })
  ]),
  command("light.color_temperature", "light", "color_temperature", "Set color temperature", ["color_temperature"], [
    param("temperature", "Color temperature", "number")
  ]),
  command("light.color", "light", "color", "Set color", ["color"], [
    param("hue", "Hue", "number", { min: 0, max: 360 }),
    param("saturation", "Saturation", "number", { min: 0, max: 100 })
  ]),

  command("cover.open", "cover", "open", "Open", ["open"]),
  command("cover.close", "cover", "close", "Close", ["close"]),
  command("cover.stop", "cover", "stop", "Stop", ["stop"]),
  command("cover.position", "cover", "position", "Set position", ["position"], [
    param("position", "Position", "number", { min: 0, max: 100 })
  ]),

  command("media_player.on", "media_player", "on", "Turn on", ["on_off"]),
  command("media_player.off", "media_player", "off", "Turn off", ["on_off"]),
  command("media_player.toggle", "media_player", "toggle", "Toggle", ["toggle"]),
  command("media_player.play_pause", "media_player", "play_pause", "Play / pause", ["play_pause"]),
  command("media_player.play", "media_player", "play", "Play", ["play", "play_pause"]),
  command("media_player.pause", "media_player", "pause", "Pause", ["pause", "play_pause"]),
  command("media_player.stop", "media_player", "stop", "Stop", ["stop"]),
  command("media_player.next", "media_player", "next", "Next", ["next"]),
  command("media_player.previous", "media_player", "previous", "Previous", ["previous"]),
  command("media_player.rewind", "media_player", "rewind", "Rewind", ["rewind"]),
  command("media_player.fast_forward", "media_player", "fast_forward", "Fast forward", ["fast_forward"]),
  command("media_player.volume_up", "media_player", "volume_up", "Volume up", ["volume_up_down"]),
  command("media_player.volume_down", "media_player", "volume_down", "Volume down", ["volume_up_down"]),
  command("media_player.mute_toggle", "media_player", "mute_toggle", "Mute toggle", ["mute_toggle"]),
  command("media_player.mute", "media_player", "mute", "Mute", ["mute"]),
  command("media_player.unmute", "media_player", "unmute", "Unmute", ["unmute"]),
  command("media_player.volume", "media_player", "volume", "Set volume", ["volume"], [
    param("volume", "Volume", "number", { min: 0, max: 100 })
  ]),
  command("media_player.seek", "media_player", "seek", "Seek", ["seek"], [
    param("media_position", "Position", "number", { min: 0 })
  ]),
  command("media_player.select_source", "media_player", "select_source", "Select source", ["select_source"], [
    param("source", "Source", "selection", { items: { source: "attributes", field: "source_list" } })
  ]),
  command("media_player.select_sound_mode", "media_player", "select_sound_mode", "Select sound mode", ["select_sound_mode"], [
    param("mode", "Sound mode", "selection", { items: { source: "attributes", field: "sound_mode_list" } })
  ]),
  command("media_player.cursor_up", "media_player", "cursor_up", "Cursor up", ["dpad"]),
  command("media_player.cursor_down", "media_player", "cursor_down", "Cursor down", ["dpad"]),
  command("media_player.cursor_left", "media_player", "cursor_left", "Cursor left", ["dpad"]),
  command("media_player.cursor_right", "media_player", "cursor_right", "Cursor right", ["dpad"]),
  command("media_player.cursor_enter", "media_player", "cursor_enter", "Select", ["dpad"]),
  command("media_player.home", "media_player", "home", "Home", ["home"]),
  command("media_player.menu", "media_player", "menu", "Menu", ["menu"]),
  command("media_player.context_menu", "media_player", "context_menu", "Context menu", ["context_menu"]),
  command("media_player.guide", "media_player", "guide", "Guide", ["guide"]),
  command("media_player.channel_up", "media_player", "channel_up", "Channel up", ["channel_switcher"]),
  command("media_player.channel_down", "media_player", "channel_down", "Channel down", ["channel_switcher"]),
  command("media_player.repeat", "media_player", "repeat", "Repeat", ["repeat"], [
    param("repeat", "Repeat", "enum", { values: ["OFF", "ONE", "ALL"] })
  ]),
  command("media_player.shuffle", "media_player", "shuffle", "Shuffle", ["shuffle"], [
    param("shuffle", "Shuffle", "bool")
  ]),
  command("media_player.play_media", "media_player", "play_media", "Play media", ["play_media"], [
    param("media_id", "Media ID", "regex"),
    param("media_type", "Media type", "regex", { optional: true })
  ]),

  command("climate.on", "climate", "on", "Turn on", ["on_off"]),
  command("climate.off", "climate", "off", "Turn off", ["on_off"]),
  command("climate.set_temperature", "climate", "set_temperature", "Set temperature", ["target_temperature", "set_temperature"], [
    param("temperature", "Temperature", "number")
  ]),
  command("climate.set_mode", "climate", "set_mode", "Set mode", ["set_mode", "hvac_mode"], [
    param("mode", "Mode", "selection", { items: { source: "attributes", field: "options" } })
  ]),

  command("select.select_option", "select", "select_option", "Select option", ["select_option"], [
    param("option", "Option", "selection", { items: { source: "attributes", field: "options" } })
  ]),
  command("select.select_first", "select", "select_first", "Select first", ["select_first"]),
  command("select.select_last", "select", "select_last", "Select last", ["select_last"]),
  command("select.select_next", "select", "select_next", "Select next", ["select_next"]),
  command("select.select_previous", "select", "select_previous", "Select previous", ["select_previous"]),

  command("remote.send_cmd", "remote", "send_cmd", "Send command", ["send_cmd"], [
    param("command", "Command", "selection", { items: { source: "options", field: "simple_commands" } }),
    param("repeat", "Repeat", "number", { min: 1, default: 1, optional: true }),
    param("delay", "Delay", "number", { min: 0, default: 100, optional: true }),
    param("hold", "Hold", "number", { min: 0, default: 0, optional: true })
  ]),
  command("remote.on", "remote", "on", "Turn on", ["on_off"]),
  command("remote.off", "remote", "off", "Turn off", ["on_off"]),
  command("remote.toggle", "remote", "toggle", "Toggle", ["toggle"])
];

export function entityCommandMetadata() {
  return COMMANDS.map(({ features: _features, ...item }) => item);
}

export function entityCommandIds(entity) {
  if (!entity) return [];
  const type = String(entity.entity_type || "");
  const features = new Set(Array.isArray(entity.features) ? entity.features.map(String) : []);
  const always = new Set();
  if (type === "button") always.add("button.push");
  if (type === "select") {
    for (const id of ["select.select_option", "select.select_first", "select.select_last", "select.select_next", "select.select_previous"]) always.add(id);
  }
  if (type === "activity" && features.has("start")) always.add("activity.start");
  if (type === "macro") always.add("macro.start");

  for (const item of COMMANDS) {
    if (item.entity_type !== type) continue;
    if (always.has(item.id)) continue;
    if (item.features.some((feature) => features.has(feature) || features.has(item.cmd_id) || features.has(item.id))) {
      always.add(item.id);
    }
  }
  return [...always];
}
