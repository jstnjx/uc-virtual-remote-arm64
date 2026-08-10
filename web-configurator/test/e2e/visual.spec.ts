/**
 * E2E visual regression — docs/specs/007-simulator-based-testing.md §5, phase 3.
 *
 * The gap this closes: #595's `::-ms-clear` regression passed every computed-style
 * check (0 diffs over 34,136 values) because `getComputedStyle` does not enumerate
 * pseudo-elements — Chrome's native "×" reappeared in a search field and only a
 * screenshot could see it. So these baseline the dropdown-heavy screens, and the
 * open dropdown's search field in particular, which is where that "×" lives.
 *
 * Baselines are pixels: comparable only within one rendering environment. That is
 * why this suite runs only inside the pinned Docker image (docker/visual/, driven
 * by `npm run test:e2e:visual`), never against a host browser — so a local run and
 * CI produce the same pixels. Rebaseline on purpose with `test:e2e:visual:update`.
 */
import { expect, test, type Page } from "@playwright/test";

import { assertBackendIsSimulator } from "./fixtures/simulator";

const PIN = "1234";

// The suite runs in Docker (phase 3) with a freshly-composed simulator, so the
// device is already pristine — no reset needed, and none is possible from inside
// the runner. These screens never mutate it; they only need it to be the sim.
test.beforeAll(async () => {
  await assertBackendIsSimulator();
});

async function login(page: Page): Promise<void> {
  await page.goto("/#/login");
  const input = page.locator('input[type="password"]');
  await input.fill(PIN);
  await input.press("Enter");
  await expect(page.locator(".page-home")).toBeVisible();
}

/**
 * Live data that drifts run to run and must be masked, or a real regression is
 * buried under its noise: the nav-bar battery readout (capacity; caused 8 of 42
 * diffs in #595). Selectors that match nothing on a given screen (e.g. the nav on
 * /login) are a harmless no-op.
 *
 * The git-describe version string is the other volatile element, but masking it is
 * not enough — its height also shifts the login layout, and it is empty on CI's
 * shallow clone. It is hidden outright via stylePath (visual.screenshot.css), not
 * masked here.
 */
const liveData = (page: Page) => [page.locator(".remote-status")];

test("login page", async ({ page }) => {
  await page.goto("/#/login");
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page).toHaveScreenshot("login.png", { mask: liveData(page) });
});

test("settings / general", async ({ page }) => {
  await login(page);
  await page.goto("/#/settings/general");
  await expect(page.locator(".page-settings")).toBeVisible();
  await expect(page).toHaveScreenshot("settings-general.png", {
    mask: liveData(page),
  });
});

test("settings / localization", async ({ page }) => {
  await login(page);
  await page.goto("/#/settings/localization");
  await expect(page.locator(".page-settings")).toBeVisible();
  await expect(page).toHaveScreenshot("settings-localization.png", {
    mask: liveData(page),
  });
});

test("an open UCSelect dropdown", async ({ page }) => {
  await login(page);
  // Localization is where the inline UCSelects live (Language/Country/Timezone);
  // general's rows are navigation buttons, not selects.
  await page.goto("/#/settings/localization");
  await expect(page.locator(".page-settings")).toBeVisible();

  // The exact #595 surface: an open dropdown whose search field is a native
  // <input>, where a browser's clear "×" pseudo-element would reappear.
  await page.locator(".vs__dropdown-toggle").first().click();
  await expect(page.locator(".vs__dropdown-menu").first()).toBeVisible();

  await expect(page).toHaveScreenshot("select-open.png", {
    mask: liveData(page),
  });
});
