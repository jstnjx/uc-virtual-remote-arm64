import { expect, test } from "vitest";
import { useSequenceHandler } from "../src/composables/sequence";
import type { ActiveSequence } from "../src/types/command";

// Helper sequence
const initialActiveSequence: ActiveSequence = {
  type: null,
  state: "",
  steps: [],
  totalSteps: 0,
};

///////////////////////////////////////////////////////////////////////////////
// hasActiveSequence tests
///////////////////////////////////////////////////////////////////////////////

test("hasActiveSequence returns false when type is null", () => {
  const { hasActiveSequence } = useSequenceHandler({
    ...initialActiveSequence,
  });
  expect(hasActiveSequence()).toBe(false);
});

test("hasActiveSequence returns true when type is 'on'", () => {
  const seq = { ...initialActiveSequence, type: "on" as const };
  const { hasActiveSequence } = useSequenceHandler(seq);
  expect(hasActiveSequence()).toBe(true);
  expect(hasActiveSequence("on")).toBe(true);
  expect(hasActiveSequence("off")).toBe(false);
  expect(hasActiveSequence("run")).toBe(false);
});

test("hasActiveSequence returns true when type is 'off'", () => {
  const seq = { ...initialActiveSequence, type: "off" as const };
  const { hasActiveSequence } = useSequenceHandler(seq);
  expect(hasActiveSequence()).toBe(true);
  expect(hasActiveSequence("off")).toBe(true);
  expect(hasActiveSequence("on")).toBe(false);
  expect(hasActiveSequence("run")).toBe(false);
});

test("hasActiveSequence returns true when type is 'run'", () => {
  const seq = { ...initialActiveSequence, type: "run" as const };
  const { hasActiveSequence } = useSequenceHandler(seq);
  expect(hasActiveSequence()).toBe(true);
  expect(hasActiveSequence("run")).toBe(true);
  expect(hasActiveSequence("on")).toBe(false);
  expect(hasActiveSequence("off")).toBe(false);
});

///////////////////////////////////////////////////////////////////////////////
// getSequenceItemStatus tests
///////////////////////////////////////////////////////////////////////////////

test("getSequenceItemStatus returns null if state is empty", () => {
  const seq = { ...initialActiveSequence, type: "on" as const, state: "" };
  const { getSequenceItemStatus } = useSequenceHandler(seq);
  expect(getSequenceItemStatus(0)).toBeNull();
});

test("getSequenceItemStatus returns WAITING if steps.length == index", () => {
  const seq = {
    ...initialActiveSequence,
    type: "on" as const,
    state: "RUNNING",
    steps: [{ index: 0 }] as any,
  };
  const { getSequenceItemStatus } = useSequenceHandler(seq);
  expect(getSequenceItemStatus(0)).toEqual({ state: "WAITING" });
});

test("getSequenceItemStatus returns IDLE if steps.length < index + 1", () => {
  const seq = {
    ...initialActiveSequence,
    type: "on" as const,
    state: "RUNNING",
    steps: [],
  };
  const { getSequenceItemStatus } = useSequenceHandler(seq);
  expect(getSequenceItemStatus(5)).toEqual({ state: "IDLE" });
});

test("getSequenceItemStatus returns DONE for finished step without error", () => {
  const seq = {
    ...initialActiveSequence,
    type: "on" as const,
    state: "RUNNING",
    steps: [{ index: 0, state: "OK" }] as any,
  };
  const { getSequenceItemStatus } = useSequenceHandler(seq);
  expect(getSequenceItemStatus(0)).toEqual({ state: "WAITING" });
});

test("getSequenceItemStatus returns ERROR and errorMessage if step has error", () => {
  const seq = {
    ...initialActiveSequence,
    type: "on" as const,
    state: "ERROR",
    steps: [{ index: 0, state: "ERROR", error: "Device unreachable." }] as any,
  };
  const { getSequenceItemStatus } = useSequenceHandler(seq);
  expect(getSequenceItemStatus(0)).toEqual({
    state: "ERROR",
    errorMessage: "Device unreachable.",
  });
});
