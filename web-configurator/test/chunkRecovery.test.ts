/**
 * Lazy route chunk recovery (#674): a lost chunk request must not leave the app
 * on a dead route, and a chunk that is genuinely gone must not reload forever.
 */
import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

import {
  decideChunkRecovery,
  installChunkRecovery,
  isChunkLoadError,
} from "../src/composables/chunkRecovery";

const addErrorBottom = vi.fn();
vi.mock("@/stores/messages", () => ({
  addErrorBottom: (...args: unknown[]) => addErrorBottom(...args),
}));
vi.mock("@/i18next", () => ({ default: { t: (key: string) => key } }));

const FETCH_FAILED = new TypeError(
  "Failed to fetch dynamically imported module: http://localhost/assets/js/EditActivityView-Llzj-z9W.js",
);

describe("isChunkLoadError", () => {
  test("recognises the browsers' and Vite's wordings", () => {
    expect(isChunkLoadError(FETCH_FAILED)).toBe(true);
    expect(
      isChunkLoadError(new Error("error loading dynamically imported module")),
    ).toBe(true);
    expect(
      isChunkLoadError(new Error("Importing a module script failed")),
    ).toBe(true);
    expect(
      isChunkLoadError(new Error("Unable to preload CSS for /assets/x.css")),
    ).toBe(true);
    expect(
      isChunkLoadError("Failed to fetch dynamically imported module"),
    ).toBe(true);
  });

  test("leaves every other navigation error alone", () => {
    expect(
      isChunkLoadError(new Error("Cannot read property of undefined")),
    ).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError({ code: "ERR_NETWORK" })).toBe(false);
  });
});

describe("decideChunkRecovery", () => {
  test("retries first, then reloads, then gives up", () => {
    const targetPath = "/activity/1";
    expect(
      decideChunkRecovery({
        targetPath,
        retriedPath: null,
        reloadedPath: null,
      }),
    ).toBe("retry");
    expect(
      decideChunkRecovery({
        targetPath,
        retriedPath: targetPath,
        reloadedPath: null,
      }),
    ).toBe("reload");
    expect(
      decideChunkRecovery({
        targetPath,
        retriedPath: targetPath,
        reloadedPath: targetPath,
      }),
    ).toBe("give-up");
  });

  test("a different path gets its own sequence", () => {
    expect(
      decideChunkRecovery({
        targetPath: "/macro/2",
        retriedPath: "/activity/1",
        reloadedPath: "/activity/1",
      }),
    ).toBe("retry");
  });
});

describe("installChunkRecovery", () => {
  let failures: number;
  let reload: Mock<() => void>;

  /** Route component whose chunk fails the first `failures` times it is imported. */
  function makeRouter(): Router {
    return createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", name: "home", component: { template: "<div>home</div>" } },
        {
          path: "/lazy",
          name: "lazy",
          component: () => {
            if (failures-- > 0) {
              return Promise.reject(FETCH_FAILED);
            }
            return Promise.resolve({ template: "<div>lazy</div>" });
          },
        },
      ],
    });
  }

  function install(router: Router) {
    installChunkRecovery(router, reload);
  }

  beforeEach(() => {
    sessionStorage.clear();
    addErrorBottom.mockClear();
    reload = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  test("a one-shot chunk failure recovers without a reload", async () => {
    failures = 1;
    const router = makeRouter();
    install(router);

    await router.push("/lazy").catch(() => {});

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("lazy"));
    expect(reload).not.toHaveBeenCalled();
    expect(addErrorBottom).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("uc.chunkReloadPath")).toBeNull();
  });

  test("a failing retry reloads the document once, marking the path", async () => {
    failures = Number.POSITIVE_INFINITY;
    const router = makeRouter();
    install(router);

    await router.push("/lazy").catch(() => {});

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem("uc.chunkReloadPath")).toBe("/lazy");
    expect(addErrorBottom).not.toHaveBeenCalled();
  });

  test("still failing after the reload surfaces an error instead of reloading again", async () => {
    // What the app sees after the reload the previous test armed.
    sessionStorage.setItem("uc.chunkReloadPath", "/lazy");
    failures = Number.POSITIVE_INFINITY;
    const router = makeRouter();
    install(router);

    await router.push("/lazy").catch(() => {});

    await vi.waitFor(() => expect(addErrorBottom).toHaveBeenCalledTimes(1));
    expect(addErrorBottom).toHaveBeenCalledWith("error.chunk_load_failed");
    expect(reload).not.toHaveBeenCalled();
    // Not a dead screen: the failure hit the first navigation, so nothing was
    // mounted and the app lands on the statically bundled home route.
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("home"));
  });

  test("the reload marker is cleared once the path loads again", async () => {
    sessionStorage.setItem("uc.chunkReloadPath", "/lazy");
    failures = 0;
    const router = makeRouter();
    install(router);

    await router.push("/lazy");

    expect(sessionStorage.getItem("uc.chunkReloadPath")).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  test("navigation errors that are not chunk failures are left untouched", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", name: "home", component: { template: "<div>home</div>" } },
        {
          path: "/broken",
          name: "broken",
          component: () => Promise.reject(new Error("boom")),
        },
      ],
    });
    install(router);

    await router.push("/broken").catch(() => {});

    expect(reload).not.toHaveBeenCalled();
    expect(addErrorBottom).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBeUndefined();
  });
});
