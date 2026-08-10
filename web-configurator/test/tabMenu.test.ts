// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";

import TabMenu from "@/components/ui/TabMenu.vue";
import type { TabItem } from "@/types/ui";

const listData: TabItem[] = [
  { label: "All", value: "all", icon: "fa-light fa-list" },
  { label: "Groups", value: "groups", icon: "fa-light fa-layer-group" },
  { label: "Macros", value: "macros", disabled: true },
];

function mountTabMenu() {
  return mount(TabMenu, {
    props: { listData, activeTab: listData[0] },
    attachTo: document.body,
  });
}

type Wrapper = ReturnType<typeof mountTabMenu>;

async function openSelect(wrapper: Wrapper) {
  await wrapper
    .find(".tab-menu__select .vs__dropdown-toggle")
    .trigger("mousedown");
  await nextTick();
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("TabMenu overflow select", () => {
  it("renders every tab as an option, with its icon", async () => {
    const wrapper = mountTabMenu();
    await openSelect(wrapper);

    const options = wrapper.findAll(".vs__dropdown-option");
    expect(options).toHaveLength(3);
    expect(options[0].text()).toBe("All");
    expect(options[0].find("i").classes()).toContain("fa-list");
  });

  it("emits itemClick with the tab when an option is picked", async () => {
    const wrapper = mountTabMenu();
    await openSelect(wrapper);

    await wrapper.findAll(".vs__dropdown-option")[1].trigger("click");
    await nextTick();

    expect(wrapper.emitted("itemClick")).toEqual([[listData[1]]]);
  });

  it("does not select a disabled tab", async () => {
    const wrapper = mountTabMenu();
    await openSelect(wrapper);

    const disabled = wrapper.findAll(".vs__dropdown-option")[2];
    expect(disabled.attributes("aria-disabled")).toBe("true");

    await disabled.trigger("click");
    await nextTick();

    expect(wrapper.emitted("itemClick")).toBeUndefined();
  });

  // Consumers keep `activeTab` as a snapshot of the item that was clicked, so
  // after a language change its label still carries the old language. The
  // selected option has to follow listData, which is rebuilt on the switch.
  it("re-reads the selected label from listData when it is re-translated", async () => {
    const wrapper = mountTabMenu();
    const staleActiveTab = listData[0];

    await wrapper.setProps({
      listData: [
        { ...listData[0], label: "Toutes" },
        { ...listData[1], label: "Groupes" },
        listData[2],
      ],
      activeTab: staleActiveTab,
    });

    expect(wrapper.find(".tab-menu__select").text()).toContain("Toutes");
  });

  it("mirrors the open state into appState.activeDropdown", async () => {
    const wrapper = mountTabMenu();
    const appState = (await import("@/stores/appState")).appStateStore();

    await openSelect(wrapper);
    expect(appState.activeDropdown).toBe(true);

    await wrapper.findAll(".vs__dropdown-option")[1].trigger("click");
    await nextTick();
    expect(appState.activeDropdown).toBe(false);
  });
});
