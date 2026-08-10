// @vitest-environment jsdom
//
// Render-contract guard for the drag library (src/components/**, 9 consumers).
//
// Every draggable list in the app uses vuedraggable's `item-key` + `#item`
// scoped-slot API. A swap to a library that only reads the *default* slot
// (e.g. vue-draggable-next 2.x) renders an EMPTY container for this pattern,
// silently blanking every list while type-check and the no-error smoke suite
// stay green. This test fails on that class of regression: it asserts one node
// renders per item through the `#item` slot.
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import Draggable from "vuedraggable";

const Host = defineComponent({
  components: { Draggable },
  data: () => ({ list: [{ id: "a" }, { id: "b" }, { id: "c" }] }),
  render() {
    return h(
      Draggable,
      { list: this.list, itemKey: "id" },
      {
        item: ({ element }: { element: { id: string } }) =>
          h("div", { class: "row" }, element.id),
      },
    );
  },
});

describe("draggable #item scoped-slot render contract", () => {
  it("renders one node per item via the #item slot", () => {
    const wrapper = mount(Host);
    const rows = wrapper.findAll(".row");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.text())).toEqual(["a", "b", "c"]);
  });
});
