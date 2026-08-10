/**
 * Settings → Development → Preview features.
 *
 * Toggling a feature makes core emit a `configuration_change` whose `features`
 * array carries `id` and `enabled` only. The config store merges that event
 * into the cached configuration, and arrays are replaced wholesale — so the
 * titles, descriptions and "Read more" links the screen renders came from the
 * REST config and are not in the event. Every label used to vanish the moment a
 * toggle was flipped, and only a reload brought them back.
 */
import { expect, test, type Page } from "@playwright/test";

import { assertBackendIsSimulator } from "./fixtures/simulator";
import { expectConnected, login } from "./fixtures/app";

const IR_FEATURE = "Internal infrared (IR) blaster";

test.beforeAll(async () => {
  await assertBackendIsSimulator();
});

/** The preview feature rows, one `SettingsOptionButton` each. */
const featureRows = (page: Page) =>
  page.locator(
    ".page-settings-section__preview-features .settings-option-button",
  );

const featureTitles = (page: Page) =>
  featureRows(page).locator(".settings-option-button__title");

const featureDescriptions = (page: Page) =>
  featureRows(page).locator(".settings-option-button__description");

/**
 * Count the `configuration_change` events the app has received.
 *
 * The toggle flips its own checkbox before the event arrives, so without
 * waiting for the event itself every assertion below can run against the
 * pre-event render and pass while the bug is present. Must be installed before
 * the app opens its socket.
 */
function countConfigEvents(page: Page): () => number {
  let received = 0;
  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => {
      if (frame.payload.toString().includes('"configuration_change"')) {
        received += 1;
      }
    });
  });
  return () => received;
}

async function openPreviewFeatures(page: Page) {
  await login(page);
  await page.goto("/#/settings/development");
  await expectConnected(page);
  await page
    .locator(".settings-option-button", { hasText: "Preview features" })
    .click();
  await expect(featureTitles(page).first()).toHaveText(/\S/);
}

test("keeps the feature texts after a feature is toggled", async ({ page }) => {
  const configEvents = countConfigEvents(page);
  await openPreviewFeatures(page);

  const titlesBefore = await featureTitles(page).allTextContents();
  const descriptionsBefore = await featureDescriptions(page).allTextContents();
  const readMoreBefore = await featureRows(page)
    .locator(".button-read-more")
    .count();
  expect(titlesBefore).toContain(IR_FEATURE);
  expect(readMoreBefore).toBeGreaterThan(0);

  const irRow = featureRows(page).filter({ hasText: IR_FEATURE });
  const irToggle = irRow.locator('input[type="checkbox"]');
  // The checkbox itself is visually hidden; the switch label drives it.
  const irSwitch = irRow.locator(".form-item--toggle__switch");
  const wasEnabled = await irToggle.isChecked();

  await irSwitch.click();
  await expect(irToggle).toBeChecked({ checked: !wasEnabled });
  await expect
    .poll(configEvents, {
      message: "core never sent a configuration_change for the toggle",
    })
    .toBeGreaterThan(0);

  await expect(featureTitles(page)).toHaveText(titlesBefore);
  await expect(featureDescriptions(page)).toHaveText(descriptionsBefore);
  await expect(featureRows(page).locator(".button-read-more")).toHaveCount(
    readMoreBefore,
  );

  // Leave the device as found — configuration is not reset between spec files.
  await irSwitch.click();
  await expect(irToggle).toBeChecked({ checked: wasEnabled });
});
