import { expect, test, beforeEach } from "vitest";
import {
  setCookie,
  getCookie,
  deleteCookie,
} from "../src/composables/cookieHandler";

// Mock document.cookie
let cookieStore: Record<string, string> = {};

Object.defineProperty(document, "cookie", {
  get() {
    return Object.entries(cookieStore)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  },
  set(value: string) {
    const [pair] = value.split(";");
    const [name, val] = pair.split("=");
    if (value.includes("expires=Thu, 01 Jan 1970")) {
      delete cookieStore[name];
    } else {
      cookieStore[name] = val;
    }
  },
  configurable: true,
});

beforeEach(() => {
  cookieStore = {}; // reset mock
});

test("setCookie stores a cookie", () => {
  setCookie("theme", "dark", 7);
  expect(getCookie("theme")).toBe("dark");
});

test("getCookie returns null if cookie does not exist", () => {
  expect(getCookie("missing")).toBeNull();
});

test("deleteCookie removes a cookie", () => {
  setCookie("lang", "hu", 7);
  expect(getCookie("lang")).toBe("hu");

  deleteCookie("lang");
  expect(getCookie("lang")).toBeNull();
});

test("setCookie encodes and getCookie decodes special characters", () => {
  setCookie("token", "a b&c=üő", 7);
  expect(document.cookie).toContain("token=a%20b%26c%3D%C3%BC%C5%91");
  expect(getCookie("token")).toBe("a b&c=üő");
});
