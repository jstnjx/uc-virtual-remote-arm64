/**
 * Config bootstrap / getAll() tests — load-config-on-startup (ADR 0013).
 *
 * The current configuration is loaded via REST at startup (App.vue, on
 * authentication) independent of the WebSocket session, and the first
 * session-established resync may call getAll() near-simultaneously. getAll() is
 * single-flight so that startup pair collapses to one REST round.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const loadAll = vi.fn();
vi.mock("../src/api", () => ({
  default: {
    config: {
      loadAll: (...args: unknown[]) => loadAll(...args),
    },
    rest: () => ({}),
    websocket: () => ({}),
    getService: () => ({}),
  },
}));

import { configStore } from "../src/stores/config";

function cfgResult() {
  return {
    cfg: { localization: { language_code: "de_DE" } },
    tz: ["Europe/Zurich"],
    voiceAssistants: [],
    languages: [{ code: "de_DE", name: "Deutsch" }],
    countries: [],
    unitSystems: {},
    buttonLayout: [],
    screenLayout: {},
  };
}

describe("config store getAll()", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    loadAll.mockReset();
  });

  test("coalesces concurrent callers onto a single REST round", async () => {
    let resolve!: (v: unknown) => void;
    loadAll.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const store = configStore();

    const p1 = store.getAll();
    const p2 = store.getAll();
    expect(loadAll).toHaveBeenCalledTimes(1);

    resolve(cfgResult());
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe(r2);
    expect(loadAll).toHaveBeenCalledTimes(1);
    expect(store.config?.localization?.language_code).toBe("de_DE");
    expect(store.list.languages).toEqual([{ code: "de_DE", name: "Deutsch" }]);
  });

  test("a call after the previous one settles issues a fresh REST round", async () => {
    loadAll.mockResolvedValue(cfgResult());
    const store = configStore();

    await store.getAll();
    await store.getAll();

    expect(loadAll).toHaveBeenCalledTimes(2);
  });
});
