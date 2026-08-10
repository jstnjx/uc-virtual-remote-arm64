/**
 * Integrations overview — list freshness while the page stays open.
 *
 * The overview merges two independently fetched lists: configured integrations
 * (`GET /api/intg`) and installed-but-not-configured CUSTOM/EXTERNAL drivers
 * (`GET /api/intg/drivers?has_instances=false`). Only WS events keep them in
 * sync, and only the second list is filtered by `has_instances` — so a bug
 * there is invisible after a reload and invisible for built-in (LOCAL)
 * integrations. That is exactly the reported symptom: after configuring an
 * external integration, its driver stayed in the overview next to the new
 * integration until the page was reloaded.
 */
import { expect, test, type Page } from "@playwright/test";

import { assertBackendIsSimulator } from "./fixtures/simulator";
import {
  createIntegrationInstance,
  deleteIntegrationInstance,
  resetDeviceState,
} from "./fixtures/seed";
import { login } from "./fixtures/app";

/** The simulator ships this EXTERNAL driver, configured, in a pristine device. */
const DRIVER_ID = "hass";
const INSTANCE_ID = "hass.main";
const INSTANCE_NAME = "Home Assistant";
const DRIVER_NAME = "Home Assistant demo driver";

/**
 * The card carrying exactly this title. Exact, because INSTANCE_NAME is a
 * prefix of DRIVER_NAME — and by title, because the swap this file is about has
 * both cards on screen for a moment: a text assertion on `.ent-item__title`
 * that lands in that moment fails on strict mode instead of polling on.
 */
const cardTitled = (page: Page, title: string) =>
  page.getByRole("heading", { name: title, exact: true });

// §3.2: a pristine device per spec file.
test.beforeAll(async () => {
  await assertBackendIsSimulator();
  await resetDeviceState();
});

test("configuring an installed driver replaces its card instead of duplicating it", async ({
  page,
}) => {
  // Undo the simulator's pre-configured instance: the driver stays installed,
  // so the overview lists it as not configured — the state a user is in right
  // before running setup.
  await deleteIntegrationInstance(INSTANCE_ID);

  await login(page);
  await page.goto("/#/integrations");

  const cards = page.locator(".ent-item");
  await expect(cards).toHaveCount(1);
  await expect(cardTitled(page, DRIVER_NAME)).toBeVisible();
  // "+" instead of a state icon: instance_count < 1
  await expect(cards.locator(".fa-circle-plus")).toBeVisible();

  // What a finished setup does, with the page left open: the app must react to
  // the integration_change NEW event alone — no reload, no remount.
  await createIntegrationInstance(DRIVER_ID, INSTANCE_NAME);

  await expect(cardTitled(page, INSTANCE_NAME)).toBeVisible();
  await expect(cards).toHaveCount(1);
  await expect(page.locator(".fa-circle-plus")).toHaveCount(0);
});

test("first delete resets the integration and brings its driver back", async ({
  page,
}) => {
  await createIntegrationInstance(DRIVER_ID, INSTANCE_NAME).catch(() => {
    // the previous test may have left the instance in place
  });

  await login(page);
  await page.goto("/#/integrations");

  const cards = page.locator(".ent-item");
  const instanceCard = cards.filter({ has: cardTitled(page, INSTANCE_NAME) });
  await expect(instanceCard).toBeVisible();

  // Exercise the actual Web Configurator delete control. The first delete must
  // reset configuration only; it must not uninstall the integration driver.
  await instanceCard.locator("button.button--delete").click();
  const deleteDialog = page.locator(".dialog").filter({
    has: page.getByRole("heading", { name: /delete/i }),
  });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole("button", { name: /delete/i }).click();

  await expect(cardTitled(page, DRIVER_NAME)).toBeVisible();
  await expect(cards).toHaveCount(1);
  await expect(cards.locator(".fa-circle-plus")).toBeVisible();
});
