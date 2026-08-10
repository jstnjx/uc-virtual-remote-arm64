import { ref, watch, onMounted, onUnmounted } from "vue";

import type { Ref } from "vue";
import type {
  ActivityUserInterfaceItem,
  ActivityUserInterfaceGridItem,
  ActivityUserInterfacePage,
} from "@/types/activity";
import type { GridLayoutComponent, GridItemComponent } from "@/types/grid";

import { getAllCollisions } from "./editorGrid";
import { deepClone } from "@/composables/dataHelper";

/**
 * Editor state and refs the drag logic reads and writes but does not own. They
 * are threaded in so the drag concern can live in its own module while still
 * sharing the page/grid model with the rest of the editor composable.
 *
 * `saveableItem` and `preventCollision` are shared with the CRUD code (drag
 * writes them, CRUD reads/writes them), so they stay refs owned outside the
 * per-function scope.
 */
export interface EditorDragContext {
  pages: Ref<ActivityUserInterfacePage[]>;
  activePage: Ref<number>;
  layouts: Ref<ActivityUserInterfaceGridItem[][]>;
  dragAreas: Ref<Record<string, GridLayoutComponent>>;
  gridItems: Ref<Record<string, GridItemComponent>>;
  saveableItem: Ref<boolean>;
  savePage: (pageIndex: number, skipActivitySetting?: boolean) => Promise<void>;
  addUiPage: () => Promise<void>;
  startWidgetEditAt: (
    page: number,
    index: number,
    element: ActivityUserInterfaceItem,
    widgetLeft: number,
  ) => void;
}

/**
 * Drag-and-drop and grid-move behaviour for the page editor: dragging a new
 * widget onto the grid (`prototypeDrag`/`prototypeDragEnd`), tap-to-add
 * (`prototypeAdd`), and the native grid move/collision handling
 * (`onGridMove`/`onGridNativeMove`).
 *
 * Carved out of `useEditorKeyboardEvents`. It owns the drag-only state
 * (pointer position, the in-flight drop placeholder, collision guards) and
 * registers the `dragover` listener; the shared page/grid refs come from the
 * context so behaviour is unchanged.
 */
export function useEditorDrag(ctx: EditorDragContext) {
  const {
    pages,
    activePage,
    layouts,
    dragAreas,
    gridItems,
    saveableItem,
    savePage,
    addUiPage,
    startWidgetEditAt,
  } = ctx;

  const preventCollision = ref(true);
  const isGridItemDragging = ref(false);
  const activeGridItem = ref({ id: "", x: -1, y: -1 });
  const preventedActiveGridItem = ref({ id: "", x: -1, y: -1 });
  const isCheckingGrid = ref(false);

  const actualItems = ref();

  const mouseXY = { x: 0, y: 0 };
  const DragPos = { x: 0, y: 0, w: 1, h: 1, i: "drop" };
  let creatingPage = false;

  watch(isGridItemDragging, (val) => {
    if (val) {
      actualItems.value = JSON.parse(
        JSON.stringify(pages.value[activePage.value].items),
      );
    }
  });

  function getGridSize() {
    return {
      width: pages.value[activePage.value].grid.width,
      height: pages.value[activePage.value].grid.height,
    };
  }

  function getGridItemSize() {
    return {
      width: 224 / pages.value[activePage.value].grid.width,
      height: 336 / pages.value[activePage.value].grid.height,
    };
  }

  async function changeToNextEmptyPage() {
    let next = null;
    for (let i = activePage.value; i < pages.value.length; i++) {
      if (!pages.value[i].items.length) {
        next = i;
        break;
      }
    }
    if (next !== null) {
      activePage.value = next;
      return;
    }
    if (creatingPage) {
      return;
    }
    creatingPage = true;
    await addUiPage();
    creatingPage = false;
  }

  async function prototypeDrag(
    e: DragEvent,
    element: ActivityUserInterfaceItem,
  ) {
    if (
      element.type === "numpad" &&
      layouts.value[activePage.value].length > 0
    ) {
      await changeToNextEmptyPage();
      return;
    }

    const pageId = pages.value[activePage.value].page_id;
    const dragArea = dragAreas.value[pageId];
    const parentRect = dragArea.$el.getBoundingClientRect();
    const mouseInGrid =
      mouseXY.x > parentRect.left &&
      mouseXY.x < parentRect.right &&
      mouseXY.y > parentRect.top &&
      mouseXY.y < parentRect.bottom;
    const layout = layouts.value[activePage.value];
    const index = layout.findIndex((item) => {
      return item.i === "drop";
    });
    if (mouseInGrid && index === -1) {
      const gridItem = {
        x: (layouts.value[activePage.value].length * 2) % 4,
        y: layouts.value[activePage.value].length + 4,
        w: 1,
        h: 1,
        i: "drop",
        item: element,
      };
      if (element.type === "numpad") {
        gridItem.x = 0;
        gridItem.y = 0;
      }
      layouts.value[activePage.value].push(gridItem);
      try {
        gridItems.value[pageId + ":" + (layout.length - 1)].$el.style.display =
          "none";
      } catch {
        // grid item ref may not be mounted yet; hiding it is best-effort
      }
    }
    if (index === -1) {
      return;
    }

    const key = pageId + ":" + index;
    try {
      gridItems.value[key].$el.style.display = "none";
    } catch {
      // grid item ref may not be mounted yet; hiding it is best-effort
    }

    const el = gridItems.value[key];
    el.$el.dragging = {
      top: mouseXY.y - parentRect.top,
      left: mouseXY.x - parentRect.left,
    };
    const new_pos = el.calcXY(
      mouseXY.y - parentRect.top,
      mouseXY.x - parentRect.left,
    );
    if (mouseInGrid) {
      dragAreas.value[pageId].dragEvent(
        "dragstart",
        "drop",
        new_pos.x,
        new_pos.y,
        1,
        1,
      );
      DragPos.i = String(index);
      if (element.type === "numpad") {
        DragPos.x = 0;
        DragPos.y = 0;
      } else {
        DragPos.x = layout[index].x;
        DragPos.y = layout[index].y;
      }
    } else {
      dragAreas.value[pageId].dragEvent(
        "dragend",
        "drop",
        new_pos.x,
        new_pos.y,
        1,
        1,
      );
      layouts.value[activePage.value] = layouts.value[activePage.value].filter(
        (obj) => {
          return obj.i !== "drop";
        },
      );
    }
  }

  async function prototypeDragEnd(
    e: DragEvent,
    element: ActivityUserInterfaceItem,
  ) {
    const pageId = pages.value[activePage.value].page_id;
    const dragArea = dragAreas.value[pageId];
    const parentRect = dragArea.$el.getBoundingClientRect();
    const mouseInGrid =
      mouseXY.x > parentRect.left &&
      mouseXY.x < parentRect.right &&
      mouseXY.y > parentRect.top &&
      mouseXY.y < parentRect.bottom;
    saveableItem.value =
      element.type === "media_player" ||
      element.type === "sensor" ||
      element.type === "select"
        ? false
        : true;
    if (mouseInGrid) {
      console.info(
        `Dropped element props:\n${JSON.stringify(
          DragPos,
          ["x", "y", "w", "h"],
          2,
        )}`,
      );
      pages.value[activePage.value].items.push({
        ...element,
        location: {
          x: DragPos.x,
          y: DragPos.y,
        },
      });
      dragAreas.value[pageId].dragEvent(
        "dragend",
        "drop",
        DragPos.x,
        DragPos.y,
        1,
        1,
      );
      layouts.value[activePage.value] = layouts.value[activePage.value].filter(
        (obj) => {
          return obj.i !== "drop";
        },
      );
      layouts.value[activePage.value].push({
        x: DragPos.x,
        y: DragPos.y,
        w: 1,
        h: 1,
        i: DragPos.i,
        item: element,
      });
      dragAreas.value[pageId].dragEvent(
        "dragend",
        DragPos.i,
        DragPos.x,
        DragPos.y,
        1,
        1,
      );
      try {
        Object.keys(gridItems.value).forEach((key) => {
          gridItems.value[key].$el.style.display = "block";
        });
      } catch (err) {
        console.error(err);
      }

      if (saveableItem.value) {
        await savePage(activePage.value);
      }

      const items = pages.value[activePage.value].items;
      const itemIndex = items.length - 1;
      const gridItemSize = getGridItemSize();
      startWidgetEditAt(
        activePage.value,
        itemIndex,
        items[itemIndex],
        parentRect.x + DragPos.x * gridItemSize.width,
      );
    }
  }

  async function prototypeAdd(
    ev: PointerEvent | MouseEvent,
    element: ActivityUserInterfaceItem,
  ) {
    const pageId = pages.value[activePage.value].page_id;
    const dragArea = dragAreas.value[pageId];
    const parentRect = dragArea.$el.getBoundingClientRect();
    const gridItem = {
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      i: "drop",
      item: element,
    };
    const gridSize = getGridSize();
    saveableItem.value =
      element.type === "media_player" ||
      element.type === "sensor" ||
      element.type === "select"
        ? false
        : true;
    findLoop: for (let y = 0; y < gridSize.height; y++) {
      for (let x = 0; x < gridSize.width; x++) {
        const item = {
          ...gridItem,
          x,
          y,
        };
        const collides = getAllCollisions(
          layouts.value[activePage.value],
          item,
        );
        if (!collides.length) {
          gridItem.x = x;
          gridItem.y = y;
          break findLoop;
        }
      }
    }

    pages.value[activePage.value].items.push({
      ...element,
      location: {
        x: gridItem.x,
        y: gridItem.y,
      },
    });
    layouts.value[activePage.value].push(gridItem);

    if (saveableItem.value) {
      await savePage(activePage.value);
    }

    const items = pages.value[activePage.value].items;
    const itemIndex = items.length - 1;
    const gridItemSize = getGridItemSize();
    startWidgetEditAt(
      activePage.value,
      itemIndex,
      items[itemIndex],
      parentRect.x + gridItem.x * gridItemSize.width,
    );
  }

  function onDragOver(e: DragEvent) {
    mouseXY.x = e.clientX;
    mouseXY.y = e.clientY;
  }

  async function onGridMove(id: string, newX: number, newY: number) {
    activeGridItem.value = {
      id: id,
      x: newX,
      y: newY,
    };

    if (
      preventCollision.value &&
      JSON.stringify(preventedActiveGridItem.value) !=
        JSON.stringify(activeGridItem.value)
    ) {
      preventCollision.value = false;
    }
  }

  function onGridNativeMove() {
    if (
      !isGridItemDragging.value ||
      isCheckingGrid.value ||
      preventCollision.value
    )
      return;
    isCheckingGrid.value = true;

    const pageIndex = activePage.value;
    const gridHeight = pages.value[pageIndex]?.grid?.height ?? 0;

    const doRevert = layouts.value[pageIndex].some((item) => {
      if (item.y + item.h > gridHeight) {
        return true;
      }
      return false;
    });
    if (
      doRevert &&
      JSON.stringify(layouts.value[pageIndex]) !=
        JSON.stringify(actualItems.value)
    ) {
      preventedActiveGridItem.value = activeGridItem.value;
      layouts.value[pageIndex] = deepClone(actualItems.value);
      preventCollision.value = true;
    }

    actualItems.value = deepClone(layouts.value[pageIndex]);
    isCheckingGrid.value = false;
  }

  onMounted(() => {
    document.addEventListener("dragover", onDragOver, false);
  });

  onUnmounted(() => {
    document.removeEventListener("dragover", onDragOver, false);
  });

  return {
    preventCollision,
    isGridItemDragging,
    prototypeDrag,
    prototypeDragEnd,
    prototypeAdd,
    onGridMove,
    onGridNativeMove,
    // Drag-internal state — the editor composable ignores these; they are
    // exposed so the collision/revert behaviour can be unit-tested.
    activeGridItem,
    preventedActiveGridItem,
    isCheckingGrid,
    actualItems,
  };
}
