// @vitest-environment jsdom
//
// The media widget switches between two layouts depending on the shape of the
// cell it was given: wide and short puts the cover art beside the track info
// (`--compact`, _ui-page.scss), anything squarer stacks them.
//
// The shape is decided by the grid, and the grid reshapes the cell without ever
// re-creating this component — a window resize does it, and so does adding rows
// to the page. It used to be read once with `getBoundingClientRect()` inside the
// class computed, which nothing invalidates, so the widget kept whichever layout
// the first measurement produced. The nastiest case was mounting at 0x0: the
// editor panel sits behind a `v-show` tab, so a widget created while another tab
// was open measured nothing and never corrected itself.
//
// Both directions are pinned here; either one regressing means a widget stuck in
// the wrong layout.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

import ComponentButtonMedia from "@/components/ui/ComponentButtonMedia.vue";

const COMPACT = "ui-component--media-player--compact";

/**
 * jsdom has no ResizeObserver and never lays anything out, so the size has to be
 * fed in by hand. This records the observers `useElementSize` creates and lets a
 * test push a new box to them, which is exactly what the browser does when the
 * grid cell changes shape.
 */
type Callback = (entries: ResizeObserverEntry[]) => void;
let observers: { callback: Callback; targets: Element[] }[] = [];

function resizeTo(width: number, height: number) {
  const observing = observers.filter((o) => o.targets.length > 0);
  // Without this the "not compact" expectations would pass vacuously.
  if (observing.length === 0) {
    throw new Error("nothing is being observed: the widget never measured");
  }
  for (const observer of observing) {
    observer.callback(
      observer.targets.map(
        (target) => ({ target, contentRect: { width, height } }) as never,
      ),
    );
  }
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private entry: { callback: Callback; targets: Element[] };
      constructor(callback: Callback) {
        this.entry = { callback, targets: [] };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.targets.push(target);
      }
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function mountWidget() {
  const wrapper = mount(ComponentButtonMedia, {
    props: {
      settings: {
        type: "media_player",
        size: { width: 4, height: 1 },
        location: { x: 0, y: 0 },
      },
    },
    global: { mocks: { $t: (key: string) => key } },
  });
  // useElementSize attaches its observer in a post-flush watcher.
  await nextTick();
  return wrapper;
}

describe("media widget layout follows the cell it is given", () => {
  it("takes the compact layout once a wide, short cell is measured", async () => {
    const wrapper = await mountWidget();
    // Mounted with no layout at all — what a `v-show`-hidden tab produces.
    expect(wrapper.classes()).not.toContain(COMPACT);

    resizeTo(300, 90);
    await nextTick();

    expect(wrapper.classes()).toContain(COMPACT);
  });

  it("drops the compact layout when the cell becomes tall", async () => {
    const wrapper = await mountWidget();
    resizeTo(300, 90);
    await nextTick();
    expect(wrapper.classes()).toContain(COMPACT);

    resizeTo(300, 300);
    await nextTick();

    expect(wrapper.classes()).not.toContain(COMPACT);
  });

  it("keeps the stacked layout for a cell that is not short enough", async () => {
    const wrapper = await mountWidget();
    // 0.6 is the cut-off; 0.6 exactly is not compact.
    resizeTo(300, 180);
    await nextTick();

    expect(wrapper.classes()).not.toContain(COMPACT);
  });
});
