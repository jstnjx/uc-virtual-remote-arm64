/**
 * The Bluetooth tab's slot-availability caption, against a real core.
 *
 * Only the empty-slot device is reachable here: the simulator ships no BT
 * device profiles (`GET /api/cfg/bt/profiles` is empty and the core answers
 * `POST /api/remotes` with "BT device profile doesn't exist"), so no Bluetooth
 * remote can be created against it, and raising `bt.peripheral_connections`
 * takes a reboot the container does not survive — the PATCH is accepted and the
 * value stays at 1. What this file pins is that the caption resolves its i18n
 * keys, reads the device's real maximum, and is scoped to the Bluetooth tab.
 * test/bluetoothSlots.test.ts covers every occupied state.
 */
import { expect, test, type Page } from "@playwright/test";

import { assertBackendIsSimulator } from "./fixtures/simulator";
import { createRemote, resetDeviceState } from "./fixtures/seed";
import { login } from "./fixtures/app";

// §3.2: a pristine device per spec file.
test.beforeAll(async () => {
  await assertBackendIsSimulator();
  await resetDeviceState();
});

/** The tabs are list items, not buttons — no role to select on. */
const tab = (page: Page, label: string) =>
  page.locator(".tab-menu__list__item", { hasText: label });

const caption = (page: Page) => page.locator("#entities-bt-slots");

const addButton = (page: Page) =>
  page.locator(".page-devices__tools__filter__options .button--primary");

test("reports the free slots of an empty single-slot device", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#/entities");
  await tab(page, "Bluetooth").click();

  await expect(caption(page)).toHaveText("1 of 1 slot available");
  await expect(addButton(page)).toBeEnabled();
});

test("shows the caption only on the Bluetooth tab", async ({ page }) => {
  // A remote of another kind, so the tabs it belongs to are not empty either.
  await createRemote("IR remote");

  await login(page);
  await page.goto("/#/entities");
  await tab(page, "Bluetooth").click();
  await expect(caption(page)).toBeVisible();

  for (const label of ["Infrared", "External remote", "All"]) {
    await tab(page, label).click();
    await expect(caption(page)).toBeHidden();
    await expect(addButton(page)).toBeEnabled();
  }
});
