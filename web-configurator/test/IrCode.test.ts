import { expect, test } from "vitest";

import { detectCodeFormat } from "../src/composables/irCode";

///////////////////////////////////////////////////////////////////////////////
// IR code format detection test
///////////////////////////////////////////////////////////////////////////////

test("detectCodeFormat returns null for invalid input", () => {
  expect(detectCodeFormat(""), "empty code is not valid").toBe(null);
  expect(detectCodeFormat("foobar")).toBe(null);
});

test("detectCodeFormat detects a single HEX code", () => {
  expect(detectCodeFormat("3;0x20F0A956;32;0")).toBe("HEX");
  expect(
    detectCodeFormat("3;0x20F0A956;32;0 | 3;0x20F0A956;32;0"),
    "Toggle not allowed",
  ).toBe(null);
});

test("detectCodeFormat detects a multi HEX code", () => {
  expect(
    detectCodeFormat("3;0x20F0A956;32;0 + 3;0x20F0A956;32;0"),
    "IR sequence allowed",
  ).toBe("HEX");
  expect(
    detectCodeFormat(
      "3;0x20F0A956;32;0 + 3;0x20F0A956;32;0 + 3;0x20F0A956;32;0 + 3;0x20F0A956;32;0",
    ),
    "IR sequence may contain more than 2 codes",
  ).toBe("HEX");
});

test("detectCodeFormat returns null for invalid HEX codes", () => {
  expect(detectCodeFormat("3:0x20F0A956:32:0"), "invalid separator").toBe(null);
  expect(detectCodeFormat("3;20F0A956;32;0"), "data requires 0x prefix").toBe(
    null,
  );

  const codes = [
    "3;0x20F0A956;32;",
    "3;0x20F0A956;32",
    "3;0x20F0A956;",
    "3;0x20F0A956",
    "3;",
    "3",
  ];
  for (const code of codes) {
    expect(detectCodeFormat(code), "HEX requires all 4 components").toBe(null);
  }
});

test("detectCodeFormat returns null for toggle HEX codes", () => {
  expect(
    detectCodeFormat("3;0x20F0A956;32;0 | 3;0x20F0A956;32;0"),
    "toggle is not allowed",
  ).toBe(null);
});

test("detectCodeFormat returns null for invalid PRONTO codes", () => {
  expect(detectCodeFormat("0000"), "PRONTO requires at least 6 numbers").toBe(
    null,
  );
  expect(
    detectCodeFormat("0000 0068 0001 0000 0002"),
    "PRONTO requires at least 6 numbers",
  ).toBe(null);
  expect(
    detectCodeFormat("0000 0068 0001 0000 0002 noob"),
    "invalid code value",
  ).toBe(null);
  expect(
    detectCodeFormat("0000,0068,0001,0000,0002,0800"),
    "comma is not allowed as separator",
  ).toBe(null);
});

test("detectCodeFormat returns null for unsupported PRONTO code types", () => {
  expect(
    detectCodeFormat("5000 0068 0001 0000 0002 0800"),
    "RC5 encoding not supported",
  ).toBe(null);
  expect(
    detectCodeFormat("5001 0068 0001 0000 0002 0800"),
    "RC5x encoding not supported",
  ).toBe(null);
  expect(
    detectCodeFormat("6000 0068 0001 0000 0002 0800"),
    "RC6 encoding not supported",
  ).toBe(null);
  expect(
    detectCodeFormat("900a 0068 0001 0000 0002 0800"),
    "NEC encoding not supported",
  ).toBe(null);
});

test("detectCodeFormat detects a single PRONTO code", () => {
  expect(detectCodeFormat("0000 0068 0001 0000 0002 0001"), "valid code").toBe(
    "PRONTO",
  );
});

test("detectCodeFormat detects a PRONTO sequence", () => {
  expect(
    detectCodeFormat(
      "0000 0068 0001 0000 0002 0800 + 0000 0068 0001 0000 0002 0800",
    ),
    "IR sequence is allowed",
  ).toBe("PRONTO");
  expect(
    detectCodeFormat(
      "0000 0068 0001 0000 0002 0800 + 0000 0068 0001 0000 0002 0800 + 0000 0068 0001 0000 0002 0800",
    ),
    "IR sequence may contain more than 2 codes",
  ).toBe("PRONTO");
});

test("detectCodeFormat detects a PRONTO toggle", () => {
  expect(
    detectCodeFormat(
      "0000 0068 0001 0000 0002 0800 | 0000 0068 0001 0000 0002 0800",
    ),
    "IR toggle is allowed",
  ).toBe("PRONTO");
  expect(
    detectCodeFormat(
      "0000 0068 0001 0000 0002 0800 | 0000 0068 0001 0000 0002 0800 | 0000 0068 0001 0000 0002 0800",
    ),
    "IR toggle may not contain more than 2 codes",
  ).toBe(null);
  expect(
    detectCodeFormat("0000 0068 0001 0000 0002 0800 | 3;0x20F0A956;32;0"),
    "Toggle may not contain mixed codes",
  ).toBe(null);
});
