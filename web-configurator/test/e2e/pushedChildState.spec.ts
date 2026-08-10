/**
 * Three screens that used to read a child component's state out of its template
 * ref, from inside their own render, and now receive it as an event instead.
 *
 * The refactor is invisible to type-check and to a mounted unit test with a
 * stubbed child — what it can break is the wiring itself: an event that never
 * fires, or fires with the wrong shape, leaves the parent stuck on its default.
 * Each case below is that wiring, driven through the real component.
 */
import { expect, test } from "@playwright/test";

import { assertBackendIsSimulator } from "./fixtures/simulator";
import { resetDeviceState } from "./fixtures/seed";
import { login } from "./fixtures/app";

test.beforeAll(async () => {
  await assertBackendIsSimulator();
  await resetDeviceState();
});

test("the mobile menu hides the navbar status while it is open", async ({
  page,
}) => {
  // The hamburger only exists below the desktop breakpoint.
  await page.setViewportSize({ width: 480, height: 800 });
  await login(page);
  await page.goto("/#/settings");

  const status = page.locator(".remote-status");
  const trigger = page.locator(".menu-main-mobile__trigger");
  await expect(status).toBeVisible();

  await trigger.click();
  await expect(status).toBeHidden();

  await trigger.click();
  await expect(status).toBeVisible();
});

test("the software update row reports a failed update check", async ({
  page,
}) => {
  // The default the row falls back to is "up to date", so a passing check
  // proves nothing about the wiring — only a failure the row could not have
  // guessed does. Break the check the section runs on mount.
  await page.route("**/api/system/update", (route) =>
    route.fulfill({ status: 500, body: "{}" }),
  );

  await login(page);
  await page.goto("/#/settings");

  const row = page
    .locator(".settings-option-button", { hasText: "Software update" })
    .first();
  await expect(row.locator("i.fa-warning")).toBeVisible();
  await expect(row).not.toContainText(/up to date/i);
});
