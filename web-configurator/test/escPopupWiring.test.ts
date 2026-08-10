// @vitest-environment jsdom
/**
 * The popups that ESC has to close but the e2e suite cannot reach.
 *
 * `escDismiss.spec.ts` drives the five reachable ones. The three here are all
 * gated behind state a simulator run cannot produce on demand:
 *
 * - MenuMainDesktop's overflow "Menu" button only appears when `collapsed` is
 *   set, and `collapsed` is recomputed solely from the notification bar's width
 *   — never on resize — so no viewport reveals it.
 * - LanguageDropdown's trigger is disabled until a second UI language is
 *   configured.
 * - InfoPopup appears once, behind a configured voice-assistant profile.
 *
 * These assert the wiring only — that opening the popup joins the shared
 * dismissal pool and that being popped closes it. The dismissal mechanics
 * themselves are covered in modalDismissal.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { nextTick, reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import type { RouteLocationNormalizedLoaded } from "vue-router";

import InfoPopup from "@/components/ui/InfoPopup.vue";
import MenuMainDesktop from "@/components/elements/MenuMainDesktop.vue";
import LanguageDropdown from "@/components/elements/LanguageDropdown.vue";
import { appStateStore } from "@/stores/appState";
import { configStore } from "@/stores/config";

vi.mock("i18next-vue", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18next: { language: "en_US", exists: () => false },
  }),
}));

// Partial: src/composables/router.ts builds the real router at import time, so
// the module's other exports have to stay intact. MenuMainDesktop reads nothing
// off the route but `path`, so a stub standing in for the full normalized route
// is enough.
vi.mock(import("vue-router"), async (importOriginal) => ({
  ...(await importOriginal()),
  useRoute: () =>
    reactive({ path: "/" }) as unknown as RouteLocationNormalizedLoaded,
}));

const mountOpts = {
  stubs: { RouterLink: { template: "<a><slot /></a>" }, Teleport: true },
  mocks: { $t: (key: string) => key },
  directives: { "click-outside": {} },
};

/**
 * These popups are `v-show`, and isVisible() only reports display:none for a
 * wrapper attached to the document — detached, it answers true either way and
 * the "popup closed" assertion passes for the wrong reason.
 */
const attachTo = document.body;

/** Stand-in for App.vue's global ESC handler. */
function pressEscape() {
  appStateStore().closeModal();
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("popups wired into the dismissal pool", () => {
  it("MenuMainDesktop joins the pool while open and closes when popped", async () => {
    const wrapper = mount(MenuMainDesktop, { global: mountOpts, attachTo });

    const menu = () => wrapper.find(".menu-main-desktop__dropdown-items");

    await wrapper.find(".menu-main-desktop__trigger").trigger("click");
    expect(appStateStore().modalPool).toHaveLength(1);
    expect(menu().isVisible()).toBe(true);

    pressEscape();
    // Two ticks: one for the pool watcher to flip `open`, one for the re-render.
    await nextTick();
    await nextTick();
    expect(menu().isVisible()).toBe(false);
  });

  it("LanguageDropdown joins the pool while open and closes when popped", async () => {
    // The trigger stays disabled until there is more than one language.
    configStore().list.languages = [
      { code: "en_US", name: "English" },
      { code: "de_DE", name: "Deutsch" },
    ];

    const wrapper = mount(LanguageDropdown, {
      // A language only counts as available once it has a translation (or is
      // the active locale), so the trigger needs both of these to be enabled.
      props: {
        langCode: "en_US",
        translations: { en_US: "Kitchen", de_DE: "Küche" },
      },
      global: mountOpts,
      attachTo,
    });

    const container = () => wrapper.find(".language-dropdown__container");

    await wrapper.find(".language-dropdown__trigger").trigger("click");
    expect(appStateStore().modalPool).toHaveLength(1);
    expect(container().isVisible()).toBe(true);

    pressEscape();
    await nextTick();
    await nextTick();
    expect(container().isVisible()).toBe(false);
  });

  it("InfoPopup joins the pool while open and closes when popped", async () => {
    const wrapper = mount(InfoPopup, { global: mountOpts, attachTo });

    await wrapper.find(".info-popup__trigger").trigger("focus");
    await nextTick();
    expect(appStateStore().modalPool).toHaveLength(1);

    pressEscape();
    await nextTick();
    expect(appStateStore().modalPool).toHaveLength(0);
  });
});
