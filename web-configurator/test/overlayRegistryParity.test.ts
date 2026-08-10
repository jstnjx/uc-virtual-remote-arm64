// @vitest-environment jsdom
/**
 * Parity harness for the overlay dismissal registry, exercised through the real
 * components rather than the composable.
 *
 * Written against the pre-migration implementation, where AppModal,
 * ModalSecondary, AppDialog, IconSelect, ResourceUpload and MenuProfile each
 * hand-rolled registration, dismissal detection and release. It is the fixed
 * reference the migration onto `useModalToggle` / `useModalRegistration` is
 * checked against, so a behavioural drift shows up as a failing test here
 * instead of as a bug report.
 *
 * `modalDismissal.test.ts` covers the composable's own mechanics; this file
 * only asks whether the components still behave the same.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { defineComponent, nextTick, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";

import AppModal from "@/components/elements/AppModal.vue";
import ModalSecondary from "@/components/elements/ModalSecondary.vue";
import ModalMinimal from "@/components/elements/ModalMinimal.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import IconSelect from "@/components/elements/icon/IconSelect.vue";
import { useModal, useModalToggle } from "@/composables/modal";
import { appStateStore } from "@/stores/appState";

vi.mock("i18next-vue", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18next: { language: "en_US", exists: () => false },
  }),
}));

// The modals' open watchers are async: they `await sleep(30)` and then branch on
// isTouchEnabled(), which reads `window`. That continuation can outlive the test
// file, and vitest tears down jsdom between files — so on a slow runner it lands
// as an unhandled "window is not defined". Reporting touch skips the focus path
// entirely, which these tests do not exercise anyway.
vi.mock("@/composables/device", () => ({
  isTouchEnabled: () => true,
  focusInput: () => Promise.resolve(),
}));

const mountOpts = {
  stubs: {
    Teleport: true,
    SelectedIcon: true,
    // IconSelect calls reset() on this ref when it opens.
    IconList: defineComponent({
      setup(_props, { expose }) {
        expose({ reset: () => undefined });
        return () => null;
      },
    }),
  },
  mocks: { $t: (key: string) => key },
};

/** Stand-in for App.vue's global ESC handler. */
function pressEscape() {
  appStateStore().closeModal();
}

const pool = () => appStateStore().modalPool;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A popover on the composable, standing in for a DropdownMenu. */
function mountPopover(id: string) {
  const open = ref(false);
  mount(
    defineComponent({
      setup() {
        useModalToggle(open, { id, lockScroll: false });
        return () => null;
      },
    }),
  );
  return open;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("AppModal", () => {
  it("holds a pool entry while shown and closes when ESC pops it", async () => {
    const wrapper = mount(AppModal, {
      props: { name: "add-integration", show: false },
      global: mountOpts,
    });

    await wrapper.setProps({ show: true });
    expect(pool()).toContain("add-integration");

    pressEscape();
    await nextTick();
    expect(wrapper.emitted("closing")).toBeTruthy();
  });

  it("survives ESC aimed at a popover opened over it", async () => {
    // Mounted hidden then shown: AppModal's watch(props) is not immediate, so a
    // modal mounted already-shown never registers. Parents always do it this way.
    const wrapper = mount(AppModal, {
      props: { name: "add-integration", show: false },
      global: mountOpts,
    });
    await wrapper.setProps({ show: true });
    const popover = mountPopover("dropdown");
    popover.value = true;
    await nextTick();

    expect(pool()).toEqual(["add-integration", "dropdown"]);

    pressEscape();
    await nextTick();
    expect(popover.value).toBe(false);
    expect(wrapper.emitted("closing")).toBeFalsy();
  });

  it("stays open when a popover unregisters as the modal is opening", async () => {
    // The #689 regression: picking a dropdown item opens a modal and closes the
    // dropdown, so the pool is mutated while the modal is still registering.
    const popover = mountPopover("dropdown");
    popover.value = true;
    await nextTick();

    const wrapper = mount(AppModal, {
      props: { name: "add-integration", show: false },
      global: mountOpts,
    });

    void wrapper.setProps({ show: true });
    popover.value = false;
    await nextTick();
    await wait(50);

    expect(wrapper.emitted("closing")).toBeFalsy();
    expect(pool()).toContain("add-integration");
  });
});

describe("AppDialog", () => {
  it("holds a pool entry while open and closes when ESC pops it", async () => {
    const wrapper = mount(AppDialog, {
      props: { text: "question" },
      global: mountOpts,
    });

    (wrapper.vm as unknown as { open: () => void }).open();
    await nextTick();
    expect(pool()).toHaveLength(1);

    pressEscape();
    await nextTick();
    expect(pool()).toHaveLength(0);
    expect(
      (wrapper.vm as unknown as { isActive: () => boolean }).isActive(),
    ).toBe(false);
  });

  it("suppresses ESC for every overlay while a non-dismissible dialog is open", async () => {
    const popover = mountPopover("dropdown");
    popover.value = true;
    await nextTick();

    const wrapper = mount(AppDialog, {
      props: { text: "must acknowledge", closeable: false },
      global: mountOpts,
    });
    (wrapper.vm as unknown as { open: () => void }).open();
    await nextTick();

    pressEscape();
    await nextTick();
    expect(
      (wrapper.vm as unknown as { isActive: () => boolean }).isActive(),
    ).toBe(true);
    expect(popover.value).toBe(true);
  });

  it("stays open when a popover unregisters as the dialog is opening", async () => {
    const popover = mountPopover("dropdown");
    popover.value = true;
    await nextTick();

    const wrapper = mount(AppDialog, {
      props: { text: "question" },
      global: mountOpts,
    });

    (wrapper.vm as unknown as { open: () => void }).open();
    popover.value = false;
    await nextTick();
    await wait(50);

    expect(
      (wrapper.vm as unknown as { isActive: () => boolean }).isActive(),
    ).toBe(true);
  });
});

/**
 * Release timing — the one place the migration deliberately changes behaviour
 * (design D4).
 *
 * ModalSecondary and IconSelect used to release their pool entry only after a
 * close animation delay (100ms and 600ms), because the registry call sat inside
 * the watcher driving the animation. An ESC press landing in that window was
 * absorbed by an overlay already on its way out instead of reaching the layer
 * beneath. Centralising releases the entry as soon as the overlay is hidden.
 */
describe("release timing while closing", () => {
  it("ModalSecondary releases its pool entry as soon as it is hidden", async () => {
    const wrapper = mount(ModalSecondary, {
      props: { name: "edit-port", show: false },
      global: mountOpts,
    });

    await wrapper.setProps({ show: true });
    expect(pool()).toContain("edit-port");

    // Its 100ms close animation still runs; the pool entry no longer waits for it.
    await wrapper.setProps({ show: false });
    expect(pool()).not.toContain("edit-port");

    await wait(150);
  });

  it("IconSelect releases its pool entry as soon as it is hidden", async () => {
    const wrapper = mount(IconSelect, { global: mountOpts });

    (
      wrapper.vm as unknown as { openSelectModal: () => void }
    ).openSelectModal();
    await nextTick();
    expect(pool()).toHaveLength(1);

    await wrapper.find(".button-close").trigger("click");
    expect(pool()).toHaveLength(0);
  });

  it("an ESC press while one overlay closes reaches the layer beneath", async () => {
    const { registerOpenModal } = useModal();
    registerOpenModal("beneath");

    const wrapper = mount(ModalSecondary, {
      props: { name: "edit-port", show: false },
      global: mountOpts,
    });
    await wrapper.setProps({ show: true });
    await wrapper.setProps({ show: false });

    // The closing modal has already given up its slot, so this press dismisses
    // the overlay underneath rather than being swallowed.
    pressEscape();
    await nextTick();
    expect(pool()).toEqual([]);

    await wait(150);
  });
});

/**
 * ModalMinimal used to be the odd one out: it registered in the pool but never
 * watched it, dismissing itself from its own `window` keyup listener — the
 * per-component ESC handler ADR 015 exists to prevent. App.vue listens on
 * `document`, which precedes `window` in the bubble path, so its
 * `stopPropagation()` could not stop App.vue and one press dismissed two layers.
 */
describe("ModalMinimal", () => {
  /** Both listeners are real, so dispatch a real event rather than calling closeModal(). */
  function dispatchEscape() {
    document.body.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Escape", bubbles: true }),
    );
  }

  it("stays open when ESC dismisses a popover stacked above it", async () => {
    const appEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        appStateStore().closeModal();
      }
    };
    document.addEventListener("keyup", appEsc);

    const wrapper = mount(ModalMinimal, {
      props: { name: "minimal", show: false },
      global: mountOpts,
      attachTo: document.body,
    });
    await wrapper.setProps({ show: true });

    const popover = mountPopover("dropdown");
    popover.value = true;
    await nextTick();
    expect(pool()).toEqual(["minimal", "dropdown"]);

    dispatchEscape();
    await nextTick();
    document.removeEventListener("keyup", appEsc);

    // The popover was the topmost layer and is dismissed; the modal beneath it
    // survives, where it used to close off its own listener as well.
    expect(popover.value).toBe(false);
    expect(wrapper.emitted("close")).toBeFalsy();
  });
});
