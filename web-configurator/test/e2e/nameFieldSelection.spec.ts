/**
 * Pre-filled name fields select their contents when they auto-focus, so the
 * first keystroke replaces the placeholder instead of appending to it.
 *
 * This can only be asserted against a real browser: the behaviour lives in the
 * DOM selection, and Playwright's `fill()` — what the existing page-list spec
 * uses — replaces a field's contents whether or not anything was selected, so
 * it stays green either way. Every assertion here therefore types with
 * `press()` and reads back what the field ended up holding.
 */
import { expect, test, type Page } from "@playwright/test";

import { assertBackendIsSimulator } from "./fixtures/simulator";
import {
  createActivity,
  listUiPages,
  resetDeviceState,
  updateUiPage,
} from "./fixtures/seed";
import { login } from "./fixtures/app";

/** The hardcoded default a new page opens with. */
const DEFAULT_PAGE_NAME = "untitled";

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

const pageItems = (page: Page) =>
  page.locator(".page-list__body__list .page-list-item");

/** The inline editor row, shared by the add-page and the rename flow. */
const nameInput = (page: Page) =>
  page.locator(".page-list-item--editing input");

async function startRename(page: Page, index: number) {
  // The options menu is display:none until the row is hovered on a fine pointer.
  const item = pageItems(page).nth(index);
  await item.hover();
  await item.locator(".dropdown-menu button").click();
  await page
    .locator(".dropdown-menu__list__item", { hasText: "Rename" })
    .click();
}

test("the default page name arrives selected, so typing replaces it", async ({
  page,
}) => {
  const activity = await createActivity("Add page selection");

  await login(page);
  await openUserInterfaceTab(page, activity.entity_id);
  await expect(pageItems(page)).toHaveCount(1);

  await page.locator(".page-list__header__buttons [title='Add']").click();

  const input = nameInput(page);
  await expect(input).toHaveValue(DEFAULT_PAGE_NAME);

  // A single keystroke, not fill(): with the default selected it replaces the
  // whole value; without the selection it would append to it.
  await input.press("N");
  await expect(input).toHaveValue("N");

  await input.press("Enter");
  await expect(pageItems(page)).toHaveCount(2);
  await expect(pageItems(page).nth(1)).toContainText("N");
});

test("submitting the add-page field untouched keeps the default name", async ({
  page,
}) => {
  const activity = await createActivity("Add page untouched");

  await login(page);
  await openUserInterfaceTab(page, activity.entity_id);
  await expect(pageItems(page)).toHaveCount(1);

  await page.locator(".page-list__header__buttons [title='Add']").click();
  await nameInput(page).press("Enter");

  await expect(pageItems(page)).toHaveCount(2);
  await expect(pageItems(page).nth(1)).toContainText(DEFAULT_PAGE_NAME);
});

test("renaming a page presents the current name selected", async ({ page }) => {
  const activity = await createActivity("Rename selection");
  const [firstPage] = await listUiPages(activity.entity_id);
  await updateUiPage(activity.entity_id, { ...firstPage, name: "Original" });

  await login(page);
  await openUserInterfaceTab(page, activity.entity_id);
  await expect(pageItems(page).nth(0)).toContainText("Original");

  await startRename(page, 0);

  const input = nameInput(page);
  await expect(input).toHaveValue("Original");

  await input.press("R");
  await expect(input).toHaveValue("R");

  await input.press("Enter");
  await expect(pageItems(page).nth(0)).toContainText("R");
});

test("submitting a rename untouched leaves the name unchanged", async ({
  page,
}) => {
  const activity = await createActivity("Rename untouched");
  const [firstPage] = await listUiPages(activity.entity_id);
  await updateUiPage(activity.entity_id, { ...firstPage, name: "Keep me" });

  await login(page);
  await openUserInterfaceTab(page, activity.entity_id);
  await expect(pageItems(page).nth(0)).toContainText("Keep me");

  await startRename(page, 0);
  await nameInput(page).press("Enter");

  await expect(pageItems(page).nth(0)).toContainText("Keep me");
});

test("a new text widget's placeholder arrives focused and selected", async ({
  page,
}) => {
  const activity = await createActivity("Text widget selection");

  await login(page);
  await openUserInterfaceTab(page, activity.entity_id);

  // Any empty cell opens the widget picker; a fresh activity has nothing else.
  await page
    .locator(".carousel__slide--active .ui-page__empty-list__item")
    .first()
    .click();
  await page
    .locator(".modal--add-widget__select .widget-card", {
      hasText: "Text Button",
    })
    .click();

  // The field is not focused at all today for any widget type — the text widget
  // gains both the focus and the selection here.
  const input = page.locator(".widget-popup__field--text input");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("TEXT");

  await input.press("H");
  await expect(input).toHaveValue("H");

  // AddWidget keys the editor on JSON.stringify(editButton), so committing the
  // text and then changing a setting remounts it. The new focus must not cost
  // the value the user just typed.
  await input.press("Enter");
  // The stepper's "+" — minus first, plus second.
  await page.locator(".widget-setting--width .button").last().click();
  await expect(page.locator(".widget-popup__field--text input")).toHaveValue(
    "H",
  );
});
