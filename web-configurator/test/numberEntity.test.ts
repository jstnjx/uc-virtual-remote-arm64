import { describe, expect, test } from "vitest";

import {
  formatNumber,
  numberEntityData,
  numberRepresentation,
  sensorDecimals,
  sliderFeatureData,
  sliderFeaturesOf,
} from "@/composables/numberEntity";

describe("number entity options", () => {
  test("apply the Core-API defaults and device class units", () => {
    const data = numberEntityData({
      entity_type: "number",
      device_class: "audio_level",
    });
    expect(data).toMatchObject({
      min: 0,
      max: 100,
      step: 1,
      decimals: 0,
      unit: "dB",
      bounded: true,
    });
  });

  test("keep unbounded limits and derive decimals from the step", () => {
    const data = numberEntityData({
      entity_type: "number",
      options: { min: null, max: null, step: 0.25 },
    });
    expect(data.bounded).toBe(false);
    expect(data.decimals).toBe(2);
  });

  test("prefer the user overrides", () => {
    const entity = {
      entity_type: "number",
      options: {
        decimals: 1,
        display_mode: "slider",
        user: { decimals: 3, display_mode: "stepper" },
      },
    };
    expect(numberEntityData(entity).decimals).toBe(3);
    expect(numberRepresentation(entity)).toBe("stepper");
    expect(numberRepresentation(entity, "slider")).toBe("slider");
  });

  test("auto shows a slider up to 256 positions", () => {
    expect(
      numberRepresentation({
        entity_type: "number",
        options: { min: 0, max: 256 },
      }),
    ).toBe("slider");
    expect(
      numberRepresentation({
        entity_type: "number",
        options: { min: 0, max: 1000 },
      }),
    ).toBe("stepper");
    expect(
      numberRepresentation(
        { entity_type: "number", options: { max: null } },
        "slider",
      ),
    ).toBe("stepper");
  });

  test("sensor decimals use the user override first", () => {
    expect(
      sensorDecimals({ options: { decimals: 1, user: { decimals: 2 } } }),
    ).toBe(2);
    expect(sensorDecimals({ options: {} })).toBeUndefined();
  });

  test("formats with fixed decimals", () => {
    expect(formatNumber(1.5, 2, "dB")).toMatch(/^1[.,]50 dB$/);
    expect(formatNumber(null)).toBe("—");
  });
});

describe("slider features", () => {
  test("follow the entity features", () => {
    expect(
      sliderFeaturesOf({
        entity_type: "light",
        features: ["on_off", "dim", "color_temperature"],
      }),
    ).toEqual(["dim", "color_temperature"]);
    expect(
      sliderFeaturesOf({
        entity_type: "media_player",
        features: ["volume", "seek"],
      }),
    ).toEqual(["volume"]);
    expect(
      sliderFeaturesOf(
        { entity_type: "media_player", features: ["volume", "seek"] },
        { touchSlider: true },
      ),
    ).toEqual(["volume", "seek"]);
    expect(
      sliderFeaturesOf({ entity_type: "number", options: { max: null } }),
    ).toEqual([]);
    expect(sliderFeaturesOf({ entity_type: "switch" })).toEqual([]);
  });

  test("resolve the command and range of a feature", () => {
    expect(
      sliderFeatureData({
        entity_type: "light",
        attributes: { brightness: 128 },
      }),
    ).toMatchObject({
      cmdId: "light.on",
      param: "brightness",
      max: 255,
      value: 128,
    });
    expect(
      sliderFeatureData({
        entity_type: "number",
        options: { min: -10, max: 10, step: 0.5 },
        attributes: { value: 2 },
      }),
    ).toMatchObject({
      cmdId: "number.set_value",
      min: -10,
      max: 10,
      step: 0.5,
      value: 2,
    });
    expect(
      sliderFeatureData(
        { entity_type: "climate", attributes: { target_temperature: 21 } },
        "target_temperature",
      ),
    ).toMatchObject({
      cmdId: "climate.target_temperature",
      param: "temperature",
    });
  });
});
