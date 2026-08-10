import { defineConfig } from "@playwright/test";

import { APP_PORT, APP_URL, SIM_URL } from "./test/e2e/fixtures/simulator";

/**
 * E2E harness — docs/specs/007-simulator-based-testing.md phase 2.
 *
 * Everything runs against the Remote-Core Simulator; a real device is never a
 * valid target (I3). The dev server is started here rather than reused, and on
 * its own port, so it cannot inherit a personal VITE_API_PROXY from
 * env/.env.local — that would silently point the suite at real hardware.
 */
export default defineConfig({
  testDir: "./test/e2e",
  globalSetup: "./test/e2e/fixtures/globalSetup.ts",
  globalTeardown: "./test/e2e/fixtures/globalTeardown.ts",
  // Playwright wipes this at run start, so a shared path would have concurrent
  // runs deleting each other's failure artifacts. Key it to the run's own port.
  outputDir: `test-results/${APP_PORT}`,
  forbidOnly: !!process.env.CI,
  // One simulator per run, and specs reset it (§3.2), so a second worker would
  // pull the backend out from under the first. Run two suites concurrently by
  // giving each its own SIM_PORT/SIM_NAME/E2E_APP_PORT instead.
  workers: 1,
  // A CI runner shares its network with whatever else the job starts, and a
  // Chromium that loses a request to that is not something a spec can defend
  // against. One retry distinguishes "the app is broken" from "the runner
  // blinked"; locally a failure should stay a failure.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  // Generous against a cold runner, but no longer a substitute for waiting on
  // the right thing: specs gate on the app having a live session (fixtures/app),
  // so a hung app fails inside the expect timeout with a diagnosis instead of
  // burning the whole budget retrying a click.
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // Visual regression is pixel comparison, which is only reproducible in one
  // pinned environment — it runs from its own config in Docker (phase 3), never
  // here against the host's Chrome.
  testIgnore: "**/visual.spec.ts",
  use: {
    baseURL: APP_URL,
    // System Chrome: no browser download (§3.5).
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // Routes are lazy-loaded, so the dev server compiles each route on first
    // navigation. On a cold CI runner those on-demand compiles are slow enough
    // to time tests out, and no per-test timeout fixes it reliably. In CI we
    // therefore serve a production build via `vite preview` — every chunk is
    // already built, so route navigations don't compile. Locally we keep the
    // dev server for fast iteration.
    command: process.env.CI
      ? `npx vite build && npx vite preview --port ${APP_PORT} --strictPort`
      : `npx vite --port ${APP_PORT} --strictPort`,
    url: APP_URL,
    // Vite's loadEnv applies process.env after the .env files, so these win over
    // env/.env.local without writing to it (I4) — the dev:sim mechanism. The
    // preview server reads VITE_API_PROXY the same way (config.preview.proxy).
    env: { VITE_API_PROXY: SIM_URL, VITE_API_HOST: "/" },
    // The CI build must finish before the server answers, so allow for it.
    timeout: 180_000,
    // Never adopt a stray dev server: it may be proxying a real device.
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});
