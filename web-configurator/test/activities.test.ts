import { describe, it, expect } from "vitest";
import { getBinarySensorState } from "../src/composables/activities";
import {
  BinarySensorUnit,
  BinarySensorUnitOn,
  BinarySensorUnitOff,
} from "../src/types/enums";

describe("getBinarySensorState", () => {
  it("should return the ON state value when value is 'on'", () => {
    const result = getBinarySensorState(BinarySensorUnit.door, "on");
    expect(result).toBe(BinarySensorUnitOn.door); // "opened"
  });

  it("should return the OFF state value when value is 'off'", () => {
    const result = getBinarySensorState(BinarySensorUnit.door, "off");
    expect(result).toBe(BinarySensorUnitOff.door); // "closed"
  });

  it("should handle uppercase or mixed-case input", () => {
    const result = getBinarySensorState(BinarySensorUnit.motion, "On");
    expect(result).toBe(BinarySensorUnitOn.motion); // "detected"
  });

  it("should fall back to OFF state if value is anything other than 'on'", () => {
    const result = getBinarySensorState(BinarySensorUnit.power, "random");
    expect(result).toBe(BinarySensorUnitOff.power); // "off"
  });

  it("should return the ON state value when value is 'on' and unit is 'null'", () => {
    const result = getBinarySensorState(null, "on");
    expect(result).toBe(BinarySensorUnitOn.none); // "on"
  });

  it("should return the OFF state value when value is 'on' and unit is undefined'", () => {
    const result = getBinarySensorState(undefined, "off");
    expect(result).toBe(BinarySensorUnitOff.none); // "off"
  });
});
