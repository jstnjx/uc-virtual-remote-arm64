/**
 * The Activities tab must survive the add-activity-group modal.
 *
 * The modal's activity picker queries a different set than the list behind it
 * (ungrouped activities only), and used to write that result into the store's
 * shared page state — which the list renders by reference (#683). On a device
 * where every activity already sits in the default group the picker's result is
 * empty, so opening and cancelling the modal blanked the Activities tab until
 * the view remounted.
 */
import { expect, test } from "@playwright/test";
import { login } from "./fixtures/app";
import { createActivity } from "./fixtures/seed";

test("cancelling the add-activity-group modal keeps the activity list", async ({
  page,
}) => {
  await createActivity("Watch TV");
  await createActivity("Listen to Music");

  await login(page);
  await page.goto("/#/activities-macros?category=activity");

  const items = page.locator(".ent-list__body > *");
  await expect(items).toHaveCount(2);

  await page
    .locator(".page-activities-macros__tools__col--menu button")
    .click();
  await page.locator(".dropdown-menu__list__item").nth(2).click();

  const modal = page.locator(".modal--add-activity-group");
  await expect(modal).toBeVisible();
  // The picker fetches on open; let it land before cancelling.
  await expect(modal.locator(".modal__body__step").first()).toBeVisible();
  await page.waitForTimeout(1000);

  await modal.locator(".modal__close--desktop").click();
  await expect(modal).toBeHidden();

  // The list watcher re-checks on a 1s delay, so a late refetch would still be
  // in flight here — this has to hold without one.
  await page.waitForTimeout(2000);
  await expect(items).toHaveCount(2);
});
