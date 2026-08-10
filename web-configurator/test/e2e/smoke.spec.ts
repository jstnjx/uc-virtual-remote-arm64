/**
 * E2E smoke suite — docs/specs/007-simulator-based-testing.md §5.
 *
 * The gates (type-check, test:unit, lint) say nothing about whether the app
 * renders: every screen but /login needs a backend. This is the smallest suite
 * that would have caught "it does not come up at all".
 */
import { expect, test, type Page } from "@playwright/test";

import { assertBackendIsSimulator, simReset } from "./fixtures/simulator";
import { createActivityGroup, resetDeviceState } from "./fixtures/seed";
import { enterPin, expectConnected, login } from "./fixtures/app";

// §3.2: a pristine device per spec file, over REST — see simulator.ts for why
// the container itself is not recreated here.
test.beforeAll(async () => {
  await assertBackendIsSimulator();
  await resetDeviceState();
});

/** The tabs are list items, not buttons — no role to select on. */
const activityGroupsTab = (page: Page) =>
  page.locator(".tab-menu__list__item", { hasText: "Activity groups" });

test("logs in with the simulator PIN and renders home", async ({ page }) => {
  await login(page);

  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator(".page-home")).toBeVisible();
});

test("rejects a wrong PIN and stays on the login page", async ({ page }) => {
  await enterPin(page, "9999");

  await expect(page.locator(".form-item__error")).toHaveText(
    "Incorrect PIN. Please retry.",
  );
  await expect(page).toHaveURL(/#\/login/);
});

test("renders every top-level route without page errors or Vue warnings", async ({
  page,
}) => {
  const problems: string[] = [];
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.text().includes("[Vue warn]")) {
      problems.push(`vue warn: ${msg.text()}`);
    }
  });

  await login(page);
  await expect(page.locator(".page-home")).toBeVisible();

  // Entities and integrations are different views behind the same root class, so
  // those two assert on a tab only their own view renders — `.page-devices`
  // alone would not tell the two apart.
  const routes = [
    ["/entities", ".page-devices__tools >> text=External remotes"],
    ["/integrations", ".page-devices__tools >> text=Docks"],
    ["/activities-macros", ".page-activities-macros"],
    ["/settings/general", ".page-settings"],
  ] as const;

  for (const [route, marker] of routes) {
    await page.goto(`/#${route}`);
    await expect(page.locator(marker), `${route} should render`).toBeVisible();
  }

  expect(problems).toEqual([]);
});

test("a seeded activity group shows up, and a reset takes it away", async ({
  page,
}) => {
  const name = "Seeded by e2e";
  await createActivityGroup(name);

  await login(page);
  await page.goto("/#/activities-macros");
  await activityGroupsTab(page).click();
  await expect(page.getByText(name)).toBeVisible();

  // The whole point of throwing the container away: state cannot survive it (I1).
  // The one place in the suite that still recreates a container, which is why
  // simReset() waits out the browser's network-change fallout before returning.
  await simReset();
  // The app cannot notice that its backend was replaced under it: it still holds
  // AUTHORISED, so #/login would just redirect home. Reload instead — auth re-runs
  // from the PIN in sessionStorage and every list is re-read (FM-5: after the
  // recreate, never during).
  await page.reload();
  await expectConnected(page);
  await activityGroupsTab(page).click();
  await expect(page.getByText(name)).toHaveCount(0);
});
