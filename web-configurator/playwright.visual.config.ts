import { defineConfig } from "@playwright/test";

/**
 * Visual-regression harness — docs/specs/007-simulator-based-testing.md phase 3.
 *
 * A screenshot baseline is only reproducible in the exact environment that
 * produced it, so this config never runs on a developer's host: it runs inside
 * the pinned Playwright Linux image (docker/visual/), against the simulator
 * reachable on the compose network as `sim:8080`. That is what makes a local run
 * and a CI run produce the same pixels — the whole point of phase 3.
 *
 * Regenerate baselines on purpose: `npm run test:e2e:visual:update`.
 */
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "**/visual.spec.ts",
  outputDir: "test-results/visual",
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: "line",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    // Hide build-time-variable content (the git-describe version string) from every
    // screenshot, applied identically at capture and compare. Without it the login
    // footer varies by environment — a full "…-dirty" describe on a dev checkout,
    // empty on CI's shallow clone where git describe finds no history — which shifts
    // the vertically-centred column and fails the compare (found wiring up phase 4).
    toHaveScreenshot: { stylePath: "./test/e2e/visual.screenshot.css" },
  },
  // One rendering environment, one baseline set. The image is pinned, so the
  // platform is always linux; the suffix documents that and guards against a
  // stray host run overwriting these.
  snapshotPathTemplate: "test/e2e/__screenshots__/{arg}-{platform}{ext}",
  use: {
    baseURL: "http://127.0.0.1:3100/",
    // Bundled Chromium from the pinned image — not the host's Chrome — so the
    // browser build is fixed too.
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // The dev server runs inside the same container and proxies /api to the sibling
  // simulator. VITE_API_PROXY is set by docker/visual/run.sh.
  webServer: {
    command: "npx vite --port 3100 --strictPort",
    url: "http://127.0.0.1:3100/",
    env: { VITE_API_HOST: "/" },
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});
