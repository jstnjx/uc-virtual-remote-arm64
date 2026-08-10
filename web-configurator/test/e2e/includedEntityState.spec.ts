/**
 * Activity / macro → "Included entities": the state line under the name.
 *
 * `GET /api/activities/:id` returns `options.included_entities` as entity
 * *references* — entity_id, name, icon, integration, but no `attributes`, so no
 * `state`. The list therefore had no state to render, while the same entity in
 * the "Add entities" picker (fed full entities) showed one. Only the real core
 * pins that payload shape, which is why this is an e2e test: a unit test would
 * assert against a hand-written fixture, and the fixture is the thing in doubt.
 *
 * Only the state *line* is asserted here. The unavailable marker rides on the
 * same `attributes.state` but no entity a core-only simulator can seed ever
 * reaches `UNAVAILABLE`; test/includedEntityState.test.ts covers that.
 */
import { expect, test } from "@playwright/test";

import { assertBackendIsSimulator } from "./fixtures/simulator";
import {
  createActivity,
  createMacro,
  createRemote,
  resetDeviceState,
} from "./fixtures/seed";
import { login } from "./fixtures/app";

// §3.2: a pristine device per spec file.
test.beforeAll(async () => {
  await assertBackendIsSimulator();
  await resetDeviceState();
});

/** A freshly created IR remote has no known state yet — the core says UNKNOWN. */
const SEEDED_STATE = "unknown";

test("an activity's included entity shows its state", async ({ page }) => {
  const remote = await createRemote("Activity remote");
  const activity = await createActivity("State check", [remote.entity_id]);

  await login(page);
  await page.goto(`/#/activity/${activity.entity_id}`);

  const row = page.locator(".included-entity-list__items .entity-item", {
    hasText: "Activity remote",
  });
  await expect(row.locator(".entity-item__state")).toHaveText(SEEDED_STATE);
});

test("a macro's included entity shows its state", async ({ page }) => {
  const remote = await createRemote("Macro remote");
  const macro = await createMacro("State check macro");

  await login(page);
  await page.goto(`/#/macro/${macro.entity_id}`);

  // A macro has no entity_ids on create, so add the entity through the picker —
  // which also covers the reported "state disappears once it is saved" case.
  await page.locator(".included-entity-list__header button").first().click();
  const candidate = page.locator(
    ".ep-settings__available-entities .entity-item",
    { hasText: "Macro remote" },
  );
  await candidate.locator(".button--toggle-tick").click();
  await page
    .locator(".lwf-entity-list__actions button", { hasText: "Add" })
    .click();

  const row = page.locator(".included-entity-list__items .entity-item", {
    hasText: "Macro remote",
  });
  await expect(row.locator(".entity-item__state")).toHaveText(SEEDED_STATE);

  // The save round-trip replaces the picker's full entity with the reference.
  await page.reload();
  await expect(row.locator(".entity-item__state")).toHaveText(SEEDED_STATE);
});
