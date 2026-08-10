import { expect, test } from "vitest";
import { formatDate } from "../src/composables/date";
import { getItemAttrValue } from "../src/composables/entity";

///////////////////////////////////////////////////////////////////////////////
// ISO8601 full date/time tests
///////////////////////////////////////////////////////////////////////////////

test("formats full ISO8601 date/time with timezone", () => {
  const value = "2025-11-13T11:00:00+00:00";
  const result = getItemAttrValue(value);
  const formatted = formatDate(value);
  expect(result).toBe(formatted);
});

test("formats ISO8601 date only (YYYY-MM-DD)", () => {
  const value = "2025-11-13";
  const result = getItemAttrValue(value);
  const formatted = formatDate(value);
  expect(result).toBe(formatted);
});

///////////////////////////////////////////////////////////////////////////////
// Non-ISO inputs should remain unchanged
///////////////////////////////////////////////////////////////////////////////

test("does not format numeric string like '42'", () => {
  const value = "42";
  const result = getItemAttrValue(value);
  expect(result).toBe("42");
});

test("does not format numeric string like '11.6'", () => {
  const value = "11.6";
  const result = getItemAttrValue(value);
  expect(result).toBe("11.6");
});

test("does not format numeric string like '11.25' with decimals 1", () => {
  const value = "11.25";
  const result = getItemAttrValue(value, undefined, 1);
  expect(result).toBe("11.25");
});

test("does not format numeric string like '11.25' with decimals 3", () => {
  const value = "11.25";
  const result = getItemAttrValue(value, undefined, 3);
  expect(result).toBe("11.25");
});

test("format number 42", () => {
  const value = 42;
  const result = getItemAttrValue(value);
  expect(result).toBe("42");
});

test("format number 11.25 with default decimals", () => {
  const value = 11.25;
  const result = getItemAttrValue(value);
  expect(result).toBe("11");
});

test("format number 11.25 with decimals 2", () => {
  const value = 11.25;
  const result = getItemAttrValue(value, undefined, 2);
  expect(result).toBe("11.25");
});

test("does not format large numeric string timestamp", () => {
  const value = "1718042290000";
  const result = getItemAttrValue(value);
  expect(result).toBe("1718042290000");
});

///////////////////////////////////////////////////////////////////////////////
// Edge cases
///////////////////////////////////////////////////////////////////////////////

test("returns null and undefined as-is", () => {
  expect(getItemAttrValue(null as any)).toBeNull();
  expect(getItemAttrValue(undefined as any)).toBeUndefined();
});

test("returns empty string as-is", () => {
  expect(getItemAttrValue("")).toBe("");
});

test("does not format random string", () => {
  const value = "hello world";
  const result = getItemAttrValue(value);
  expect(result).toBe("hello world");
});
