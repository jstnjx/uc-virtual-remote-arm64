// @vitest-environment jsdom
/**
 * The UI language has to survive a reload — see test/e2e/language.spec.ts for the
 * same guarantee asserted through the app.
 *
 * The device config is the only source of truth for the language, and it arrives
 * after auth and a REST round-trip. Remembering the last applied language lets
 * main.ts put it in place before the first render, instead of rendering in the
 * fallback language and correcting itself afterwards.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "uc.locale";

/** Fresh module state per test: i18next's language is module-level. */
async function loadI18next() {
  vi.resetModules();
  return await import("@/i18next");
}

beforeEach(() => {
  localStorage.clear();
});

describe("applyLanguage", () => {
  it("remembers a language it switched to", async () => {
    const { applyLanguage, default: i18next } = await loadI18next();

    await applyLanguage("fr_FR");

    expect(i18next.language).toBe("fr_FR");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("fr_FR");
  });

  it("remembers nothing for a language the app does not ship", async () => {
    const { applyLanguage, default: i18next } = await loadI18next();

    // The simulator's default, and a locale with no translation of its own.
    await applyLanguage("en_UK");

    expect(i18next.language).toBe("en_US");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("restoreLanguage", () => {
  it("applies the language of the previous session", async () => {
    localStorage.setItem(STORAGE_KEY, "fr_FR");
    const { restoreLanguage, default: i18next } = await loadI18next();

    await restoreLanguage();

    expect(i18next.language).toBe("fr_FR");
    // Awaited by main.ts before mount, so the bundle has to be in place by now —
    // resolving before the chunk lands would put the first render in English.
    expect(i18next.hasResourceBundle("fr_FR", "translation")).toBe(true);
  });

  it("stays on the fallback language when nothing was stored", async () => {
    const { restoreLanguage, default: i18next } = await loadI18next();

    await restoreLanguage();

    expect(i18next.language).toBe("en_US");
  });

  it("resolves rather than rejects when the language chunk cannot be fetched", async () => {
    localStorage.setItem(STORAGE_KEY, "fr_FR");
    const { restoreLanguage, default: i18next } = await loadI18next();
    // A stale hashed chunk after an update, or simply being offline: the app
    // still has to mount, it just mounts in the fallback language.
    vi.spyOn(i18next, "changeLanguage").mockRejectedValue(new Error("offline"));

    await expect(restoreLanguage()).resolves.toBeUndefined();
  });
});
