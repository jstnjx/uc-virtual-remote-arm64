/**
 * Pure login-flow helper tests — docs/specs/002-login-flow-hardening.md §5
 * (A1 classification, A12 guard decision table, A13 error-key mapping).
 */
import { describe, expect, test } from "vitest";
import {
  decideLoginRedirect,
  isTransientAuthError,
  toLoginErrorKey,
} from "../src/composables/authHelpers";
import enUS from "../src/i18next/en_US.json";

describe("isTransientAuthError (A1)", () => {
  test("network conditions are transient", () => {
    expect(isTransientAuthError("ERR_NETWORK")).toBe(true);
    expect(isTransientAuthError("ERR_CANCELED")).toBe(true);
    expect(isTransientAuthError("ECONNABORTED")).toBe(true);
    expect(isTransientAuthError("error.HAS_TIMEOUT")).toBe(true);
    expect(isTransientAuthError({ code: "ERR_NETWORK" })).toBe(true);
    expect(isTransientAuthError(new Error("error.HAS_TIMEOUT"))).toBe(true);
  });

  test("rejections and unknowns are definitive", () => {
    expect(isTransientAuthError("NOT_AUTHORIZED")).toBe(false);
    expect(isTransientAuthError("VALIDATION_ERROR")).toBe(false);
    expect(isTransientAuthError(undefined)).toBe(false);
    expect(isTransientAuthError(null)).toBe(false);
    expect(isTransientAuthError("")).toBe(false);
    expect(isTransientAuthError({})).toBe(false);
  });
});

describe("toLoginErrorKey (A13)", () => {
  const knownKeys = Object.keys(
    (enUS as any).translation.login.error as Record<string, string>,
  );

  test("known codes map to themselves", () => {
    expect(toLoginErrorKey("NOT_AUTHORIZED")).toBe(
      "login.error.NOT_AUTHORIZED",
    );
    expect(toLoginErrorKey("not_authorized")).toBe(
      "login.error.NOT_AUTHORIZED",
    );
    expect(toLoginErrorKey({ code: "ERR_NETWORK" })).toBe(
      "login.error.ERR_NETWORK",
    );
  });

  test("timeout variants map to TIMEOUT", () => {
    expect(toLoginErrorKey("ECONNABORTED")).toBe("login.error.TIMEOUT");
    expect(toLoginErrorKey("error.HAS_TIMEOUT")).toBe("login.error.TIMEOUT");
    expect(toLoginErrorKey(new Error("error.HAS_TIMEOUT"))).toBe(
      "login.error.TIMEOUT",
    );
  });

  test("unknown codes fall back to UNKNOWN", () => {
    expect(toLoginErrorKey("SOMETHING_ODD")).toBe("login.error.UNKNOWN");
    expect(toLoginErrorKey(undefined)).toBe("login.error.UNKNOWN");
    expect(toLoginErrorKey({})).toBe("login.error.UNKNOWN");
  });

  test("every producible key exists in en_US.json (never leak a raw key)", () => {
    const candidates = [
      "NOT_AUTHORIZED",
      "VALIDATION_ERROR",
      "ERR_NETWORK",
      "ERR_CANCELED",
      "ECONNABORTED",
      "error.HAS_TIMEOUT",
      "garbage",
      undefined,
      { code: 42 },
    ];
    for (const c of candidates) {
      const key = toLoginErrorKey(c).replace("login.error.", "");
      expect(knownKeys.includes(key)).toBe(true);
    }
  });
});

describe("decideLoginRedirect (A12)", () => {
  test("unauthenticated on protected route → login with redirect", () => {
    expect(
      decideLoginRedirect({
        isAuthenticated: false,
        toName: "general",
        toFullPath: "/settings/general",
      }),
    ).toEqual({ name: "login", query: { redirect: "/settings/general" } });
  });

  test("unauthenticated on home → login without redirect query", () => {
    expect(
      decideLoginRedirect({
        isAuthenticated: false,
        toName: "home",
        toFullPath: "/",
      }),
    ).toEqual({ name: "login", query: {} });
  });

  test("unauthenticated already heading to login → pass", () => {
    expect(
      decideLoginRedirect({
        isAuthenticated: false,
        toName: "login",
        toFullPath: "/login",
      }),
    ).toBe(undefined);
  });

  test("authenticated on login → stored redirect target wins", () => {
    expect(
      decideLoginRedirect({
        isAuthenticated: true,
        toName: "login",
        toFullPath: "/login",
        redirectQuery: "/settings/general",
      }),
    ).toBe("/settings/general");
  });

  test("authenticated on login without redirect → home", () => {
    expect(
      decideLoginRedirect({
        isAuthenticated: true,
        toName: "login",
        toFullPath: "/login",
      }),
    ).toEqual({ name: "home" });
  });

  test("authenticated on protected route → pass", () => {
    expect(
      decideLoginRedirect({
        isAuthenticated: true,
        toName: "entities",
        toFullPath: "/entities",
      }),
    ).toBe(undefined);
  });
});
