// @vitest-environment jsdom
//
// Render-contract guard for vue3-carousel (3 consumers: QuickTips.vue,
// ActivityRemote.vue, DeviceRemote.vue).
//
// All three mount the same shape: a <Carousel> with a v-model, one <Slide>
// per item in the default slot, and a <Pagination> in the #addons slot. A
// major bump that renames the components, drops the #addons slot, or changes
// how slides are projected would render an EMPTY carousel — the pages/tips
// would silently vanish while type-check and the no-error smoke stay green
// (the vue-draggable-next failure mode). This test fails on that: it asserts
// one node renders per item through the default slot, and that the #addons
// Pagination renders.
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { Carousel, Slide, Pagination } from "vue3-carousel";

// jsdom has no ResizeObserver; vue3-carousel observes its viewport on mount.
// All target browsers provide it — this is a test-env shim, not an app concern.
// (Same pattern as test/setupSelection.test.ts.)
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const items = ["a", "b", "c"];

const Host = defineComponent({
  components: { Carousel, Slide, Pagination },
  setup() {
    return { current: ref(0) };
  },
  render() {
    return h(
      Carousel,
      {
        modelValue: this.current,
        "onUpdate:modelValue": (v: number) => (this.current = v),
        itemsToShow: 1,
        itemsToScroll: 1,
        wrapAround: false,
        snapAlign: "start",
      },
      {
        default: () =>
          items.map((it, i) =>
            h(
              Slide,
              { key: i },
              { default: () => h("div", { class: "slide-content" }, it) },
            ),
          ),
        addons: () => h(Pagination),
      },
    );
  },
});

describe("vue3-carousel render contract", () => {
  it("renders one slide per item through the default slot", () => {
    const wrapper = mount(Host);
    const slides = wrapper.findAll(".slide-content");
    expect(slides.map((s) => s.text())).toEqual(items);
  });

  it("renders the #addons Pagination", () => {
    const wrapper = mount(Host);
    expect(wrapper.find(".carousel__pagination").exists()).toBe(true);
  });
});
