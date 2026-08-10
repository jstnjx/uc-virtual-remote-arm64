// @vitest-environment jsdom
//
// Characterization tests for src/composables/remote/editor.ts.
//
// These lock in the *current* behavior of the page-editor composable before it
// is split into focused composables (backlog Task 2). The page editor has no
// component tests, so the goal here is a safety net over the pure logic and the
// fragile index-mapping / layout-math paths the review flagged: collision
// detection, occupancy scanning, widget placement, the `entry.i` based grid
// mapping in moved/resized, the multi-page delete map, and the paste offset
// math. Timing/DOM-choreography paths (popup positioning, prototypeDrag) are
// deliberately left to e2e — they are what the refactor is meant to change.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createApp } from "vue";
import type { App } from "vue";
import { createPinia, setActivePinia } from "pinia";

import {
  collides,
  getAllCollisions,
  validateChange,
  useEditorKeyboardEvents,
} from "@/composables/remote/editor";
import type {
  ActivityUserInterfaceGridItem,
  ActivityUserInterfaceItem,
  ActivityUserInterfacePage,
} from "@/types/activity";
import type { TFunction } from "i18next";

// --- fixtures ---------------------------------------------------------------

function gridItem(
  x: number,
  y: number,
  w: number,
  h: number,
  i = "0",
): ActivityUserInterfaceGridItem {
  return { x, y, w, h, i, item: uiItem(x, y, w, h) };
}

function uiItem(
  x: number,
  y: number,
  width = 1,
  height = 1,
  type: ActivityUserInterfaceItem["type"] = "icon",
): ActivityUserInterfaceItem {
  return {
    type,
    location: { x, y },
    size: { width, height },
  };
}

function page(
  page_id: string,
  items: ActivityUserInterfaceItem[],
  width = 4,
  height = 6,
): ActivityUserInterfacePage {
  return { page_id, items, grid: { width, height } };
}

// Passthrough translator: returns the key, which is all the assertions need.
const t = ((key: string) => key) as unknown as TFunction;

// Mount the composable inside a real component instance so its onMounted /
// onUnmounted lifecycle hooks run without Vue warnings.
function setupEditor(callbacks?: {
  addUiPage?: () => Promise<void>;
  savePage?: (pageIndex: number, skip?: boolean) => Promise<void>;
  setLayouts?: () => Promise<void>;
}): [ReturnType<typeof useEditorKeyboardEvents>, App] {
  let api!: ReturnType<typeof useEditorKeyboardEvents>;
  const app = createApp({
    setup() {
      api = useEditorKeyboardEvents(
        t,
        callbacks?.addUiPage,
        callbacks?.savePage,
        callbacks?.setLayouts,
      );
      return () => null;
    },
  });
  app.mount(document.createElement("div"));
  return [api, app];
}

beforeEach(() => {
  setActivePinia(createPinia());
});

// --- pure module-level helpers ---------------------------------------------

describe("collides", () => {
  it("returns false for the same element", () => {
    const a = gridItem(0, 0, 2, 2, "same");
    const b = { ...gridItem(0, 0, 2, 2, "same"), item: a.item };
    expect(collides(a, b)).toBe(false);
  });

  it("returns false when boxes only touch edges", () => {
    // a occupies x[0,2), b starts exactly at x=2 → adjacent, not overlapping
    expect(collides(gridItem(0, 0, 2, 2, "a"), gridItem(2, 0, 2, 2, "b"))).toBe(
      false,
    );
    expect(collides(gridItem(0, 0, 2, 2, "a"), gridItem(0, 2, 2, 2, "b"))).toBe(
      false,
    );
  });

  it("returns true for overlapping boxes", () => {
    expect(collides(gridItem(0, 0, 2, 2, "a"), gridItem(1, 1, 2, 2, "b"))).toBe(
      true,
    );
  });
});

describe("getAllCollisions", () => {
  it("returns only the colliding items", () => {
    const layout = [
      gridItem(0, 0, 1, 1, "a"),
      gridItem(2, 2, 1, 1, "b"),
      gridItem(5, 5, 1, 1, "c"),
    ];
    const probe = gridItem(2, 2, 1, 1, "probe");
    const hits = getAllCollisions(layout, probe);
    expect(hits).toHaveLength(1);
    expect(hits[0].i).toBe("b");
  });
});

describe("validateChange", () => {
  const items = [uiItem(0, 0, 1, 1), uiItem(2, 0, 1, 1)];

  it("is valid when the resize stays clear of neighbours", () => {
    // item 0 grows to 2x1: occupies x[0,2), neighbour at x=2 → no overlap
    expect(validateChange(items, 0, uiItem(0, 0, 2, 1))).toBe(true);
  });

  it("is invalid when the resize overlaps a neighbour", () => {
    // item 0 grows to 3x1: occupies x[0,3), neighbour at x=2 → overlap
    expect(validateChange(items, 0, uiItem(0, 0, 3, 1))).toBe(false);
  });
});

// --- buildLayout ------------------------------------------------------------

describe("buildLayout", () => {
  it("maps items to grid entries with stringified indices and size defaults", () => {
    const [ed] = setupEditor();
    const items = [uiItem(1, 2, 2, 3), { ...uiItem(0, 0), size: undefined }];
    const layout = ed.buildLayout(
      items as unknown as ActivityUserInterfaceItem[],
    );
    expect(layout[0]).toMatchObject({ x: 1, y: 2, w: 2, h: 3, i: "0" });
    expect(layout[1]).toMatchObject({ x: 0, y: 0, w: 1, h: 1, i: "1" });
  });

  it("forces numpad items to the top-left corner", () => {
    const [ed] = setupEditor();
    const layout = ed.buildLayout([uiItem(3, 4, 1, 1, "numpad")]);
    expect(layout[0]).toMatchObject({ x: 0, y: 0 });
  });
});

// --- getButtonSize ----------------------------------------------------------

describe("getButtonSize", () => {
  it("walks the size ladder", () => {
    const [ed] = setupEditor();
    expect(ed.getButtonSize(7, 1)).toBe("content-size--xs");
    expect(ed.getButtonSize(1, 11)).toBe("content-size--xs");
    expect(ed.getButtonSize(5, 1)).toBe("content-size--sm col-buttons--5");
    expect(ed.getButtonSize(1, 9)).toBe("content-size--sm col-buttons--1");
    expect(ed.getButtonSize(4, 1)).toBe("content-size--md");
    expect(ed.getButtonSize(1, 7)).toBe("content-size--md");
    expect(ed.getButtonSize(1, 1)).toBe("content-size--full-width");
    expect(ed.getButtonSize(2, 1)).toBe("content-size--md");
  });
});

// --- getEmptyItemStyle ------------------------------------------------------

describe("getEmptyItemStyle", () => {
  // The style is written in the drawn grid's own terms — percentages of the
  // shared containing block, spaced by the variables that style
  // `.ui-page__background` — so no pixel size or gap constant is duplicated
  // here. What is asserted is the cell arithmetic; the browser resolves it.
  const cellW =
    "(100% - 2 * var(--ui-page-grid-pad) - 3 * var(--ui-page-grid-gap)) / 4";
  const cellH =
    "(100% - 2 * var(--ui-page-grid-pad) - 5 * var(--ui-page-grid-gap)) / 6";

  it("places a cell by index within its grid", () => {
    const [ed] = setupEditor();
    ed.pages.value = [page("p0", [], 4, 6)];
    ed.activePage.value = 0;

    expect(ed.getEmptyItemStyle(1, 2, 0)).toBe(
      `left:calc(var(--ui-page-grid-pad) + 1 * ((${cellW}) + var(--ui-page-grid-gap)));` +
        `top:calc(var(--ui-page-grid-pad) + 2 * ((${cellH}) + var(--ui-page-grid-gap)));` +
        `width:calc(${cellW});height:calc(${cellH});`,
    );
  });

  it("puts the first cell flush against the grid padding", () => {
    const [ed] = setupEditor();
    ed.pages.value = [page("p0", [], 4, 6)];
    ed.activePage.value = 0;

    const style = ed.getEmptyItemStyle(0, 0, 0);
    expect(style).toContain("left:calc(var(--ui-page-grid-pad) + 0 * ");
    expect(style).toContain("top:calc(var(--ui-page-grid-pad) + 0 * ");
  });

  it("reads the cell counts from the addressed page, not the active one", () => {
    const [ed] = setupEditor();
    ed.pages.value = [page("p0", [], 4, 6), page("p1", [], 2, 3)];
    ed.activePage.value = 0;

    expect(ed.getEmptyItemStyle(0, 0, 1)).toContain(
      "1 * var(--ui-page-grid-gap)) / 2",
    );
  });
});

// --- getPageIndexById -------------------------------------------------------

describe("getPageIndexById", () => {
  it("finds the page or returns -1", () => {
    const [ed] = setupEditor();
    ed.pages.value = [page("a", []), page("b", [])];
    expect(ed.getPageIndexById("b")).toBe(1);
    expect(ed.getPageIndexById("missing")).toBe(-1);
  });
});

// --- selection --------------------------------------------------------------

describe("toggleItemSelect / itemSelected", () => {
  it("toggles selection state for a page/index pair", () => {
    const [ed] = setupEditor();
    expect(ed.itemSelected(0, 1)).toBe(false);
    ed.toggleItemSelect(0, 1);
    expect(ed.itemSelected(0, 1)).toBe(true);
    ed.toggleItemSelect(0, 1);
    expect(ed.itemSelected(0, 1)).toBe(false);
  });
});

// --- occupancy scanning -----------------------------------------------------

describe("isActivePageFull", () => {
  it("is true when every cell is occupied", () => {
    const [ed] = setupEditor();
    ed.pages.value = [page("p0", [uiItem(0, 0, 1, 1)], 1, 1)];
    ed.activePage.value = 0;
    expect(ed.isActivePageFull()).toBe(true);
  });

  it("is false when a cell is free", () => {
    const [ed] = setupEditor();
    ed.pages.value = [page("p0", [], 2, 2)];
    ed.activePage.value = 0;
    expect(ed.isActivePageFull()).toBe(false);
  });
});

describe("getEmptyCells", () => {
  it("lists free cells per page in row-major order", () => {
    const [ed] = setupEditor();
    ed.pages.value = [page("p0", [uiItem(0, 0, 1, 1)], 2, 2)];
    ed.activePage.value = 0;
    expect(ed.getEmptyCells()).toEqual({
      0: [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
    });
  });
});

// --- testWidgetPlacing ------------------------------------------------------

describe("testWidgetPlacing", () => {
  it("returns true when the widget fits", () => {
    const [ed] = setupEditor();
    ed.pages.value = [page("p0", [], 4, 6)];
    ed.activePage.value = 0;
    expect(ed.testWidgetPlacing(uiItem(0, 0, 2, 2))).toBe(true);
  });

  it("returns false when the widget is wider than the grid", () => {
    const [ed] = setupEditor();
    ed.pages.value = [page("p0", [], 4, 6)];
    ed.activePage.value = 0;
    expect(ed.testWidgetPlacing(uiItem(0, 0, 5, 1))).toBe(false);
  });

  it("returns false when the page grid is missing", () => {
    const [ed] = setupEditor();
    ed.pages.value = [{ page_id: "p0", items: [] } as never];
    ed.activePage.value = 0;
    expect(ed.testWidgetPlacing(uiItem(0, 0, 1, 1))).toBe(false);
  });
});

// --- collectGridItems -------------------------------------------------------

describe("collectGridItems", () => {
  it("collects existing items and sorts by x then y", () => {
    const [ed] = setupEditor();
    ed.pages.value = [
      page("p0", [uiItem(2, 1, 1, 1), uiItem(0, 3, 1, 1), uiItem(0, 1, 1, 1)]),
    ];
    const collected = ed.collectGridItems([
      { pageIndex: 0, itemIndex: 0 },
      { pageIndex: 0, itemIndex: 1 },
      { pageIndex: 0, itemIndex: 2 },
    ]);
    expect(collected.map((i) => i.location)).toEqual([
      { x: 0, y: 1 },
      { x: 0, y: 3 },
      { x: 2, y: 1 },
    ]);
  });

  it("skips missing pages and indices", () => {
    const [ed] = setupEditor();
    ed.pages.value = [page("p0", [uiItem(0, 0, 1, 1)])];
    const collected = ed.collectGridItems([
      { pageIndex: 0, itemIndex: 5 },
      { pageIndex: 9, itemIndex: 0 },
      { pageIndex: 0, itemIndex: 0 },
    ]);
    expect(collected).toHaveLength(1);
  });
});

// --- movedGridItem ----------------------------------------------------------

describe("movedGridItem", () => {
  it("applies new locations by the entry index, not array order", async () => {
    const savePage = vi.fn().mockResolvedValue(undefined);
    const [ed] = setupEditor({ savePage });
    ed.pages.value = [page("p0", [uiItem(0, 0, 1, 1), uiItem(1, 0, 1, 1)])];
    ed.activePage.value = 0;

    // newLayout deliberately out of array order; `i` carries the item index
    const newLayout = [gridItem(3, 3, 1, 1, "1"), gridItem(2, 2, 1, 1, "0")];
    await ed.movedGridItem("p0", newLayout, 6);

    expect(ed.pages.value[0].items[0].location).toEqual({ x: 2, y: 2 });
    expect(ed.pages.value[0].items[1].location).toEqual({ x: 3, y: 3 });
    expect(savePage).toHaveBeenCalledWith(0);
  });

  it("grows the grid height when an item extends below it but within max", async () => {
    const savePage = vi.fn().mockResolvedValue(undefined);
    const [ed] = setupEditor({ savePage });
    ed.pages.value = [page("p0", [uiItem(0, 0, 1, 1)], 4, 6)];
    ed.activePage.value = 0;

    await ed.movedGridItem("p0", [gridItem(0, 6, 1, 1, "0")], 10);

    expect(ed.pages.value[0].grid.height).toBe(7);
  });

  it("reverts (calls setLayouts, no save) when the item exceeds max height", async () => {
    const savePage = vi.fn().mockResolvedValue(undefined);
    const setLayouts = vi.fn().mockResolvedValue(undefined);
    const [ed] = setupEditor({ savePage, setLayouts });
    ed.pages.value = [page("p0", [uiItem(0, 0, 1, 1)], 4, 6)];
    ed.activePage.value = 0;

    await ed.movedGridItem("p0", [gridItem(0, 7, 1, 1, "0")], 6);

    expect(setLayouts).toHaveBeenCalledOnce();
    expect(savePage).not.toHaveBeenCalled();
    expect(ed.pages.value[0].items[0].location).toEqual({ x: 0, y: 0 });
  });
});

// --- resizedGridItem --------------------------------------------------------

describe("resizedGridItem", () => {
  it("applies size and location by entry index", async () => {
    const savePage = vi.fn().mockResolvedValue(undefined);
    const [ed] = setupEditor({ savePage });
    ed.pages.value = [page("p0", [uiItem(0, 0, 1, 1)])];
    ed.activePage.value = 0;

    await ed.resizedGridItem("p0", [gridItem(1, 1, 2, 3, "0")], 6);

    expect(ed.pages.value[0].items[0].size).toEqual({ width: 2, height: 3 });
    expect(ed.pages.value[0].items[0].location).toEqual({ x: 1, y: 1 });
    expect(savePage).toHaveBeenCalledWith(0);
  });
});

// --- deleteGridItems --------------------------------------------------------

describe("deleteGridItems", () => {
  it("deletes across pages and saves each affected page with skip flag", async () => {
    const savePage = vi.fn().mockResolvedValue(undefined);
    const [ed] = setupEditor({ savePage });
    ed.pages.value = [
      page("p0", [uiItem(0, 0), uiItem(1, 0), uiItem(2, 0)]),
      page("p1", [uiItem(0, 0), uiItem(1, 0)]),
    ];

    await ed.deleteGridItems([
      { pageIndex: 0, itemIndex: 1 },
      { pageIndex: 1, itemIndex: 0 },
    ]);

    expect(ed.pages.value[0].items.map((i) => i.location.x)).toEqual([0, 2]);
    expect(ed.pages.value[1].items.map((i) => i.location.x)).toEqual([1]);
    expect(savePage).toHaveBeenCalledWith(0, true);
    expect(savePage).toHaveBeenCalledWith(1, true);
  });
});

// --- deleteGridItem ---------------------------------------------------------

describe("deleteGridItem", () => {
  it("removes the item at the current edit coordinate and saves", async () => {
    const savePage = vi.fn().mockResolvedValue(undefined);
    const [ed] = setupEditor({ savePage });
    ed.pages.value = [page("p0", [uiItem(0, 0), uiItem(1, 0)])];
    ed.editButton.value = uiItem(0, 0);
    ed.editButtonCoord.value = { page: 0, index: 0 };

    await ed.deleteGridItem();

    expect(ed.pages.value[0].items.map((i) => i.location.x)).toEqual([1]);
    expect(savePage).toHaveBeenCalledWith(0);
  });

  it("does nothing without an active edit button", async () => {
    const savePage = vi.fn().mockResolvedValue(undefined);
    const [ed] = setupEditor({ savePage });
    ed.pages.value = [page("p0", [uiItem(0, 0)])];
    ed.editButton.value = null;

    await ed.deleteGridItem();

    expect(ed.pages.value[0].items).toHaveLength(1);
    expect(savePage).not.toHaveBeenCalled();
  });
});

// --- pasteGridItems ---------------------------------------------------------

describe("pasteGridItems", () => {
  it("appends copies at their own locations when no drop target is set", async () => {
    const savePage = vi.fn().mockResolvedValue(undefined);
    const [ed] = setupEditor({ savePage });
    ed.pages.value = [page("p0", [], 4, 6)];
    ed.activePage.value = 0;
    ed.newItemLocation.value = null;

    await ed.pasteGridItems([uiItem(0, 0, 1, 1), uiItem(1, 0, 1, 1)]);

    expect(ed.pages.value[0].items.map((i) => i.location)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(savePage).toHaveBeenCalledWith(0);
  });

  it("rejects when a pasted item lands on an occupied cell", async () => {
    const savePage = vi.fn().mockResolvedValue(undefined);
    const [ed] = setupEditor({ savePage });
    ed.pages.value = [page("p0", [uiItem(0, 0, 1, 1)], 4, 6)];
    ed.activePage.value = 0;
    ed.newItemLocation.value = null;

    await expect(ed.pasteGridItems([uiItem(0, 0, 1, 1)])).rejects.toThrow(
      "widget.error.no_position",
    );
    expect(savePage).not.toHaveBeenCalled();
  });
});

// --- addGridItem ------------------------------------------------------------

describe("addGridItem", () => {
  it("auto-places the item in the first free cell and records the coordinate", async () => {
    const savePage = vi.fn().mockResolvedValue(undefined);
    const [ed] = setupEditor({ savePage });
    ed.pages.value = [page("p0", [uiItem(0, 0, 1, 1)], 4, 6)];
    ed.activePage.value = 0;
    ed.newItemLocation.value = null;

    await ed.addGridItem(uiItem(0, 0, 1, 1));

    const items = ed.pages.value[0].items;
    expect(items).toHaveLength(2);
    expect(items[1].location).toEqual({ x: 1, y: 0 });
    expect(ed.isAddWidgetProgress()).toBe(true);
    expect(savePage).toHaveBeenCalledWith(0);
  });

  it("places at the requested drop location when it is free", async () => {
    const savePage = vi.fn().mockResolvedValue(undefined);
    const [ed] = setupEditor({ savePage });
    ed.pages.value = [page("p0", [], 4, 6)];
    ed.activePage.value = 0;
    ed.newItemLocation.value = { x: 2, y: 1 };

    await ed.addGridItem(uiItem(0, 0, 1, 1));

    expect(ed.pages.value[0].items[0].location).toEqual({ x: 2, y: 1 });
  });

  it("throws when there is no free position", async () => {
    const savePage = vi.fn().mockResolvedValue(undefined);
    const [ed] = setupEditor({ savePage });
    ed.pages.value = [page("p0", [uiItem(0, 0, 1, 1)], 1, 1)];
    ed.activePage.value = 0;
    ed.newItemLocation.value = null;

    await expect(ed.addGridItem(uiItem(0, 0, 1, 1))).rejects.toThrow(
      "widget.error.no_position",
    );
    expect(savePage).not.toHaveBeenCalled();
  });
});

// --- new-item metadata ------------------------------------------------------

describe("resetNewItemMeta / isAddWidgetProgress", () => {
  it("clears the pending widget coordinate", () => {
    const [ed] = setupEditor();
    ed.pages.value = [page("p0", [], 4, 6)];
    ed.activePage.value = 0;
    ed.newItemLocation.value = { x: 1, y: 1 };
    ed.resetNewItemMeta();
    expect(ed.isAddWidgetProgress()).toBe(false);
    expect(ed.newItemLocation.value).toBeNull();
  });
});

describe("setMediaPlayerMinHeight", () => {
  it("updates the reactive min height", () => {
    const [ed] = setupEditor();
    ed.setMediaPlayerMinHeight(400);
    expect(ed.mediaPlayerMinHeight.value).toBe(400);
  });
});
