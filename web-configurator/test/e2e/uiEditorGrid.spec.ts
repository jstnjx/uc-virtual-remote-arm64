/**
 * Activity → User interface → the page grid.
 *
 * The editor draws the grid three ways and they all have to land on the same
 * rectangles: the visible cells (`.ui-page__background`, a flex layout the
 * browser sizes), the clickable empty-cell overlay (`.ui-page__empty-list__item`,
 * absolutely positioned from JS pixel math) and the widgets themselves (the
 * grid-layout-plus layout, sized from the same JS pixel math).
 *
 * That math is calibrated to a fixed display geometry, so any CSS change that
 * resizes the page area silently pulls the overlay and the widgets off the drawn
 * grid — which is what the vue3-carousel 0.17 upgrade did by taking the
 * pagination out of flow. Only a real layout can catch that, hence e2e.
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

const COLS = 4;
const ROWS = 6;

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

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Read both rect lists in one evaluation: the carousel slides on a transition, so
 * two separate reads can straddle it and report a drift that is not there.
 */
function boxPairs(
  page: Page,
  a: string,
  b: string,
): Promise<{ a: Rect[]; b: Rect[] }> {
  return page.evaluate(
    ([selA, selB]) => {
      const rects = (sel: string) =>
        Array.from(document.querySelectorAll(sel)).map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
      return { a: rects(selA), b: rects(selB) };
    },
    [a, b],
  );
}

/** Cells the eye reads as aligned; sub-pixel rounding is not a defect. */
function misaligned(
  actual: Rect[],
  expected: Rect[],
  label: (i: number) => string,
) {
  return actual
    .map((rect, i) => ({
      cell: label(i),
      dx: rect.x - expected[i].x,
      dy: rect.y - expected[i].y,
      dw: rect.width - expected[i].width,
      dh: rect.height - expected[i].height,
    }))
    .filter((d) => [d.dx, d.dy, d.dw, d.dh].some((v) => Math.abs(v) > 1.5));
}

const rowMajor = (i: number) => `r${Math.floor(i / COLS)}c${i % COLS}`;

test("the empty-cell overlay lines up with the drawn grid", async ({
  page,
}) => {
  const activity = await createActivity("Grid overlay");

  await login(page);
  await openUserInterfaceTab(page, activity.entity_id);

  const slide = ".carousel__slide--active";
  const cellCount = COLS * ROWS;
  await expect(page.locator(`${slide} .ui-page__background__item`)).toHaveCount(
    cellCount,
  );
  // A fresh activity has an empty 4x6 page, so every cell carries an overlay.
  await expect(page.locator(`${slide} .ui-page__empty-list__item`)).toHaveCount(
    cellCount,
  );

  // Both lists are row-major, so they pair up index for index. Polled because
  // the carousel and the grid layout settle a frame or two after mount.
  await expect
    .poll(async () => {
      const { a: cells, b: overlays } = await boxPairs(
        page,
        `${slide} .ui-page__background__item`,
        `${slide} .ui-page__empty-list__item`,
      );
      return misaligned(overlays, cells, rowMajor);
    })
    .toEqual([]);

  // Below $bp-phone the drawn grid narrows its gap and padding. The overlay is
  // laid out from the same CSS variables, so it has to follow without any JS
  // recalculation — a viewport change is the cheapest way to prove it does.
  await page.setViewportSize({ width: 560, height: 900 });

  await expect
    .poll(async () => {
      const { a: cells, b: overlays } = await boxPairs(
        page,
        `${slide} .ui-page__background__item`,
        `${slide} .ui-page__empty-list__item`,
      );
      return misaligned(overlays, cells, rowMajor);
    })
    .toEqual([]);
});

test("placed widgets line up with the drawn grid", async ({ page }) => {
  const activity = await createActivity("Grid widgets");
  const [firstPage] = await listUiPages(activity.entity_id);
  // Opposite corners: a drift that accumulates per row shows up on the last one.
  await updateUiPage(activity.entity_id, {
    ...firstPage,
    grid: { width: COLS, height: ROWS },
    items: [
      { type: "text", text: "first", location: { x: 0, y: 0 } },
      { type: "text", text: "last", location: { x: COLS - 1, y: ROWS - 1 } },
    ],
  });

  await login(page);
  await openUserInterfaceTab(page, activity.entity_id);

  const slide = ".carousel__slide--active";
  await expect(page.locator(`${slide} .ui-page__item`)).toHaveCount(2);

  const widgetsMatchCells = async () => {
    const { a: cells, b: widgets } = await boxPairs(
      page,
      `${slide} .ui-page__background__item`,
      `${slide} .ui-page__item`,
    );
    const last = cells.length - 1;
    return misaligned(widgets, [cells[0], cells[last]], (i) =>
      i === 0 ? rowMajor(0) : rowMajor(last),
    );
  };

  await expect.poll(widgetsMatchCells).toEqual([]);

  // The widget layout is sized from the measured grid area, so shrinking the
  // window past $bp-phone — which changes the display, the page padding and the
  // cell gaps all at once — has to carry the widgets with it.
  await page.setViewportSize({ width: 560, height: 900 });

  await expect.poll(widgetsMatchCells).toEqual([]);
});
