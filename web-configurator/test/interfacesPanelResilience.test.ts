// @vitest-environment jsdom
//
// Regression guard for the activity/remote "interfaces" panels.
//
// Both panels host a big editor component (ActivityRemote / DeviceRemote) and
// need to know when a widget is being dragged inside it, so the panel can hide
// its own overflow. That state used to be *pulled* out of the child through its
// template ref, straight from the panel's class binding:
//
//   :class="{ '…--overflow-hidden': elActivityRemote && elActivityRemote.isItemDragging() }"
//
// which makes the panel's render depend on the child *instance*. If the child
// ever fails to mount — a throwing setup() is enough — Vue re-creates it, that
// writes the template ref again, which invalidates the panel's render, which
// re-creates the child… The tab locks up after a few hundred rounds with
// "Maximum recursive updates exceeded", and the app's global error handler
// turns every round into an error toast.
//
// The state is pushed up with an event instead, so the panel's render no longer
// reads the child instance. This file pins both halves of that: the panel still
// reacts to the drag state, and a child that cannot mount no longer takes the
// panel down with it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";

const remote = vi.hoisted(() => ({ setupCalls: 0, broken: false }));

/**
 * Stands in for the real editor. When `broken`, `setup()` throws — how
 * ActivityRemote failed in the wild (an import that resolved to undefined); the
 * exact cause does not matter, only that the panel survives it. Nothing is
 * exposed then, so the render reads a binding setup never produced — the second
 * half of what a component with a thrown setup does.
 */
vi.mock("@/components/activity/ActivityRemote.vue", () => ({
  default: defineComponent({
    name: "ActivityRemote",
    emits: ["itemDragging"],
    setup(_props, { emit }) {
      remote.setupCalls++;
      if (remote.broken) {
        throw new Error("setup failed");
      }
      return {
        cls: () => "",
        drag: (val: boolean) => emit("itemDragging", val),
      };
    },
    template: `<div class="remote-controller" :class="cls()" />`,
  }),
}));

vi.mock("@/stores/activities", () => ({
  activitiesStore: () => ({
    $onAction: () => () => {},
    getActivity: () =>
      Promise.resolve({ entity_id: "uc.main.test", name: { en: "A" } }),
  }),
}));

vi.mock("@/stores/messages", () => ({
  addInfoFull: () => {},
  addErrorBottom: () => {},
}));

import EditActivityInterfaces from "@/components/activity/EditActivityInterfaces.vue";

const OVERFLOW_HIDDEN = "ea-interfaces__remote--overflow-hidden";

async function mountPanel() {
  const wrapper = mount(EditActivityInterfaces, {
    props: { activityId: "uc.main.test", activeTab: "settings" },
    global: {
      mocks: { $t: (key: string) => key },
      stubs: { PageList: true, ButtonList: true },
      config: { errorHandler: () => {} },
    },
  });

  // The editor is only created once the user opens one of the two tabs it
  // serves, so switch to it the way the parent view does.
  await wrapper.setProps({ activeTab: "user-interface" });

  // Let the activity load, the editor mount, and any re-render settle.
  for (let i = 0; i < 5; i++) {
    await nextTick();
  }
  await new Promise((resolve) => setTimeout(resolve, 50));

  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  remote.setupCalls = 0;
  remote.broken = false;
});

describe("EditActivityInterfaces", () => {
  it("hides the panel overflow while a widget is dragged", async () => {
    const wrapper = await mountPanel();
    const panel = wrapper.find(".ea-interfaces__remote");
    expect(panel.classes()).not.toContain(OVERFLOW_HIDDEN);

    const editor = wrapper.findComponent({ name: "ActivityRemote" });
    (editor.vm as unknown as { drag: (v: boolean) => void }).drag(true);
    await nextTick();
    expect(panel.classes()).toContain(OVERFLOW_HIDDEN);

    (editor.vm as unknown as { drag: (v: boolean) => void }).drag(false);
    await nextTick();
    expect(panel.classes()).not.toContain(OVERFLOW_HIDDEN);

    wrapper.unmount();
  });

  it("does not re-mount an editor that cannot mount in a loop", async () => {
    remote.broken = true;
    // The child's own errors are the symptom under test; keep them off stderr.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const wrapper = await mountPanel();

    expect(remote.setupCalls).toBe(1);

    wrapper.unmount();
    consoleError.mockRestore();
  });
});
