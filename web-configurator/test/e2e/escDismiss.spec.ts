/**
 * ESC closes the topmost popup (ADR 014, popup-dismissal spec).
 *
 * The app has always routed ESC through one shared pool in `appState`, but only
 * modal-shaped components joined it. The menus, dropdowns and popovers held a
 * private `open` ref and closed on backdrop click only, so ESC did nothing —
 * including on the two things pinned to the corner of every screen, the
 * hamburger menu and the sleep-timeout popup.
 *
 * The registry mechanics (LIFO order, suppression under a blocking dialog,
 * unmount cleanup, scroll-lock separation) are unit-tested in
 * test/modalDismissal.test.ts. This file drives the real screens, because the
 * thing that broke before was never the mechanism — it was components not being
 * wired into it.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

import { assertBackendIsSimulator } from "./fixtures/simulator";
import { resetDeviceState } from "./fixtures/seed";
import { login } from "./fixtures/app";

test.beforeAll(async () => {
  await assertBackendIsSimulator();
  await resetDeviceState();
});

/**
 * Open a popup, confirm it is up, press ESC, confirm it is gone.
 *
 * Asserting visible-before-ESC is not ceremony: every one of these popups is
 * `v-show`, so it is in the DOM either way and a selector typo would otherwise
 * make the test pass by finding nothing.
 */
async function expectEscapeCloses(
  page: Page,
  trigger: Locator,
  popup: Locator,
) {
  await trigger.click();
  await expect(popup).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();
}

test("ESC closes the integrations Add-new dropdown", async ({ page }) => {
  await login(page);
  await page.goto("/#/integrations");

  await expectEscapeCloses(
    page,
    page.locator(".dropdown-menu__trigger"),
    page.locator(".dropdown-menu__main"),
  );
});

/**
 * Regression: picking an item from a dropdown opens a modal, and closing the
 * dropdown mutates the pool at the exact moment that modal is registering.
 * AppModal read "my name is not in the pool" as a dismissal and closed itself
 * roughly a second later (its triggerClose sleeps 800ms), so the popup the user
 * had just asked for vanished before they could use it.
 */
test("a modal opened from a dropdown item stays open", async ({ page }) => {
  await login(page);
  await page.goto("/#/integrations");

  await page.locator(".dropdown-menu__trigger").click();
  await page.locator(".dropdown-menu__list__item").first().click();

  const modal = page.locator(".modal.add-device");
  await expect(modal).toBeVisible();
  // Past triggerClose's 800ms sleep: if the pool watcher had fired, the modal
  // would be gone by now.
  await page.waitForTimeout(1500);
  await expect(modal).toBeVisible();
});

test("ESC closes the mobile hamburger menu", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 900 });
  await login(page);

  await expectEscapeCloses(
    page,
    page.locator(".menu-main-mobile__trigger"),
    page.locator(".menu-main-mobile__body"),
  );
});

test("ESC closes the sleep-timeout popup", async ({ page }) => {
  await login(page);

  await expectEscapeCloses(
    page,
    page.locator(".remote-status"),
    page.locator(".sleep-timeout"),
  );
});

test("ESC closes the entity filter panel", async ({ page }) => {
  await login(page);
  await page.goto("/#/entities");

  await expectEscapeCloses(
    page,
    page.locator(".filter-dropdown__trigger"),
    page.locator(".filter-dropdown__container"),
  );
  // ESC dismissed the panel and nothing else: still on the entities route.
  await expect(page).toHaveURL(/#\/entities$/);
});

test("a dropdown does not lock page scroll behind it", async ({ page }) => {
  await login(page);
  // This view mounts AddIntegration — an AppModal — hidden, next to the
  // "Add new" dropdown. The scroll lock used to key off "is anything in the
  // pool", which a mounted-but-hidden modal was enough to act on, so joining
  // the pool would have locked the page behind a small popover.
  await page.goto("/#/integrations");

  await page.locator(".dropdown-menu__trigger").click();
  await expect(page.locator(".dropdown-menu__main")).toBeVisible();

  await expect(page.locator("body")).not.toHaveClass(/overflow-hidden/);
});

test("a popup left open on an unmounted view does not swallow the next ESC", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#/integrations");

  // Open the dropdown, then navigate away without closing it: its component
  // unmounts while still registered.
  await page.locator(".dropdown-menu__trigger").click();
  await expect(page.locator(".dropdown-menu__main")).toBeVisible();
  await page.goto("/#/entities");

  // A stale registry entry would be popped by this press instead of the panel.
  await expectEscapeCloses(
    page,
    page.locator(".filter-dropdown__trigger"),
    page.locator(".filter-dropdown__container"),
  );
});
