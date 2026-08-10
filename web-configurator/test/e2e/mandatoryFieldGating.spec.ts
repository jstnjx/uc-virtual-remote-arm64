/**
 * Add-dialogs disable their primary button until the mandatory name is filled,
 * the way the Add-dock dialog already did.
 *
 * These assertions only mean something against a real browser: the gate is a
 * `:disabled` binding, so a jsdom unit test would assert the binding exists
 * rather than that the button cannot be activated.
 *
 * All six affected dialogs are covered. The Bluetooth one only asserts the gate
 * on its add step — pairing past that point needs real hardware — and its
 * pairing-only mode, which renders no name field and is therefore not gated, is
 * not reachable from the UI at all.
 */
import { expect, test, type Page, type Locator } from "@playwright/test";

import { assertBackendIsSimulator } from "./fixtures/simulator";
import { createProfilePage, resetDeviceState } from "./fixtures/seed";
import { login } from "./fixtures/app";

test.beforeAll(async () => {
  await assertBackendIsSimulator();
  await resetDeviceState();
});

/** The name field is the first plain text input in the dialog body. */
const nameInput = (modal: Locator) =>
  modal.locator(".modal__body input").first();

const primaryButton = (modal: Locator) =>
  modal.locator(".modal__footer .button--primary");

/**
 * The whole point of the change: empty is blocked, whitespace-only is blocked
 * too (it produces an entity that renders as unnamed), real text unblocks, and
 * clearing re-blocks.
 */
async function expectGatedOnName(modal: Locator, label: string) {
  const button = primaryButton(modal);
  const input = nameInput(modal);

  await expect(
    button,
    `${label}: blocked while the name is empty`,
  ).toBeDisabled();

  await input.fill("   ");
  await expect(
    button,
    `${label}: a whitespace-only name still counts as empty`,
  ).toBeDisabled();

  await input.fill("Living room");
  await expect(
    button,
    `${label}: unblocked once a name is typed`,
  ).toBeEnabled();

  await input.fill("  Living room  ");
  await expect(
    button,
    `${label}: padding around real text does not block`,
  ).toBeEnabled();

  await input.fill("");
  await expect(button, `${label}: blocked again once cleared`).toBeDisabled();
}

/**
 * Open one of the three dialogs behind the "Add new" dropdown. The item text is
 * matched exactly: "Activity" is otherwise also a prefix of "Activity group".
 */
async function openAddDialog(page: Page, item: string) {
  await page.goto("/#/activities-macros");
  await page
    .locator(".page-activities-macros__tools__col--menu button")
    .first()
    .click();
  await page
    .locator(".dropdown-menu__list__item", { hasText: new RegExp(`^${item}$`) })
    .click();
}

test("Add new activity gates Next on the name", async ({ page }) => {
  await login(page);
  await openAddDialog(page, "Activity");

  const modal = page.locator(".modal--add-activity");
  await expect(modal).toBeVisible();
  await expectGatedOnName(modal, "Add new activity");
});

test("Add new macro gates Next on the name", async ({ page }) => {
  await login(page);
  await openAddDialog(page, "Macro");

  const modal = page.locator(".modal--add-macro");
  await expect(modal).toBeVisible();
  await expectGatedOnName(modal, "Add new macro");
});

test("Add new activity group gates Next on the name", async ({ page }) => {
  await login(page);
  await openAddDialog(page, "Activity group");

  const modal = page.locator(".modal--add-activity-group");
  await expect(modal).toBeVisible();
  await expectGatedOnName(modal, "Add new activity group");
});

test("Add profile gates its submit button on the name", async ({ page }) => {
  await login(page);
  // The profile menu is mounted twice — desktop nav bar and mobile menu — so
  // both the trigger and the add button need narrowing to the visible one.
  await page.locator(".menu-profile button").first().click();
  await page.locator(".button-add-profile").first().click();

  const modal = page.locator(".modal--edit-profile");
  await expect(modal).toBeVisible();
  await expectGatedOnName(modal, "Add profile");
});

test("Add new group gates Next on the name", async ({ page }) => {
  // The options panel that holds "Add groups" is `v-show`n off until a page is
  // selected for editing, and the simulator boots with no remote-UI pages.
  await createProfilePage("Gating page");

  await login(page);
  await page.goto("/#/customise-remote");
  await page.locator(".page-list-item").first().click();
  await page
    .locator(".customise-remote-options__list button", {
      has: page.locator('img[alt="Add groups"]'),
    })
    .click();
  // Not `exact`: the accessible name picks up the button's leading icon.
  await page.getByRole("button", { name: "New" }).click();

  const modal = page.locator(".modal--add-group");
  await expect(modal).toBeVisible();
  await expectGatedOnName(modal, "Add new group");
});

test("Add Bluetooth remote gates its add step on the name", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#/entities");
  await page.locator(".tab-menu__list__item", { hasText: "Bluetooth" }).click();
  await page.getByRole("button", { name: "Add new" }).click();
  // The simulator boots with Bluetooth off, so the dialog opens on its
  // "turned off" step rather than the add step.
  await page.getByRole("button", { name: "Enable" }).click();

  const modal = page.locator(".add-remote-bt");
  await expect(modal.locator(".modal__body input").first()).toBeVisible();
  await expectGatedOnName(modal, "Add Bluetooth remote");
});

test("the gated Next still completes the happy path", async ({ page }) => {
  await login(page);
  await openAddDialog(page, "Activity");

  const modal = page.locator(".modal--add-activity");
  await nameInput(modal).fill("Gated happy path");
  await primaryButton(modal).click();

  // Step 2 is the entity picker; reaching it proves the gate did not break the
  // transition it guards.
  await expect(
    modal.locator(".modal__body__step__body--list"),
    "Next advanced to the entity-selection step",
  ).toBeVisible();
});
