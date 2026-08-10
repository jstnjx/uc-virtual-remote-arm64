/**
 * Lazy route chunk recovery (#674).
 *
 * Every route but home is a dynamic import, and a lost chunk request used to
 * abort the navigation for good: a dead route with a manual reload as the only
 * way out. Neither the unit tests nor `npm run build` can see this — it only
 * exists once a real browser fetches a real chunk over a real network — so the
 * failure is injected here by aborting the chunk request.
 *
 * The chunk URL differs between the local dev server (`/src/views/…`) and the
 * production build CI serves (`/assets/js/DevicesEntities-<hash>.js`); the
 * pattern below matches both.
 */
import { expect, test, type Page } from "@playwright/test";

import { assertBackendIsSimulator } from "./fixtures/simulator";
import { expectConnected, login } from "./fixtures/app";

/** The /entities route's chunk, dev and production naming alike. */
const ENTITIES_CHUNK = "**/*DevicesEntities*";

const ENTITIES_MARKER = ".page-devices__tools >> text=External remotes";

test.beforeAll(async () => {
  await assertBackendIsSimulator();
});

/** Kill the first `count` requests for the route's chunk, then let it through. */
async function dropChunkRequests(page: Page, count: number) {
  let dropped = 0;
  await page.route(ENTITIES_CHUNK, async (route) => {
    if (dropped < count) {
      dropped++;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
}

test("a route whose chunk request fails once still renders", async ({
  page,
}) => {
  await login(page);
  await dropChunkRequests(page, 1);

  await page.goto("/#/entities");

  await expect(
    page.locator(ENTITIES_MARKER),
    "the route should recover from a one-shot chunk failure without user action",
  ).toBeVisible();
});

test("a permanently missing chunk surfaces an error instead of looping", async ({
  page,
}) => {
  await login(page);
  await dropChunkRequests(page, Number.MAX_SAFE_INTEGER);

  // Only the recovery's own reload can fire this: a goto that differs from the
  // current URL by its hash alone is a same-document navigation.
  let documentLoads = 0;
  page.on("load", () => documentLoads++);

  await page.goto("/#/entities");

  await expectConnected(page);
  await expect(
    page.locator(".notification__text"),
    "the failure should be surfaced, not left as a dead screen",
  ).toContainText("could not be loaded");
  // Nothing was mounted when the first navigation failed, so recovery falls
  // back to home rather than leaving the app on a blank route.
  await expect(page).toHaveURL(/#\/$/);
  expect(documentLoads, "the reload guard should allow exactly one").toBe(1);
});
