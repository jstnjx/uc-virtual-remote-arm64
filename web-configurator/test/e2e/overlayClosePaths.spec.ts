/**
 * Close paths for the overlays the unit suite reaches least, driven in the real
 * app after they moved onto the shared dismissal registry: the profile menu and
 * the icon picker. Button, ESC and backdrop each behave as before the migration.
 */
import { expect, test } from "@playwright/test";
import { login } from "./fixtures/app";
import { createActivity } from "./fixtures/seed";

test("profile menu: opens, ESC closes, backdrop closes", async ({ page }) => {
  await login(page);
  const menu = page.locator(".menu-profile--desktop");
  const body = menu.locator(".menu-profile__body");
  await menu.locator(".menu-profile__trigger").click();
  await expect(body).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(body).toBeHidden();

  await menu.locator(".menu-profile__trigger").click();
  await expect(body).toBeVisible();
  await menu.locator(".menu-profile__background").click({ force: true });
  await expect(body).toBeHidden();
});

test("icon picker (IconSelect): opens, close button, ESC", async ({ page }) => {
  const activity = await createActivity("Drive Check");
  await login(page);
  await page.goto(`/#/activity/${activity.entity_id}`);
  await page.waitForTimeout(1500);

  const trigger = page.locator(".icon-container--huge").first();
  await expect(trigger).toBeVisible();
  const container = page.locator(".icon-select__container").first();

  // Close button
  await trigger.click();
  await expect(container).toBeVisible();
  await page.locator(".icon-select .button-close").first().click();
  await expect(container).toBeHidden();

  // ESC
  await trigger.click();
  await expect(container).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(container).toBeHidden();

  // Note: IconSelect's backdrop has no click handler and never had one — it
  // closes by button or ESC only. Asserted so the omission stays deliberate.
  await trigger.click();
  await expect(container).toBeVisible();
  await page.locator(".icon-select__background").first().click({ force: true });
  await expect(container).toBeVisible();
});
