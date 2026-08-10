// @vitest-environment jsdom
/**
 * The shared overlay dismissal registry (ADR 015).
 *
 * Covers the mechanics that make ESC work for every participating overlay:
 * LIFO ordering, suppression under a non-dismissible dialog, unregistering on
 * unmount, and the scroll lock being tracked separately from dismissal order.
 *
 * The seven popups wired up in this change delegate all of it to
 * `useModalToggle`, so exercising the composable covers them — including
 * `LanguageDropdown` and `InfoPopup`, which sit behind app state that is
 * awkward to reach from an e2e run.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { defineComponent, nextTick, ref, type Ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";

import {
  useModal,
  useModalToggle,
  useBodyScrollLock,
} from "@/composables/modal";
import { appStateStore } from "@/stores/appState";

/** A minimal overlay that participates in the registry, like the real popups. */
function mountOverlay(options: { id?: string; lockScroll?: boolean } = {}) {
  const open = ref(false);
  const wrapper = mount(
    defineComponent({
      setup() {
        useModalToggle(open, options);
        return () => null;
      },
    }),
  );
  return { open, wrapper };
}

/** Stand-in for App.vue's global ESC handler. */
function pressEscape() {
  appStateStore().closeModal();
}

beforeEach(() => {
  setActivePinia(createPinia());
  document.body.classList.remove("overflow-hidden");
});

/**
 * Opening a popup must never be undone by pool churn happening around it.
 *
 * Reported symptom: the "+ Add new" popup on the integrations and
 * activities-and-macros views closed itself about a second after opening,
 * intermittently. The shape that allows it: `open` is flipped synchronously
 * from a click handler, so if registration is deferred to the next tick the
 * overlay is briefly open-but-unregistered — and the pool watcher cannot tell
 * that apart from "this was dismissed, close".
 */
describe("opening an overlay is not undone by concurrent pool churn", () => {
  it("registers synchronously, leaving no open-but-unregistered window", () => {
    const { open } = mountOverlay({ id: "dropdown" });

    // Deliberately no await: this is the state the DOM click handler leaves
    // behind, and it is where the old implementation was vulnerable.
    open.value = true;
    expect(appStateStore().modalPool).toContain("dropdown");
  });

  it("survives another overlay registering and unregistering in the same tick", async () => {
    const dropdown = mountOverlay({ id: "dropdown" });
    const other = mountOverlay({ id: "other" });

    // What DropdownMenu.showDropdown() does: nudge other popups shut, then open.
    other.open.value = true;
    other.open.value = false;
    dropdown.open.value = true;

    await nextTick();
    expect(dropdown.open.value).toBe(true);
    expect(appStateStore().modalPool).toContain("dropdown");
  });

  it("survives pool churn arriving after it opened", async () => {
    const { registerOpenModal, unregisterModal } = useModal();
    const { open } = mountOverlay({ id: "dropdown" });

    open.value = true;
    await nextTick();

    // A modal elsewhere on the page mounting, updating and unmounting rewrites
    // the pool array repeatedly; none of it concerns this popup.
    for (const name of ["modal-a", "modal-b", "modal-c"]) {
      registerOpenModal(name);
      await nextTick();
      unregisterModal(name);
      await nextTick();
    }

    expect(open.value).toBe(true);
  });

  it("still closes when it really is dismissed, after that churn", async () => {
    const { open } = mountOverlay({ id: "dropdown" });

    open.value = true;
    await nextTick();

    pressEscape();
    await nextTick();
    expect(open.value).toBe(false);
  });
});

describe("overlay dismissal registry", () => {
  it("closes an open overlay when ESC pops it", async () => {
    const { open } = mountOverlay();

    open.value = true;
    await nextTick();
    expect(appStateStore().modalPool).toHaveLength(1);

    pressEscape();
    await nextTick();
    expect(open.value).toBe(false);
    expect(appStateStore().modalPool).toHaveLength(0);
  });

  it("closes only the topmost overlay, one ESC press at a time", async () => {
    const beneath = mountOverlay({ id: "beneath" });
    const above = mountOverlay({ id: "above" });

    beneath.open.value = true;
    await nextTick();
    above.open.value = true;
    await nextTick();
    expect(appStateStore().modalPool).toEqual(["beneath", "above"]);

    pressEscape();
    await nextTick();
    expect(above.open.value).toBe(false);
    expect(beneath.open.value).toBe(true);

    pressEscape();
    await nextTick();
    expect(beneath.open.value).toBe(false);
  });

  it("ignores ESC while a non-dismissible dialog is open", async () => {
    const { registerOpenModal } = useModal();
    const { open } = mountOverlay({ id: "dropdown" });

    open.value = true;
    await nextTick();
    // A dialog with closeable=false registers with disableClose set.
    registerOpenModal("blocking-dialog", true);

    pressEscape();
    await nextTick();
    expect(open.value).toBe(true);
    expect(appStateStore().modalPool).toContain("dropdown");
  });

  it("unregisters an overlay destroyed while still open", async () => {
    const { open, wrapper } = mountOverlay({ id: "doomed" });

    open.value = true;
    await nextTick();
    expect(appStateStore().modalPool).toEqual(["doomed"]);

    wrapper.unmount();
    // A stale id left behind would absorb the next ESC press without closing
    // anything.
    expect(appStateStore().modalPool).toHaveLength(0);
  });

  it("gives each instance of the same component its own pool entry", async () => {
    const first = mountOverlay();
    const second = mountOverlay();

    first.open.value = true;
    second.open.value = true;
    await nextTick();
    expect(appStateStore().modalPool).toHaveLength(2);

    pressEscape();
    await nextTick();
    expect(second.open.value).toBe(false);
    expect(first.open.value).toBe(true);
  });
});

describe("body scroll lock", () => {
  /** App.vue owns the body class; mount that ownership on its own. */
  function mountScrollLockOwner() {
    return mount(
      defineComponent({
        setup() {
          useBodyScrollLock();
          return () => null;
        },
      }),
    );
  }

  const isLocked = () => document.body.classList.contains("overflow-hidden");

  async function openAndAssertLock(open: Ref<boolean>, expected: boolean) {
    open.value = true;
    await nextTick();
    expect(isLocked()).toBe(expected);
  }

  it("locks scroll for an overlay that asks for it", async () => {
    mountScrollLockOwner();
    const { open } = mountOverlay({ lockScroll: true });

    expect(isLocked()).toBe(false);
    await openAndAssertLock(open, true);

    open.value = false;
    await nextTick();
    expect(isLocked()).toBe(false);
  });

  it("does not lock scroll for a popover that opts out", async () => {
    mountScrollLockOwner();
    const { open } = mountOverlay({ lockScroll: false });

    await openAndAssertLock(open, false);
    // ...but it still joins the dismissal order.
    expect(appStateStore().modalPool).toHaveLength(1);
  });

  it("keeps the lock while a locking overlay is still open beneath a popover", async () => {
    mountScrollLockOwner();
    const modal = mountOverlay({ id: "modal", lockScroll: true });
    const popover = mountOverlay({ id: "popover", lockScroll: false });

    await openAndAssertLock(modal.open, true);
    await openAndAssertLock(popover.open, true);

    pressEscape();
    await nextTick();
    expect(popover.open.value).toBe(false);
    expect(isLocked()).toBe(true);

    pressEscape();
    await nextTick();
    expect(isLocked()).toBe(false);
  });

  it("releases the lock when a locking overlay unmounts while open", async () => {
    mountScrollLockOwner();
    const { open, wrapper } = mountOverlay({ lockScroll: true });

    await openAndAssertLock(open, true);

    wrapper.unmount();
    await nextTick();
    expect(isLocked()).toBe(false);
  });
});
