/**
 * Activity → User interface → the panel's overflow while dragging a widget.
 *
 * The panel hides its own overflow for as long as a widget is being dragged
 * inside the editor, so the dragged widget cannot push a scrollbar out of the
 * device frame. The signal starts as a real `pointerdown` on a grid item, runs
 * through grid-layout-plus's own drag handling and back out of the editor as an
 * event — nothing about that chain exists without a pointer, so a unit test can
 * only assert the last hop. This asserts the whole one.
 */
import { expect, test } from "@playwright/test";

import { assertBackendIsSimulator } from "./fixtures/simulator";
import {
  createActivity,
  listUiPages,
  resetDeviceState,
  updateUiPage,
} from "./fixtures/seed";
import { login } from "./fixtures/app";

test.beforeAll(async () => {
  await assertBackendIsSimulator();
  await resetDeviceState();
});

test("dragging a widget marks the panel overflow-hidden", async ({ page }) => {
  const activity = await createActivity("Drag test");
  const [uiPage] = await listUiPages(activity.entity_id);
  await updateUiPage(activity.entity_id, {
    ...uiPage,
    items: [{ type: "text", text: "A", location: { x: 0, y: 0 } }],
  });

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));

  await login(page);
  await page.goto(`/#/activity/${activity.entity_id}`);
  await page
    .locator(".tab-menu__list__item", { hasText: "User interface" })
    .click();

  const panel = page.locator(".ea-interfaces__remote");
  const widget = page.locator(".vgl-item").first();
  await expect(widget).toBeVisible();
  await widget.scrollIntoViewIfNeeded();
  await expect(panel).not.toHaveClass(/overflow-hidden/);

  const box = (await widget.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 20,
    box.y + box.height / 2 + 20,
    { steps: 5 },
  );
  await expect(panel).toHaveClass(/overflow-hidden/);

  await page.mouse.up();
  await expect(panel).not.toHaveClass(/overflow-hidden/);

  expect(errors).toEqual([]);
});
