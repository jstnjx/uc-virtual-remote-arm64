import { describe, it, expect } from "vitest";

import { calculatePosition } from "@/composables/dropdownPosition";

const viewport = {
  innerWidth: 1000,
  innerHeight: 800,
  scrollX: 0,
  scrollY: 0,
};

// A 40px tall toggle at y=100, 200px wide dropdown unless stated otherwise.
const reference = { top: 100, bottom: 140, left: 200, height: 40 };
const dropdown = { width: 200, height: 300 };

describe("calculatePosition", () => {
  it("drops below the reference when there is room", () => {
    expect(calculatePosition(reference, dropdown, viewport)).toEqual({
      top: 140,
      left: 200,
      isDropUp: false,
    });
  });

  it("offsets by the scroll position", () => {
    expect(
      calculatePosition(reference, dropdown, { ...viewport, scrollY: 50 }),
    ).toEqual({ top: 190, left: 200, isDropUp: false });
  });

  it("flips up when it does not fit below but fits above", () => {
    // Toggle near the bottom: 800 - 640 - 20 = 140 below, 600 - 20 = 580 above.
    const low = { top: 600, bottom: 640, left: 200, height: 40 };

    expect(calculatePosition(low, dropdown, viewport)).toEqual({
      top: 300,
      left: 200,
      isDropUp: true,
    });
  });

  it("picks the larger side when the dropdown fits on neither", () => {
    const tall = { width: 200, height: 700 };
    // 300 below vs 460 above -> flip up, then clamped to the 10px margin.
    const middle = { top: 480, bottom: 480, left: 200, height: 40 };

    expect(calculatePosition(middle, tall, viewport)).toEqual({
      top: 10,
      left: 200,
      isDropUp: true,
    });

    // 660 below vs 100 above -> stay below.
    const high = { top: 120, bottom: 120, left: 200, height: 40 };

    expect(calculatePosition(high, tall, viewport)).toEqual({
      top: 160,
      left: 200,
      isDropUp: false,
    });
  });

  it("clamps a drop-up that would land above the viewport", () => {
    // Fits neither side, but above is roomier: 240 below vs 480 above.
    // Flipping up puts the 600px menu at -100, which clamps to the margin.
    const low = { top: 500, bottom: 540, left: 200, height: 40 };

    expect(
      calculatePosition(low, { width: 200, height: 600 }, viewport),
    ).toEqual({ top: 10, left: 200, isDropUp: true });
  });

  it("clamps the right edge to a 10px viewport margin", () => {
    const right = { top: 100, bottom: 140, left: 900, height: 40 };

    // 900 + 200 = 1100 > 990, so pull back to 990 - 200.
    expect(calculatePosition(right, dropdown, viewport).left).toBe(790);
  });

  it("clamps the left edge to a 10px viewport margin", () => {
    const wide = { width: 1200, height: 300 };

    // Wider than the viewport: right-clamping would go negative, so clamp left.
    expect(calculatePosition(reference, wide, viewport).left).toBe(10);
  });
});
