/**
 * Recovery from a lazily-loaded route chunk that failed to download (#674).
 *
 * Every route but home is a dynamic `import()`. When that request is lost —
 * flaky Wi-Fi, an AP roam, a laptop waking mid-navigation, a CI runner whose
 * network interfaces move — vue-router aborts the navigation and nothing
 * retries it: the app is left on a half-rendered shell, or on nothing at all if
 * it was the first navigation, with a manual reload as the only way out.
 *
 * Policy, per failing target path:
 *   1. **retry** the navigation once, so a one-shot blip stays invisible;
 *   2. **reload** the document once if the retry fails too — a module whose
 *      fetch failed stays failed in the browser's module map, so only a fresh
 *      document is guaranteed to re-request the chunk;
 *   3. **give up** if it still fails after that: the chunk is genuinely gone
 *      (a deploy replaced the hashed filenames), so surface an error instead of
 *      reloading forever.
 *
 * Step 2's marker has to survive the reload, hence `sessionStorage` — and it is
 * keyed by path so a later failure elsewhere still gets its own full sequence.
 */
import type { Router } from "vue-router";

import i18next from "@/i18next";
import { addErrorBottom } from "@/stores/messages";

const RELOAD_MARKER_KEY = "uc.chunkReloadPath";

/**
 * Browsers word a failed dynamic import differently (Chromium, Firefox,
 * Safari), and Vite's preload helper throws its own error when a dependency of
 * the chunk fails instead of the chunk itself.
 */
const CHUNK_ERROR_PATTERNS = [
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
  "unable to preload css",
];

/** A navigation error caused by a chunk that did not download — not a bug in the route. */
export function isChunkLoadError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  const lower = message.toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((pattern) => lower.includes(pattern));
}

export type ChunkRecoveryAction = "retry" | "reload" | "give-up";

/**
 * Pure recovery policy: what to do about `targetPath` failing to load, given
 * what has already been tried for that same path.
 */
export function decideChunkRecovery(opts: {
  targetPath: string;
  /** Path whose navigation was already retried in this document. */
  retriedPath: string | null;
  /** Path the document was already reloaded for (survives the reload). */
  reloadedPath: string | null;
}): ChunkRecoveryAction {
  const { targetPath, retriedPath, reloadedPath } = opts;
  if (retriedPath !== targetPath) {
    return "retry";
  }
  if (reloadedPath !== targetPath) {
    return "reload";
  }
  return "give-up";
}

/** sessionStorage is unavailable in some privacy modes — never let that throw. */
function readMarker(): string | null {
  try {
    return sessionStorage.getItem(RELOAD_MARKER_KEY);
  } catch {
    return null;
  }
}

function writeMarker(path: string) {
  try {
    sessionStorage.setItem(RELOAD_MARKER_KEY, path);
  } catch {
    // No marker means the reload guard cannot arm; a genuinely missing chunk
    // then keeps reloading, which is still better than never recovering.
  }
}

function clearMarker() {
  try {
    sessionStorage.removeItem(RELOAD_MARKER_KEY);
  } catch {
    // ignore, see writeMarker
  }
}

/**
 * Wire the policy above into the router. Call once, before the app is mounted.
 *
 * @param reload - injected for tests; jsdom cannot navigate.
 */
export function installChunkRecovery(
  router: Router,
  reload: () => void = () => window.location.reload(),
) {
  let retriedPath: string | null = null;

  router.onError((error, to) => {
    if (!isChunkLoadError(error)) {
      return;
    }
    const targetPath = to.fullPath;
    const action = decideChunkRecovery({
      targetPath,
      retriedPath,
      reloadedPath: readMarker(),
    });
    console.warn(
      `[chunkRecovery] ${targetPath} failed to load: ${action}`,
      error,
    );

    switch (action) {
      case "retry":
        retriedPath = targetPath;
        // A second failure comes back through this same handler; the rejected
        // promise carries no extra information.
        void router.replace(targetPath).catch(() => {});
        break;
      case "reload":
        writeMarker(targetPath);
        reload();
        break;
      case "give-up":
        addErrorBottom(i18next.t("error.chunk_load_failed"));
        // Nothing is mounted when the failure hit the very first navigation:
        // land on home, which is part of the entry chunk and always available.
        if (router.currentRoute.value.matched.length === 0) {
          void router.replace({ name: "home" }).catch(() => {});
        }
        break;
    }
  });

  // A path that loads is a path that recovered: re-arm both guards for it, so a
  // blip later in the same session gets the full sequence again.
  router.afterEach((to) => {
    if (to.fullPath === retriedPath) {
      retriedPath = null;
    }
    if (to.fullPath === readMarker()) {
      clearMarker();
    }
  });
}
