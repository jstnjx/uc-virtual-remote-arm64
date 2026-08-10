/**
 * mergeEventPayload tests — docs/specs/004-ws-event-handling-rework.md §6 (W3 core).
 */
import { describe, expect, test } from "vitest";
import { mergeEventPayload } from "../src/composables/dataHelper";

describe("mergeEventPayload", () => {
  test("nested partials preserve sibling keys (partial-safe)", () => {
    const cached = {
      entity_id: "media.1",
      name: { en: "TV" },
      attributes: { state: "OFF", volume: 30, source: "HDMI1" },
    };
    mergeEventPayload(cached, { attributes: { state: "ON" } } as never);
    expect(cached.attributes).toEqual({
      state: "ON",
      volume: 30,
      source: "HDMI1",
    });
    expect(cached.name).toEqual({ en: "TV" }); // untouched branch preserved
  });

  test("arrays are replaced wholesale — shrunk arrays leave no stale tail", () => {
    const cached = {
      options: ["a", "b", "c", "d", "e"],
      simple_commands: [{ id: 1 }, { id: 2 }],
    };
    mergeEventPayload(cached, {
      options: ["x", "y"],
      simple_commands: [{ id: 9 }],
    } as never);
    expect(cached.options).toEqual(["x", "y"]);
    expect(cached.simple_commands).toEqual([{ id: 9 }]);
  });

  test("array replaces a non-array value and vice versa", () => {
    const cached: Record<string, unknown> = { a: [1, 2], b: "scalar" };
    mergeEventPayload(cached, { a: "now-scalar", b: [3] } as never);
    expect(cached.a).toBe("now-scalar");
    expect(cached.b).toEqual([3]);
  });

  test("null and primitives replace; object identity is preserved", () => {
    const attributes = { state: "OFF", brightness: 128 };
    const cached = { attributes, extra: "keep" };
    const result = mergeEventPayload(cached, {
      attributes: { brightness: null },
    } as never);
    expect(result).toBe(cached); // in place
    expect(cached.attributes).toBe(attributes); // nested identity stable
    expect(cached.attributes.brightness).toBe(null);
    expect(cached.attributes.state).toBe("OFF");
    expect(cached.extra).toBe("keep");
  });

  test("patch object over a null/primitive target replaces it", () => {
    const cached: Record<string, unknown> = { nested: null, plain: 5 };
    mergeEventPayload(cached, {
      nested: { fresh: true },
      plain: { alsoFresh: true },
    } as never);
    expect(cached.nested).toEqual({ fresh: true });
    expect(cached.plain).toEqual({ alsoFresh: true });
  });
});
