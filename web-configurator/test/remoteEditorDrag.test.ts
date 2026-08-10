// @vitest-environment jsdom
//
// Characterization tests for src/composables/remote/editorDrag.ts.
//
// Locks in the drag composable's testable behaviour: the collision guard
// (onGridMove), the off-grid revert (onGridNativeMove), tap-to-add placement
// (prototypeAdd), and the drag-start snapshot watch. The pointer-driven
// prototypeDrag/prototypeDragEnd depend on live vue-grid-layout components
// (calcXY, dragEvent, $el geometry) and are left to e2e.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createApp, nextTick, ref } from "vue";
import type { App, Ref } from "vue";
import { createPinia, setActivePinia } from "pinia";

import { useEditorDrag } from "@/composables/remote/editorDrag";
import type { EditorDragContext } from "@/composables/remote/editorDrag";
import type {
  ActivityUserInterfaceGridItem,
  ActivityUserInterfaceItem,
  ActivityUserInterfacePage,
} from "@/types/activity";
import type { GridLayoutComponent } from "@/types/grid";

// --- fixtures ---------------------------------------------------------------

function uiItem(
  x: number,
  y: number,
  width = 1,
  height = 1,
  type: ActivityUserInterfaceItem["type"] = "icon",
): ActivityUserInterfaceItem {
  return { type, location: { x, y }, size: { width, height } };
}

function gridItem(
  x: number,
  y: number,
  w: number,
  h: number,
  i = "0",
): ActivityUserInterfaceGridItem {
  return { x, y, w, h, i, item: uiItem(x, y, w, h) };
}

function page(
  page_id: string,
  items: ActivityUserInterfaceItem[],
  width = 4,
  height = 6,
): ActivityUserInterfacePage {
  return { page_id, items, grid: { width, height } };
}

// A drag area whose $el geometry is all prototypeAdd needs (it only reads the
// bounding rect, and only for the deferred popup coordinates).
function mockDragArea(): GridLayoutComponent {
  return {
    $el: { getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0 }) },
  } as unknown as GridLayoutComponent;
}

type Ctx = {
  pages: Ref<ActivityUserInterfacePage[]>;
  activePage: Ref<number>;
  layouts: Ref<ActivityUserInterfaceGridItem[][]>;
  dragAreas: EditorDragContext["dragAreas"];
  gridItems: EditorDragContext["gridItems"];
  saveableItem: Ref<boolean>;
  savePage: ReturnType<typeof vi.fn>;
  addUiPage: ReturnType<typeof vi.fn>;
  startWidgetEditAt: ReturnType<typeof vi.fn>;
};

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    pages: ref([page("p0", [], 4, 6)]),
    activePage: ref(0),
    layouts: ref<ActivityUserInterfaceGridItem[][]>([[]]),
    dragAreas: ref({}),
    gridItems: ref({}),
    saveableItem: ref(true),
    savePage: vi.fn().mockResolvedValue(undefined),
    addUiPage: vi.fn().mockResolvedValue(undefined),
    startWidgetEditAt: vi.fn(),
    ...overrides,
  };
}

function setup(ctx: Ctx): [ReturnType<typeof useEditorDrag>, App] {
  let api!: ReturnType<typeof useEditorDrag>;
  const app = createApp({
    setup() {
      api = useEditorDrag(ctx as unknown as EditorDragContext);
      return () => null;
    },
  });
  app.mount(document.createElement("div"));
  return [api, app];
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

// --- onGridMove -------------------------------------------------------------

describe("onGridMove", () => {
  it("records the active item and drops the collision guard once it moves", async () => {
    const [api] = setup(makeCtx());
    expect(api.preventCollision.value).toBe(true);

    await api.onGridMove("a", 1, 2);

    expect(api.activeGridItem.value).toEqual({ id: "a", x: 1, y: 2 });
    expect(api.preventCollision.value).toBe(false);
  });

  it("keeps the guard when the move matches the last prevented position", async () => {
    const [api] = setup(makeCtx());
    api.preventedActiveGridItem.value = { id: "a", x: 1, y: 2 };
    api.preventCollision.value = true;

    await api.onGridMove("a", 1, 2);

    expect(api.preventCollision.value).toBe(true);
  });
});

// --- onGridNativeMove -------------------------------------------------------

describe("onGridNativeMove", () => {
  it("does nothing while the collision guard is up", () => {
    const ctx = makeCtx({ layouts: ref([[gridItem(0, 5, 1, 2)]]) });
    const [api] = setup(ctx);
    api.isGridItemDragging.value = true;
    api.preventCollision.value = true; // guard up -> early return

    onGridNativeMoveSync(api);

    expect(ctx.layouts.value[0]).toEqual([gridItem(0, 5, 1, 2)]);
  });

  it("reverts the layout and re-arms the guard when an item is dragged off the grid", () => {
    // grid height 6; item at y=5 h=2 pokes to bottom 7 -> off grid
    const ctx = makeCtx({ layouts: ref([[gridItem(0, 5, 1, 2)]]) });
    const [api] = setup(ctx);

    api.isGridItemDragging.value = true;
    api.preventCollision.value = false;
    api.actualItems.value = [gridItem(0, 0, 1, 1)]; // last known good

    onGridNativeMoveSync(api);

    // layout is restored to the last-good snapshot and the guard is re-armed
    expect(ctx.layouts.value[0]).toEqual([gridItem(0, 0, 1, 1)]);
    expect(api.preventCollision.value).toBe(true);
    expect(api.preventedActiveGridItem.value).toEqual(api.activeGridItem.value);
  });

  it("snapshots the layout without reverting when everything fits", () => {
    const ctx = makeCtx({ layouts: ref([[gridItem(0, 0, 1, 1)]]) });
    const [api] = setup(ctx);

    api.isGridItemDragging.value = true;
    api.preventCollision.value = false;
    api.actualItems.value = [gridItem(3, 3, 1, 1)]; // differs, but nothing off-grid

    onGridNativeMoveSync(api);

    expect(ctx.layouts.value[0]).toEqual([gridItem(0, 0, 1, 1)]); // unchanged
    expect(api.preventCollision.value).toBe(false);
    expect(api.actualItems.value).toEqual([gridItem(0, 0, 1, 1)]); // resnapshotted
  });
});

// --- prototypeAdd -----------------------------------------------------------

describe("prototypeAdd", () => {
  it("places a widget in the first free cell and saves it", async () => {
    const ctx = makeCtx({
      pages: ref([page("p0", [], 4, 6)]),
      layouts: ref([[]]),
      dragAreas: ref({ p0: mockDragArea() }),
    });
    const [api] = setup(ctx);

    await api.prototypeAdd({} as MouseEvent, uiItem(0, 0, 1, 1, "icon"));

    expect(ctx.pages.value[0].items).toHaveLength(1);
    expect(ctx.pages.value[0].items[0].location).toEqual({ x: 0, y: 0 });
    expect(ctx.savePage).toHaveBeenCalledWith(0);
    // the new widget's edit popup opens directly, addressed by its index
    expect(ctx.startWidgetEditAt).toHaveBeenCalledWith(
      0,
      0,
      ctx.pages.value[0].items[0],
      expect.any(Number),
    );
  });

  it("adds a media_player widget but does not save until it is configured", async () => {
    const ctx = makeCtx({
      pages: ref([page("p0", [], 4, 6)]),
      layouts: ref([[]]),
      dragAreas: ref({ p0: mockDragArea() }),
    });
    const [api] = setup(ctx);

    await api.prototypeAdd(
      {} as MouseEvent,
      uiItem(0, 0, 1, 1, "media_player"),
    );

    expect(ctx.pages.value[0].items).toHaveLength(1);
    expect(ctx.saveableItem.value).toBe(false);
    expect(ctx.savePage).not.toHaveBeenCalled();
  });
});

// --- drag-start snapshot watch ---------------------------------------------

describe("drag-start snapshot", () => {
  it("snapshots the active page's items when dragging begins", async () => {
    const ctx = makeCtx({ pages: ref([page("p0", [uiItem(2, 3)])]) });
    const [api] = setup(ctx);

    api.isGridItemDragging.value = true;
    await nextTick();

    expect(api.actualItems.value).toEqual([uiItem(2, 3)]);
    // it is a clone, not the same array reference
    expect(api.actualItems.value).not.toBe(ctx.pages.value[0].items);
  });
});

// onGridNativeMove is synchronous; the helper just documents intent.
function onGridNativeMoveSync(api: ReturnType<typeof useEditorDrag>) {
  api.onGridNativeMove();
}
