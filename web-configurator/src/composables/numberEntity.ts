/**
 * Number entities, slider-capable entity features and the `slider` / `number`
 * user interface widgets (Core-API number entity, `doc/ui-widgets.md`).
 *
 * UC Virtual Remote implementation, written from the public Core-API
 * documentation.
 */
import { EntityType } from "@/types/enums";

export type NumberDisplayMode = "auto" | "slider" | "stepper";
export type SliderStyle = "default" | "bar" | "buttons";
export type SliderColor = "auto" | "neutral" | "entity" | "gradient";
export type SliderFill = "auto" | "start" | "center" | "cursor";
export type SliderUpdateMode = "on_release" | "live";

export const NUMBER_DISPLAY_MODES: NumberDisplayMode[] = [
  "auto",
  "slider",
  "stepper",
];
export const SLIDER_STYLES: SliderStyle[] = ["default", "bar", "buttons"];
export const SLIDER_COLORS: SliderColor[] = [
  "auto",
  "neutral",
  "entity",
  "gradient",
];
export const SLIDER_FILLS: SliderFill[] = ["auto", "start", "center", "cursor"];
export const SLIDER_UPDATE_MODES: SliderUpdateMode[] = ["on_release", "live"];

/** Above this number of positions, `auto` shows a stepper instead of a slider. */
export const AUTO_SLIDER_MAX_POSITIONS = 256;

/** Default units of the number entity device classes. */
export const NUMBER_DEVICE_CLASS_UNITS: Record<string, string> = {
  temperature: "°C",
  humidity: "%",
  battery: "%",
  power: "W",
  energy: "kWh",
  voltage: "V",
  current: "A",
  duration: "s",
  distance: "m",
  speed: "km/h",
  illuminance: "lx",
  audio_level: "dB",
  percentage: "%",
};

type EntityLike = {
  entity_id?: string;
  entity_type?: string;
  device_class?: string;
  features?: string[];
  options?: Record<string, unknown>;
  attributes?: Record<string, unknown> | object;
};

export type SliderFeatureDefinition = {
  /** Feature is used when the target has no `feature`. */
  default?: boolean;
  /** Entity feature the entity must support, if any. */
  requires?: string;
  /** Only valid as touch slider target, not as slider widget. */
  touchSliderOnly?: boolean;
};

/** Slider-capable features per entity type. */
export const SLIDER_FEATURES: Record<
  string,
  Record<string, SliderFeatureDefinition>
> = {
  [EntityType.number]: { value: { default: true } },
  [EntityType.light]: {
    dim: { default: true, requires: "dim" },
    color_temperature: { requires: "color_temperature" },
  },
  [EntityType.media_player]: {
    volume: { default: true, requires: "volume" },
    seek: { requires: "seek", touchSliderOnly: true },
  },
  [EntityType.cover]: {
    position: { default: true, requires: "position" },
    tilt_position: { requires: "tilt_position" },
  },
  [EntityType.climate]: {
    target_temperature: { default: true, requires: "target_temperature" },
  },
};

export const SLIDER_ENTITY_TYPES = Object.keys(SLIDER_FEATURES);

function attributesOf(entity?: EntityLike | null): Record<string, unknown> {
  return (entity?.attributes ?? {}) as Record<string, unknown>;
}

function finite(value: unknown, fallback: number): number {
  const number = Number(value);
  return value !== null && value !== "" && Number.isFinite(number)
    ? number
    : fallback;
}

function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validDecimals(value: unknown): number | undefined {
  return Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= 6
    ? (value as number)
    : undefined;
}

export function decimalPlaces(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") return 0;
  const text = String(value);
  if (!/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(text)) return 0;
  const [mantissa, exponent] = text.toLowerCase().split("e");
  const places = (mantissa.split(".")[1] || "").length - Number(exponent || 0);
  return Math.max(0, Math.min(6, places));
}

export type NumberEntityData = {
  min: number | null;
  max: number | null;
  step: number;
  decimals: number;
  unit: string;
  value: number | null;
  /** Display mode of the entity, user override applied. */
  displayMode: NumberDisplayMode;
  readable: boolean;
  bounded: boolean;
};

/** Effective options of a number entity: Core-API defaults and user overrides. */
export function numberEntityData(entity?: EntityLike | null): NumberEntityData {
  const options = (entity?.options ?? {}) as Record<string, any>;
  const user = (options.user ?? {}) as Record<string, any>;
  const min = options.min === null ? null : finite(options.min, 0);
  const max = options.max === null ? null : finite(options.max, 100);
  const rawStep = optionalNumber(options.step);
  const step = rawStep !== null && rawStep >= 0.000001 ? rawStep : 1;
  const decimals =
    validDecimals(user.decimals) ??
    validDecimals(options.decimals) ??
    Math.max(
      decimalPlaces(step),
      decimalPlaces(min ?? 0),
      decimalPlaces(max ?? 0),
    );
  const unit = String(
    options.unit || NUMBER_DEVICE_CLASS_UNITS[entity?.device_class ?? ""] || "",
  );
  const displayMode: NumberDisplayMode = NUMBER_DISPLAY_MODES.includes(
    user.display_mode,
  )
    ? user.display_mode
    : NUMBER_DISPLAY_MODES.includes(options.display_mode)
      ? options.display_mode
      : "auto";
  return {
    min,
    max,
    step,
    decimals,
    unit,
    value: optionalNumber(attributesOf(entity).value),
    displayMode,
    readable: options.readable !== false,
    bounded: min !== null && max !== null,
  };
}

/**
 * Effective representation of a number entity. The widget's own display mode
 * takes precedence; an unbounded number is always a stepper.
 */
export function numberRepresentation(
  entity?: EntityLike | null,
  widgetMode: string = "auto",
): "slider" | "stepper" {
  const data = numberEntityData(entity);
  if (!data.bounded) return "stepper";
  const mode =
    widgetMode === "slider" || widgetMode === "stepper"
      ? widgetMode
      : data.displayMode;
  if (mode !== "auto") return mode;
  return (data.max! - data.min!) / data.step <= AUTO_SLIDER_MAX_POSITIONS
    ? "slider"
    : "stepper";
}

/** Format a value with a fixed number of decimal places and an optional unit. */
export function formatNumber(value: unknown, decimals = 0, unit = ""): string {
  const number = optionalNumber(value);
  if (number === null) return "—";
  const text = number.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return unit ? `${text} ${unit}` : text;
}

/** Effective decimal places of a sensor: user override, then option. */
export function sensorDecimals(entity?: EntityLike | null): number | undefined {
  const options = (entity?.options ?? {}) as Record<string, any>;
  return (
    validDecimals(options.user?.decimals) ?? validDecimals(options.decimals)
  );
}

/** Slider-capable features an entity supports. */
export function sliderFeaturesOf(
  entity?: EntityLike | null,
  { touchSlider = false } = {},
): string[] {
  const type = String(entity?.entity_type ?? "");
  const definitions = SLIDER_FEATURES[type];
  if (!definitions) return [];
  if (type === EntityType.number && !numberEntityData(entity).bounded)
    return [];
  const features = entity?.features ?? [];
  return Object.entries(definitions)
    .filter(([, definition]) => touchSlider || !definition.touchSliderOnly)
    .filter(([, definition]) => {
      if (!definition.requires) return true;
      // Included entities may come without features: offer the default.
      if (features.length === 0) return Boolean(definition.default);
      return features.includes(definition.requires);
    })
    .map(([feature]) => feature);
}

export function defaultSliderFeature(entityType?: string): string | null {
  const definitions = SLIDER_FEATURES[String(entityType ?? "")];
  if (!definitions) return null;
  return (
    Object.entries(definitions).find(([, item]) => item.default)?.[0] ?? null
  );
}

export type SliderFeatureData = {
  feature: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: string;
  decimals: number;
  /** Value shown as percentage of `max` (light brightness 0..255). */
  percent?: boolean;
  cmdId: string;
  param: string;
};

/** Range, value and command of a slider-capable entity feature. */
export function sliderFeatureData(
  entity?: EntityLike | null,
  requestedFeature?: string,
): SliderFeatureData | null {
  if (!entity) return null;
  const type = String(entity.entity_type ?? "");
  const feature = requestedFeature || defaultSliderFeature(type) || "";
  const attributes = attributesOf(entity);
  const options = (entity.options ?? {}) as Record<string, any>;
  if (type === EntityType.number && feature === "value") {
    const data = numberEntityData(entity);
    if (!data.bounded) return null;
    return {
      feature,
      min: data.min!,
      max: data.max!,
      step: data.step,
      value: data.value ?? data.min!,
      unit: data.unit,
      decimals: data.decimals,
      cmdId: "number.set_value",
      param: "value",
    };
  }
  if (type === EntityType.light && feature === "dim") {
    return {
      feature,
      min: 0,
      max: 255,
      step: 1,
      value: finite(attributes.brightness, 0),
      unit: "%",
      decimals: 0,
      percent: true,
      cmdId: "light.on",
      param: "brightness",
    };
  }
  if (type === EntityType.light && feature === "color_temperature") {
    const steps = finite(options.color_temperature_steps, 0);
    return {
      feature,
      min: 0,
      max: 100,
      step: steps > 1 ? 100 / (steps - 1) : 1,
      value: finite(attributes.color_temperature, 50),
      unit: "%",
      decimals: 0,
      cmdId: "light.on",
      param: "color_temperature",
    };
  }
  if (type === EntityType.media_player && feature === "volume") {
    const steps = finite(options.volume_steps, 100);
    return {
      feature,
      min: 0,
      max: 100,
      step: steps > 0 ? 100 / steps : 1,
      value: finite(attributes.volume, 0),
      unit: "",
      decimals: 0,
      cmdId: "media_player.volume",
      param: "volume",
    };
  }
  if (type === EntityType.media_player && feature === "seek") {
    return {
      feature,
      min: 0,
      max: Math.max(1, finite(attributes.media_duration, 0)),
      step: 1,
      value: finite(attributes.media_position, 0),
      unit: "s",
      decimals: 0,
      cmdId: "media_player.seek",
      param: "media_position",
    };
  }
  if (type === EntityType.cover && feature === "position") {
    return {
      feature,
      min: 0,
      max: 100,
      step: 1,
      value: finite(attributes.position ?? attributes.current_position, 0),
      unit: "%",
      decimals: 0,
      cmdId: "cover.position",
      param: "position",
    };
  }
  if (type === EntityType.cover && feature === "tilt_position") {
    return {
      feature,
      min: 0,
      max: 100,
      step: 1,
      value: finite(attributes.tilt_position, 0),
      unit: "%",
      decimals: 0,
      cmdId: "cover.tilt",
      param: "tilt_position",
    };
  }
  if (type === EntityType.climate && feature === "target_temperature") {
    const step = Math.max(
      0.1,
      finite(
        options.target_temperature_step ?? attributes.target_temperature_step,
        0.5,
      ),
    );
    const min = finite(
      options.min_temperature ?? attributes.min_temperature,
      10,
    );
    const max = finite(
      options.max_temperature ?? attributes.max_temperature,
      30,
    );
    return {
      feature,
      min,
      max,
      step,
      value: finite(attributes.target_temperature, min),
      unit: String(
        options.temperature_unit ?? attributes.temperature_unit ?? "°",
      ),
      decimals: decimalPlaces(step),
      cmdId: "climate.target_temperature",
      param: "temperature",
    };
  }
  return null;
}

export function sliderValueText(data: SliderFeatureData, value: number) {
  if (data.percent) return `${Math.round((value / data.max) * 100)}%`;
  return formatNumber(value, data.decimals, data.unit);
}
