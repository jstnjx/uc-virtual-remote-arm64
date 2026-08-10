/**
 * Activity → User interface → page list.
 *
 * The "+" above the page list only flips a local flag; what makes it fragile is
 * the v-click-outside on the editor row it reveals. The reveal happens while the
 * opening click is still bubbling, so a directive that listens too early treats
 * that click as "outside" and closes the row again — the button then looks dead.
 * Only a real browser has that event ordering, which is why this is an e2e test.
 */
import { expect, test, type Page } from "@playwright/test";

import { assertBackendIsSimulator } from "./fixtures/simulator";
import { createActivity, resetDeviceState } from "./fixtures/seed";
import { login } from "./fixtures/app";

// §3.2: a pristine device per spec file.
test.beforeAll(async () => {
  await assertBackendIsSimulator();
  await resetDeviceState();
});

async function openUserInterfaceTab(page: Page, activityId: string) {
  await page.goto(`/#/activity/${activityId}`);
  await page
    .locator(".tab-menu__list__item", { hasText: "User interface" })
    .click();
}

test("the + button opens the new page editor and creates the page", async ({
  page,
}) => {
  const activity = await createActivity("Page test");

  await login(page);
  await openUserInterfaceTab(page, activity.entity_id);

  const pageItems = page.locator(".page-list__body__list .page-list-item");
  await expect(pageItems).toHaveCount(1);

  await page.locator(".page-list__header__buttons [title='Add']").click();

  // The editor row must survive the click that revealed it.
  const nameInput = page.locator(".page-list-item--editing input");
  await expect(nameInput).toBeVisible();

  await nameInput.fill("Second page");
  await nameInput.press("Enter");

  await expect(pageItems).toHaveCount(2);
  await expect(pageItems.nth(1)).toContainText("Second page");
});
