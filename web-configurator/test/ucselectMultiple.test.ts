// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { defineComponent, ref, nextTick } from "vue";
import { mount } from "@vue/test-utils";

import SettingsOptionButton from "@/components/settings/SettingsOptionButton.vue";
import type { SelectOption } from "@/types/ui";

// Reproduces the SettingsLogs wiring: prop binding without v-model listener,
// state updated only through the select-update callback.
const Host = defineComponent({
  components: { SettingsOptionButton },
  setup() {
    const selected = ref<SelectOption[]>([]);
    const items: SelectOption[] = [
      { label: "Service A", value: "a" },
      { label: "Service B", value: "b" },
    ];
    const update = (m: SelectOption[]) => {
      selected.value = m;
    };
    return { selected, items, update };
  },
  template: `
    <SettingsOptionButton
      :select="true"
      :select-multiple="true"
      :select-update="update"
      :active-option-item="selected"
      :select-items="items"
      label="Services"
    />
  `,
});

function mountHost() {
  return mount(Host, {
    global: {
      mocks: { $t: (key: string) => key },
    },
    attachTo: document.body,
  });
}

async function openDropdown(wrapper: ReturnType<typeof mountHost>) {
  await wrapper.find(".vs__dropdown-toggle").trigger("mousedown");
  await nextTick();
}

function isDropdownOpen(wrapper: ReturnType<typeof mountHost>) {
  return wrapper.find(".vs__dropdown-menu").exists();
}

describe("UCSelect multiple mode", () => {
  it("selects an option on the first click of its toggle button and keeps the dropdown open", async () => {
    const wrapper = mountHost();
    await openDropdown(wrapper);

    const buttons = wrapper.findAll(".button--toggle-tick");
    expect(buttons.length).toBe(2);

    await buttons[0].trigger("click");
    await nextTick();

    expect(wrapper.vm.selected).toEqual([{ label: "Service A", value: "a" }]);
    const checkbox = wrapper.find<HTMLInputElement>("#a-checkbox-tick");
    expect(checkbox.element.checked).toBe(true);
    expect(isDropdownOpen(wrapper)).toBe(true);
  });

  it("deselects the last selected option on the first click of its toggle button", async () => {
    const wrapper = mountHost();
    wrapper.vm.selected = [{ label: "Service A", value: "a" }];
    await nextTick();
    await openDropdown(wrapper);

    const buttons = wrapper.findAll(".button--toggle-tick");
    await buttons[0].trigger("click");
    await nextTick();

    expect(wrapper.vm.selected).toEqual([]);
    expect(isDropdownOpen(wrapper)).toBe(true);
  });

  it("toggles selection when clicking the option text, without closing the dropdown", async () => {
    const wrapper = mountHost();
    await openDropdown(wrapper);

    const options = wrapper.findAll(".vs__dropdown-option");
    expect(options.length).toBe(2);

    await options[0].trigger("click");
    await nextTick();
    expect(wrapper.vm.selected).toEqual([{ label: "Service A", value: "a" }]);
    expect(isDropdownOpen(wrapper)).toBe(true);

    await wrapper.findAll(".vs__dropdown-option")[0].trigger("click");
    await nextTick();
    expect(wrapper.vm.selected).toEqual([]);
    expect(isDropdownOpen(wrapper)).toBe(true);
  });

  it("keeps parent state in sync across consecutive toggle clicks", async () => {
    const wrapper = mountHost();
    await openDropdown(wrapper);

    const buttons = wrapper.findAll(".button--toggle-tick");
    await buttons[0].trigger("click");
    await nextTick();
    await buttons[1].trigger("click");
    await nextTick();

    expect(wrapper.vm.selected).toEqual([
      { label: "Service A", value: "a" },
      { label: "Service B", value: "b" },
    ]);
    expect(isDropdownOpen(wrapper)).toBe(true);
  });
});
