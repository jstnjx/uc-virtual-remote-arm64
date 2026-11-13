// Number entity, user option overrides and entity feature targets.
//
// Core-API references:
// - doc/entities/entity_number.md (options, value format, display mode)
// - doc/entities/README.md "User overrides" (options.user)
// - doc/ui-widgets.md (slider and number widgets, entity feature targets)

export const NUMBER_DEVICE_CLASS_UNITS = Object.freeze({
  audio_level: "dB",
  battery: "%",
  current: "A",
  duration: "s",
  energy: "kWh",
  humidity: "%",
  illuminance: "lx",
  power: "W",
  temperature: "°C",
  voltage: "V",
});

export const NUMBER_DISPLAY_MODES = Object.freeze(["auto", "slider", "stepper"]);
export const SLIDER_STYLES = Object.freeze(["default", "bar", "buttons"]);
export const SLIDER_COLORS = Object.freeze(["auto", "neutral", "entity", "gradient"]);
export const SLIDER_FILLS = Object.freeze(["auto", "start", "center", "cursor"]);
export const SLIDER_UPDATE_MODES = Object.freeze(["on_release", "live"]);

// Number of positions up to which `display_mode: auto` renders a slider.
export const AUTO_SLIDER_MAX_POSITIONS = 256;

// User overridable options per entity type.
const USER_OVERRIDES = Object.freeze({
  sensor: Object.freeze(["decimals"]),
  number: Object.freeze(["decimals", "display_mode"]),
});

function validationError(message) {
  return Object.assign(new Error(message), { status: 422, code: "VALIDATION_ERROR", errorCode: "VALIDATION_ERROR" });
}

function finiteOrNull(value, fallback) {
  if (value === null) return null;
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function validDecimals(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 6 ? number : undefined;
}

function decimalPlaces(value) {
  if (!Number.isFinite(value)) return 0;
  const text = String(Math.abs(value));
  if (text.includes("e-")) {
    const [mantissa, exponent] = text.split("e-");
    return Math.min(6, Number(exponent) + (mantissa.split(".")[1]?.length || 0));
  }
  return Math.min(6, text.split(".")[1]?.length || 0);
}

// Effective number entity options with the Core-API defaults applied. The
// `user` overrides are kept separately and are not merged into the result.
export function numberOptions(options = {}, deviceClass = undefined) {
  const source = options && typeof options === "object" ? options : {};
  const min = finiteOrNull(source.min, 0);
  const max = finiteOrNull(source.max, 100);
  const rawStep = Number(source.step);
  const step = Number.isFinite(rawStep) && rawStep >= 0.000001 ? rawStep : 1;
  const unit = typeof source.unit === "string" && source.unit !== ""
    ? source.unit
    : NUMBER_DEVICE_CLASS_UNITS[String(deviceClass || "")] || undefined;
  const displayMode = NUMBER_DISPLAY_MODES.includes(source.display_mode) ? source.display_mode : "auto";
  const result = {
    min,
    max,
    step,
    display_mode: displayMode,
    readable: source.readable !== false,
  };
  const decimals = validDecimals(source.decimals);
  if (decimals !== undefined) result.decimals = decimals;
  if (unit !== undefined) result.unit = unit;
  return result;
}

export function numberBounded(options = {}) {
  const effective = numberOptions(options);
  return effective.min !== null && effective.max !== null;
}

// Effective decimal places: user override, then the `decimals` option, then
// the decimal places of `step`, `min` and `max`.
export function numberDecimals(entity = {}) {
  const options = entity.options || {};
  const user = validDecimals(options.user?.decimals);
  if (user !== undefined) return user;
  const effective = numberOptions(options, entity.device_class);
  if (effective.decimals !== undefined) return effective.decimals;
  return Math.max(decimalPlaces(effective.step), decimalPlaces(effective.min ?? 0), decimalPlaces(effective.max ?? 0));
}

// Effective representation of a number entity. `widgetMode` is the number
// widget's own `display_mode`, which takes precedence over the entity.
export function numberRepresentation(entity = {}, widgetMode = "auto") {
  const options = entity.options || {};
  const effective = numberOptions(options, entity.device_class);
  if (effective.min === null || effective.max === null) return "stepper";
  let mode = NUMBER_DISPLAY_MODES.includes(widgetMode) ? widgetMode : "auto";
  if (mode === "auto" && NUMBER_DISPLAY_MODES.includes(options.user?.display_mode)) mode = options.user.display_mode;
  if (mode === "auto") mode = effective.display_mode;
  if (mode !== "auto") return mode;
  const positions = (effective.max - effective.min) / effective.step;
  return positions <= AUTO_SLIDER_MAX_POSITIONS ? "slider" : "stepper";
}

export function clampNumber(value, options = {}) {
  const effective = numberOptions(options);
  let next = Number(value);
  if (!Number.isFinite(next)) return null;
  if (effective.min !== null) next = Math.max(effective.min, next);
  if (effective.max !== null) next = Math.min(effective.max, next);
  // Remove floating point artifacts like 1.499999999999997.
  return Number(next.toPrecision(15));
}

// Strip a driver supplied `options.user`: it is reserved for the Remote.
export function driverOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return options;
  if (!Object.prototype.hasOwnProperty.call(options, "user")) return options;
  const { user: _user, ...rest } = options;
  return rest;
}

function cleanUserOverrides(entityType, user) {
  const allowed = USER_OVERRIDES[String(entityType || "")] || [];
  const result = {};
  for (const key of allowed) {
    if (!user || !Object.prototype.hasOwnProperty.call(user, key)) continue;
    const value = user[key];
    if (key === "decimals") {
      const decimals = validDecimals(value);
      if (decimals !== undefined) result.decimals = decimals;
    } else if (key === "display_mode") {
      if (NUMBER_DISPLAY_MODES.includes(value)) result.display_mode = value;
    }
  }
  return result;
}

// Merge an `EntityOptionsUpdate` (`{ user: {...} | null }`) into the current
// options. Only the user overrides can be changed.
export function applyEntityOptionsUpdate(entity = {}, update = undefined) {
  const current = entity.options && typeof entity.options === "object" ? { ...entity.options } : {};
  if (!update || typeof update !== "object" || Array.isArray(update)) return current;
  if (!Object.prototype.hasOwnProperty.call(update, "user")) return current;
  const allowed = USER_OVERRIDES[String(entity.entity_type || "")] || [];
  if (update.user === null) {
    delete current.user;
    return current;
  }
  if (typeof update.user !== "object" || Array.isArray(update.user)) {
    throw validationError("options.user must be an object or null");
  }
  const user = { ...(current.user || {}) };
  for (const [key, value] of Object.entries(update.user)) {
    if (!allowed.includes(key)) continue;
    if (value === null) {
      delete user[key];
      continue;
    }
    if (key === "decimals" && validDecimals(value) === undefined) {
      throw validationError("options.user.decimals must be an integer between 0 and 6");
    }
    if (key === "display_mode" && !NUMBER_DISPLAY_MODES.includes(value)) {
      throw validationError("options.user.display_mode must be auto, slider or stepper");
    }
    user[key] = key === "decimals" ? Number(value) : value;
  }
  const cleaned = cleanUserOverrides(entity.entity_type, user);
  if (Object.keys(cleaned).length) current.user = cleaned;
  else delete current.user;
  return current;
}

// Options of an updated driver definition, keeping the user overrides of the
// configured entity.
export function mergeDriverOptions(previousOptions, nextOptions, entityType) {
  const next = driverOptions(nextOptions && typeof nextOptions === "object" ? nextOptions : {}) || {};
  const user = cleanUserOverrides(entityType, previousOptions?.user);
  return Object.keys(user).length ? { ...next, user } : { ...next };
}

// Slider-capable features: entity type -> feature -> definition.
export const SLIDER_FEATURES = Object.freeze({
  number: Object.freeze({ value: { default: true, attribute: "value", command: "set_value", param: "value" } }),
  light: Object.freeze({
    dim: { default: true, attribute: "brightness", command: "on", param: "brightness", requires: "dim" },
    color_temperature: { attribute: "color_temperature", command: "on", param: "color_temperature", requires: "color_temperature" },
  }),
  media_player: Object.freeze({
    volume: { default: true, attribute: "volume", command: "volume", param: "volume", requires: "volume" },
    seek: { touchSliderOnly: true, attribute: "media_position", command: "seek", param: "media_position", requires: "seek" },
  }),
  cover: Object.freeze({
    position: { default: true, attribute: "position", command: "position", param: "position", requires: "position" },
    tilt_position: { attribute: "tilt_position", command: "tilt", param: "tilt_position", requires: "tilt_position" },
  }),
  climate: Object.freeze({
    target_temperature: { default: true, attribute: "target_temperature", command: "target_temperature", param: "temperature", requires: "target_temperature" },
  }),
});

export function defaultSliderFeature(entityType) {
  const features = SLIDER_FEATURES[String(entityType || "")];
  if (!features) return null;
  return Object.entries(features).find(([, item]) => item.default)?.[0] || null;
}

// Validate an entity feature target against a configured entity. Returns the
// resolved feature name. `entity` may be null when the entity is not known
// (yet); then only the feature name is checked against the known types.
export function validateFeatureTarget(target, entity, { touchSlider = false } = {}) {
  if (!target || typeof target !== "object") throw validationError("Entity feature target must be an object");
  const entityId = String(target.entity_id || "").trim();
  if (!entityId) throw validationError("Entity feature target requires entity_id");
  if (!entity) return target.feature ? String(target.feature) : null;
  const type = String(entity.entity_type || "");
  const features = SLIDER_FEATURES[type];
  if (!features) throw validationError(`Entity ${entityId} of type ${type || "unknown"} has no slider-capable feature`);
  const feature = target.feature ? String(target.feature) : defaultSliderFeature(type);
  const definition = features[feature];
  if (!definition) throw validationError(`Feature ${feature} is not a slider-capable feature of ${type} entities`);
  if (definition.touchSliderOnly && !touchSlider) throw validationError(`Feature ${type}.${feature} can only be used for the touch slider`);
  if (type === "number" && !numberBounded(entity.options)) {
    throw validationError(`Number entity ${entityId} is unbounded and cannot be used as slider target`);
  }
  return feature;
}

function enumValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function normalizeSliderItem(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const slider = { entity_id: String(source.entity_id || "") };
  if (source.feature) slider.feature = String(source.feature);
  slider.show_name = Boolean(source.show_name ?? false);
  slider.show_value = source.show_value === undefined ? true : Boolean(source.show_value);
  if (source.icon_min) slider.icon_min = String(source.icon_min);
  if (source.icon_max) slider.icon_max = String(source.icon_max);
  const min = optionalNumber(source.min);
  const max = optionalNumber(source.max);
  if (min !== undefined) slider.min = min;
  if (max !== undefined) slider.max = max;
  slider.update_mode = enumValue(source.update_mode, SLIDER_UPDATE_MODES, "on_release");
  slider.style = enumValue(source.style, SLIDER_STYLES, "default");
  slider.color = enumValue(source.color, SLIDER_COLORS, "auto");
  slider.fill = enumValue(source.fill, SLIDER_FILLS, "auto");
  return slider;
}

export function normalizeNumberItem(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const number = { number_id: String(source.number_id || source.entity_id || "") };
  number.show_name = Boolean(source.show_name ?? false);
  number.display_mode = enumValue(source.display_mode, NUMBER_DISPLAY_MODES, "auto");
  const step = optionalNumber(source.step);
  if (step !== undefined && step >= 0.000001) number.step = step;
  return number;
}
