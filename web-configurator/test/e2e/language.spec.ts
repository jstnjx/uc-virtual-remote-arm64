/**
 * UI language: the two ways a screen can end up in the wrong language.
 *
 * 1. A live switch has to reach *every* label. Tab strips that build their
 *    labels once — at setup, or inside an `asyncComputed` whose `t()` calls sit
 *    behind an `await` and are therefore never tracked — keep the language they
 *    were created in.
 * 2. A manual reload has to come back up in the device's language. The app used
 *    to mount in the fallback language and correct itself only once the REST
 *    config arrived, so anything rendered in that window was English for good.
 *
 * Both are asserted on the three screens that carry a sub-tab strip:
 * "Customise your remote", the activity editor and the macro editor.
 */
import { expect, test, type Page } from "@playwright/test";

import { assertBackendIsSimulator } from "./fixtures/simulator";
import {
  createActivity,
  createMacro,
  resetDeviceState,
  setDeviceLanguage,
} from "./fixtures/seed";
import { expectConnected, login } from "./fixtures/app";

/** fr_FR is shipped and lazily loaded, so it also covers the chunk fetch. */
const FR = "fr_FR";
/** What a pristine simulator has; not a locale the app ships, so it renders en_US. */
const DEFAULT_LANGUAGE = "en_UK";

let activityId = "";
let macroId = "";

test.beforeAll(async () => {
  await assertBackendIsSimulator();
  await resetDeviceState();
  activityId = (await createActivity("Language spec activity")).entity_id;
  macroId = (await createMacro("Language spec macro")).entity_id;
});

// resetDeviceState leaves configuration alone by design, so put the language
// back or every later spec file inherits French.
test.afterAll(async () => {
  await setDeviceLanguage(DEFAULT_LANGUAGE);
});

test.beforeEach(async () => {
  await setDeviceLanguage(FR);
});

/** The tab strip labels of the screen currently shown. */
function tabLabels(page: Page) {
  return page.locator(".tab-menu__list__item__label");
}

async function expectTabs(page: Page, labels: string[]) {
  await expect(tabLabels(page)).toHaveText(labels);
}

const RECORDER = "__tabLabelsSeen";

/**
 * Record every label the tab strip ever renders, from before the app boots.
 * `toHaveText` retries, so on its own it cannot tell "French from the first
 * paint" from "English first, French a moment later" — and the second one is the
 * bug. The script re-runs on every document load, so a reload starts a fresh
 * recording.
 */
function recordTabLabels(page: Page, key = RECORDER) {
  return page.addInitScript((k: string) => {
    const seen: string[] = [];
    (window as unknown as Record<string, string[]>)[k] = seen;
    const sweep = () => {
      document
        .querySelectorAll(".tab-menu__list__item__label")
        .forEach((el) => {
          const text = el.textContent?.trim();
          if (text && !seen.includes(text)) {
            seen.push(text);
          }
        });
    };
    new MutationObserver(sweep).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    sweep();
  }, key);
}

function recordedLabels(page: Page): Promise<string[]> {
  return page.evaluate(
    (k: string) => (window as unknown as Record<string, string[]>)[k] ?? [],
    RECORDER,
  );
}

const CUSTOMISE_TABS_FR = ["Pages", "Icônes", "Chaînes TV", "Fonds d'écran"];
const ACTIVITY_TABS_FR = [
  "Paramètres",
  "Séquences",
  "Interface utilisateur",
  "Mappage des boutons",
];
const MACRO_TABS_FR = ["Paramètres", "Séquence"];

test.describe("device language on a manual reload", () => {
  test("customise-remote keeps its sub-tabs translated", async ({ page }) => {
    await recordTabLabels(page);
    await login(page);
    await page.goto("/#/customise-remote");
    await expectTabs(page, CUSTOMISE_TABS_FR);

    // The reload restarts the recording, so what it collects is what the reloaded
    // app rendered — no English before the config lands, not even for a frame.
    await page.reload();
    await expectConnected(page);
    await expectTabs(page, CUSTOMISE_TABS_FR);
    expect(await recordedLabels(page)).toEqual(CUSTOMISE_TABS_FR);
  });

  test("the activity editor keeps its sub-tabs translated", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/#/activity/${activityId}`);
    await expectTabs(page, ACTIVITY_TABS_FR);

    await page.reload();
    await expectConnected(page);
    await expectTabs(page, ACTIVITY_TABS_FR);
  });

  test("the macro editor keeps its sub-tabs translated", async ({ page }) => {
    await login(page);
    await page.goto(`/#/macro/${macroId}`);
    await expectTabs(page, MACRO_TABS_FR);

    await page.reload();
    await expectConnected(page);
    await expectTabs(page, MACRO_TABS_FR);
  });
});

test.describe("a live language switch", () => {
  // Driving the settings dropdown would test the selector, not the propagation;
  // writing the config over REST exercises the WebSocket path every other
  // client would take, which is the one that was broken.
  test("re-translates the customise-remote sub-tabs without a reload", async ({
    page,
  }) => {
    await setDeviceLanguage(DEFAULT_LANGUAGE);
    await login(page);
    await page.goto("/#/customise-remote");
    await expectTabs(page, ["Pages", "Icons", "TV channels", "Backgrounds"]);

    await setDeviceLanguage(FR);
    await expectTabs(page, CUSTOMISE_TABS_FR);
  });

  test("re-translates the activity editor sub-tabs without a reload", async ({
    page,
  }) => {
    await setDeviceLanguage(DEFAULT_LANGUAGE);
    await login(page);
    await page.goto(`/#/activity/${activityId}`);
    await expectTabs(page, [
      "Settings",
      "Sequences",
      "User interface",
      "Button mapping",
    ]);

    await setDeviceLanguage(FR);
    await expectTabs(page, ACTIVITY_TABS_FR);
  });

  test("re-translates the macro editor sub-tabs without a reload", async ({
    page,
  }) => {
    await setDeviceLanguage(DEFAULT_LANGUAGE);
    await login(page);
    await page.goto(`/#/macro/${macroId}`);
    await expectTabs(page, ["Settings", "Sequence"]);

    await setDeviceLanguage(FR);
    await expectTabs(page, MACRO_TABS_FR);
  });

  // The list views build their tab strips the same way, just without the icon
  // lookup that hid the bug behind an await.
  const LIST_VIEWS = [
    {
      name: "activities & macros",
      route: "/activities-macros",
      en: ["Activities", "Macros", "Activity groups"],
      fr: ["Activités", "Macros", "Groupes d'activités"],
    },
    {
      name: "entities",
      route: "/entities",
      en: ["All", "Bluetooth", "Infrared", "External remotes"],
      fr: ["Tout", "Bluetooth", "Infrarouge", "Télécommandes externes"],
    },
    {
      name: "integrations",
      route: "/integrations",
      en: ["Integrations", "Docks"],
      fr: ["Intégrations", "Docks"],
    },
  ];

  for (const view of LIST_VIEWS) {
    test(`re-translates the ${view.name} tabs without a reload`, async ({
      page,
    }) => {
      await setDeviceLanguage(DEFAULT_LANGUAGE);
      await login(page);
      await page.goto(`/#${view.route}`);
      await expectTabs(page, view.en);

      await setDeviceLanguage(FR);
      await expectTabs(page, view.fr);
    });
  }
});
