// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";

import UCSelect from "@/components/ui/UCSelect.vue";
import type { SelectOption } from "@/types/ui";

const options: SelectOption[] = [
  { label: "Alpha", value: "a" },
  { label: "Beta", value: "b" },
  { label: "Gamma", value: "c" },
];

function mountSelect(props: Record<string, unknown> = {}) {
  return mount(UCSelect, {
    props: {
      options,
      modelValue: null as unknown as SelectOption,
      ...props,
    },
    global: {
      mocks: { $t: (key: string) => `T:${key}` },
    },
    attachTo: document.body,
  });
}

type Wrapper = ReturnType<typeof mountSelect>;

async function openDropdown(wrapper: Wrapper) {
  await wrapper.find(".vs__dropdown-toggle").trigger("mousedown");
  await nextTick();
}

function isDropdownOpen(wrapper: Wrapper) {
  return wrapper.find(".vs__dropdown-menu").exists();
}

describe("UCSelect single mode", () => {
  it("selects an option, emits once and closes the dropdown", async () => {
    const wrapper = mountSelect();
    await openDropdown(wrapper);
    expect(isDropdownOpen(wrapper)).toBe(true);

    await wrapper.findAll(".vs__dropdown-option")[1].trigger("click");
    await nextTick();

    expect(wrapper.emitted("update:modelValue")).toEqual([[options[1]]]);
    expect(wrapper.emitted("select")).toEqual([[options[1]]]);
    expect(isDropdownOpen(wrapper)).toBe(false);
  });

  it("emits opened true on open and false on close", async () => {
    const wrapper = mountSelect();
    await openDropdown(wrapper);
    await wrapper.findAll(".vs__dropdown-option")[0].trigger("click");
    await nextTick();

    expect(wrapper.emitted("opened")).toEqual([[true], [false]]);
  });

  it("renders the selected label in the toggle and marks the option selected", async () => {
    const wrapper = mountSelect({ modelValue: options[2] });
    expect(wrapper.find(".vs__selected").text()).toBe("Gamma");

    await openDropdown(wrapper);
    const items = wrapper.findAll(".vs__dropdown-option");

    expect(items[2].classes()).toContain("vs__dropdown-option--selected");
    expect(items[2].attributes("aria-selected")).toBe("true");
    expect(items[0].attributes("aria-selected")).toBe("false");
  });

  it("closes when the backdrop is clicked", async () => {
    const wrapper = mountSelect();
    await openDropdown(wrapper);

    await wrapper.find(".v-select__custom-background").trigger("click");
    await nextTick();

    expect(isDropdownOpen(wrapper)).toBe(false);
    expect(wrapper.emitted("select")).toBeUndefined();
  });
});

describe("UCSelect keyboard", () => {
  it("opens on ArrowDown and moves the highlight", async () => {
    const wrapper = mountSelect();
    const toggle = wrapper.find(".vs__dropdown-toggle");

    await toggle.trigger("keydown", { key: "ArrowDown" });
    await nextTick();
    expect(isDropdownOpen(wrapper)).toBe(true);
    expect(wrapper.findAll(".vs__dropdown-option")[0].classes()).toContain(
      "vs__dropdown-option--highlight",
    );

    await toggle.trigger("keydown", { key: "ArrowDown" });
    await nextTick();
    expect(wrapper.findAll(".vs__dropdown-option")[1].classes()).toContain(
      "vs__dropdown-option--highlight",
    );

    await toggle.trigger("keydown", { key: "ArrowUp" });
    await nextTick();
    expect(wrapper.findAll(".vs__dropdown-option")[0].classes()).toContain(
      "vs__dropdown-option--highlight",
    );
  });

  it("jumps to the last option on End and the first on Home", async () => {
    const wrapper = mountSelect();
    const toggle = wrapper.find(".vs__dropdown-toggle");
    await openDropdown(wrapper);

    await toggle.trigger("keydown", { key: "End" });
    await nextTick();
    expect(wrapper.findAll(".vs__dropdown-option")[2].classes()).toContain(
      "vs__dropdown-option--highlight",
    );

    await toggle.trigger("keydown", { key: "Home" });
    await nextTick();
    expect(wrapper.findAll(".vs__dropdown-option")[0].classes()).toContain(
      "vs__dropdown-option--highlight",
    );
  });

  it("selects the highlighted option with Enter and closes in single mode", async () => {
    const wrapper = mountSelect();
    const toggle = wrapper.find(".vs__dropdown-toggle");

    await toggle.trigger("keydown", { key: "ArrowDown" });
    await toggle.trigger("keydown", { key: "ArrowDown" });
    await toggle.trigger("keydown", { key: "Enter" });
    await nextTick();

    expect(wrapper.emitted("select")).toEqual([[options[1]]]);
    expect(isDropdownOpen(wrapper)).toBe(false);
  });

  it("toggles with Enter and stays open in multiple mode", async () => {
    const wrapper = mountSelect({ multiple: true, modelValue: [] });
    const toggle = wrapper.find(".vs__dropdown-toggle");

    await toggle.trigger("keydown", { key: "ArrowDown" });
    await toggle.trigger("keydown", { key: "Enter" });
    await nextTick();

    expect(wrapper.emitted("select")).toEqual([[[options[0]]]]);
    expect(isDropdownOpen(wrapper)).toBe(true);
  });

  it("closes on Escape without changing the model", async () => {
    const wrapper = mountSelect();
    const toggle = wrapper.find(".vs__dropdown-toggle");
    await openDropdown(wrapper);

    await toggle.trigger("keydown", { key: "Escape" });
    await nextTick();

    expect(isDropdownOpen(wrapper)).toBe(false);
    expect(wrapper.emitted("select")).toBeUndefined();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("reflects the open state in aria-expanded", async () => {
    const wrapper = mountSelect();
    const toggle = wrapper.find(".vs__dropdown-toggle");
    expect(toggle.attributes("aria-expanded")).toBe("false");

    await openDropdown(wrapper);
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(toggle.attributes("aria-controls")).toBe(
      wrapper.find(".vs__dropdown-menu").attributes("id"),
    );
  });
});

describe("UCSelect searchable", () => {
  it("filters the options while typing", async () => {
    const wrapper = mountSelect({ searchable: true });
    await openDropdown(wrapper);
    expect(wrapper.findAll(".vs__dropdown-option").length).toBe(3);

    await wrapper.find("input.vs__search").setValue("ET");
    await nextTick();

    const items = wrapper.findAll(".vs__dropdown-option");
    expect(items.length).toBe(1);
    expect(items[0].text()).toBe("Beta");
    expect(wrapper.find(".v-select").classes()).toContain("vs--searching");
  });

  it("shows the no-options message when nothing matches", async () => {
    const wrapper = mountSelect({ searchable: true });
    await openDropdown(wrapper);

    await wrapper.find("input.vs__search").setValue("zzz");
    await nextTick();

    expect(wrapper.findAll(".vs__dropdown-option").length).toBe(0);
    expect(wrapper.find(".v-select__no-options").text()).toBe(
      "T:form.no_options_found",
    );
  });

  it("renders no search input when not searchable", async () => {
    const wrapper = mountSelect();
    expect(wrapper.find("input.vs__search").exists()).toBe(false);
    expect(wrapper.find(".v-select").classes()).toContain("vs--unsearchable");
  });
});

describe("UCSelect langKeys", () => {
  it("translates option labels and the selected label", async () => {
    const wrapper = mountSelect({ langKeys: true, modelValue: options[0] });
    expect(wrapper.find(".vs__selected").text()).toBe("T:Alpha");

    await openDropdown(wrapper);
    expect(wrapper.findAll(".vs__dropdown-option")[1].text()).toBe("T:Beta");
  });
});

describe("UCSelect disabled", () => {
  it("does not open when the component is disabled", async () => {
    const wrapper = mountSelect({ disabled: true });
    await openDropdown(wrapper);

    expect(isDropdownOpen(wrapper)).toBe(false);
    expect(wrapper.find(".v-select").classes()).toContain("vs--disabled");
    expect(
      wrapper.find(".vs__dropdown-toggle").attributes("aria-disabled"),
    ).toBe("true");
  });

  it("skips a disabled option on click and on keyboard navigation", async () => {
    const wrapper = mountSelect({
      options: [
        { label: "Alpha", value: "a" },
        { label: "Beta", value: "b", disabled: true },
        { label: "Gamma", value: "c" },
      ],
    });
    const toggle = wrapper.find(".vs__dropdown-toggle");
    await openDropdown(wrapper);

    const disabledOption = wrapper.findAll(".vs__dropdown-option")[1];
    expect(disabledOption.classes()).toContain("vs__dropdown-option--disabled");
    expect(disabledOption.attributes("aria-disabled")).toBe("true");

    await disabledOption.trigger("click");
    await nextTick();
    expect(wrapper.emitted("select")).toBeUndefined();

    // ArrowDown from the first option must land on Gamma, skipping Beta.
    await toggle.trigger("keydown", { key: "ArrowDown" });
    await toggle.trigger("keydown", { key: "ArrowDown" });
    await nextTick();
    expect(wrapper.findAll(".vs__dropdown-option")[2].classes()).toContain(
      "vs__dropdown-option--highlight",
    );
  });
});

describe("UCSelect option icons", () => {
  it("renders an option icon when present", async () => {
    const wrapper = mountSelect({
      options: [{ label: "Alpha", value: "a", icon: "fa-solid fa-star" }],
    });
    await openDropdown(wrapper);

    expect(wrapper.find(".vs__dropdown-option i").classes()).toEqual([
      "fa-solid",
      "fa-star",
    ]);
  });
});

describe("UCSelect selected label", () => {
  // Callers hold the selection as a copy of the option they picked, so its label
  // is frozen in the language it was picked in. `options` is rebuilt on a
  // language change, and that is what has to be displayed.
  it("displays the label from options, not the one the model carries", async () => {
    const wrapper = mountSelect({ modelValue: { label: "Beta", value: "b" } });
    expect(wrapper.find(".vs__selected").text()).toBe("Beta");

    await wrapper.setProps({
      options: [
        { label: "Alpha", value: "a" },
        { label: "Bêta", value: "b" },
        { label: "Gamma", value: "c" },
      ],
    });

    expect(wrapper.find(".vs__selected").text()).toBe("Bêta");
  });

  it("falls back to the model's own label when the value is not in options", () => {
    const wrapper = mountSelect({
      modelValue: { label: "Not listed", value: "zzz" },
    });

    expect(wrapper.find(".vs__selected").text()).toBe("Not listed");
  });
});
