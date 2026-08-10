// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";

import SetupSelection from "@/components/ui/setup/SetupSelection.vue";

// jsdom has no ResizeObserver; the dropdown positioning observes the menu.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const options = ["Kitchen", "Living room", "Bedroom"];

let wrapper: ReturnType<typeof mount> | undefined;

function mountSelection(props: Record<string, unknown> = {}) {
  wrapper = mount(SetupSelection, {
    props: {
      value: "Kitchen",
      params: { param: "source" },
      options,
      ...props,
    },
    global: {
      mocks: { $t: (key: string) => `T:${key}` },
    },
    attachTo: document.body,
  });
  return wrapper;
}

// The free-text affordances key off `allowFreeText` or a `source_list` param.
function mountFreeText(props: Record<string, unknown> = {}) {
  return mountSelection({ allowFreeText: true, ...props });
}

type Wrapper = ReturnType<typeof mountSelection>;

// The dropdown is teleported to <body>, so it lives outside the wrapper
// subtree: query the document for it.
function menu() {
  return document.querySelector(".vs__dropdown-menu");
}

function menuOptions() {
  return Array.from(
    document.querySelectorAll(".vs__dropdown-menu .vs__dropdown-option"),
  ) as HTMLElement[];
}

function menuLabels() {
  return menuOptions().map((el) => el.textContent?.trim());
}

async function openSelect(w: Wrapper) {
  await w.find(".vs__dropdown-toggle").trigger("mousedown");
  await nextTick();
}

async function type(w: Wrapper, text: string) {
  await w.find("input.vs__search").setValue(text);
  await nextTick();
}

async function pressEnter(w: Wrapper) {
  await w.find(".v-select").trigger("keydown", { key: "Enter" });
  await nextTick();
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
});

describe("SetupSelection", () => {
  it("renders every option and marks the selected one", async () => {
    const w = mountSelection();
    await openSelect(w);

    expect(menuLabels()).toEqual(options);
    expect(
      document.querySelector(".vs__dropdown-option--selected")?.textContent,
    ).toContain("Kitchen");
  });

  it("emits change with the picked option and closes", async () => {
    const w = mountSelection();
    await openSelect(w);

    menuOptions()[1].click();
    await nextTick();

    expect(w.emitted("change")).toEqual([
      [{ paramValue: "Living room", paramName: "source" }],
    ]);
    expect(menu()).toBeNull();
  });

  it("has no search input unless free text is enabled", () => {
    const w = mountSelection();
    expect(w.find("input.vs__search").exists()).toBe(false);
    expect(w.find(".v-select").classes()).toContain("vs--unsearchable");
  });

  it("filters the options by the typed text", async () => {
    const w = mountFreeText();
    await openSelect(w);
    await type(w, "living");

    expect(menuLabels()).toEqual(["Living room"]);
    expect(w.find(".v-select").classes()).toContain("vs--searching");
  });

  it("matches anywhere in the label, not just the start", async () => {
    const w = mountFreeText();
    await openSelect(w);
    await type(w, "room");

    expect(menuLabels()).toEqual(["Living room", "Bedroom"]);
  });

  it("filters case-insensitively", async () => {
    const w = mountFreeText();
    await openSelect(w);
    await type(w, "KITCHEN");

    expect(menuLabels()).toEqual(["Kitchen"]);
  });

  it("commits free text on Enter when nothing matches", async () => {
    const w = mountFreeText();
    await openSelect(w);
    await type(w, "Balcony");
    expect(menuLabels()).toEqual([]);

    await pressEnter(w);

    expect(w.emitted("change")).toEqual([
      [{ paramValue: "Balcony", paramName: "source" }],
    ]);
    expect(menu()).toBeNull();
  });

  it("picks the highlighted option on Enter instead of committing free text", async () => {
    const w = mountFreeText();
    await openSelect(w);
    await type(w, "Bed");

    await pressEnter(w);

    expect(w.emitted("change")).toEqual([
      [{ paramValue: "Bedroom", paramName: "source" }],
    ]);
  });

  it("commits free text through the add button", async () => {
    const w = mountFreeText();
    await openSelect(w);
    await type(w, "Balcony");

    const addButton = document.querySelector(
      ".button-add-freetext",
    ) as HTMLElement;
    expect(addButton).not.toBeNull();
    addButton.click();
    await nextTick();

    expect(w.emitted("change")).toEqual([
      [{ paramValue: "Balcony", paramName: "source" }],
    ]);
  });

  it("offers no clear button in plain mode", () => {
    const w = mountSelection();
    expect(w.find(".vs__clear").exists()).toBe(false);
  });

  it("clears the value through the clear button without toggling open", async () => {
    const w = mountFreeText();
    expect(w.find(".vs__clear").exists()).toBe(true);

    await w.find(".vs__clear").trigger("mousedown");
    await nextTick();
    expect(menu()).toBeNull();

    await w.find(".vs__clear").trigger("click");
    await nextTick();

    expect(w.emitted("change")).toEqual([
      [{ paramValue: "", paramName: "source" }],
    ]);
  });

  it("treats a source_list param as free text", () => {
    const w = mountSelection({
      params: { param: "source", items: { field: "source_list" } },
    });
    expect(w.find("input.vs__search").exists()).toBe(true);
    expect(w.find(".v-select").classes()).toContain("vs--searchable");
  });

  it("does not open when disabled", async () => {
    const w = mountSelection({ disabled: true });
    await openSelect(w);

    expect(menu()).toBeNull();
    expect(w.find(".v-select").classes()).toContain("vs--disabled");
  });

  it("closes on Escape, dropping the query first", async () => {
    const w = mountFreeText();
    await openSelect(w);
    await type(w, "Bed");

    await w.find(".v-select").trigger("keydown", { key: "Escape" });
    await nextTick();
    expect(menu()).not.toBeNull();
    expect(menuLabels()).toEqual(options);

    await w.find(".v-select").trigger("keydown", { key: "Escape" });
    await nextTick();
    expect(menu()).toBeNull();
    expect(w.emitted("change")).toBeUndefined();
  });

  it("closes when the backdrop is clicked", async () => {
    const w = mountSelection();
    await openSelect(w);
    expect(menu()).not.toBeNull();

    await w.find(".v-select__custom-background").trigger("click");
    await nextTick();

    expect(menu()).toBeNull();
    expect(w.emitted("change")).toBeUndefined();
  });

  // Regression: clicking the arrow/label (anything but the search input) in
  // free-text mode must preventDefault the mousedown. Otherwise the browser
  // moves focus off the search input that openSelect() just focused, firing a
  // focusout with a null relatedTarget that onFocusout reads as "focus left the
  // select" and closes the dropdown again — so it opened via the arrow but not
  // the text. The unsearchable toggle stays focusable, so it must NOT prevent.
  it("prevents the mousedown default on the arrow in free-text mode", async () => {
    const w = mountFreeText();
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });

    w.find(".vs__actions").element.dispatchEvent(event);
    await nextTick();

    expect(event.defaultPrevented).toBe(true);
    expect(menu()).not.toBeNull();
  });

  it("leaves the mousedown default on the search input so the caret works", async () => {
    const w = mountFreeText();
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });

    w.find("input.vs__search").element.dispatchEvent(event);
    await nextTick();

    expect(event.defaultPrevented).toBe(false);
  });

  it("does not prevent the mousedown default when not searchable", async () => {
    const w = mountSelection();
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });

    w.find(".vs__actions").element.dispatchEvent(event);
    await nextTick();

    expect(event.defaultPrevented).toBe(false);
  });
});
