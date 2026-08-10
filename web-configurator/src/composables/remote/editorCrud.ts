import { ref } from "vue";

import type { Ref } from "vue";
import type {
  ActivityUserInterfaceGridItem,
  ActivityUserInterfaceItem,
  ActivityUserInterfacePage,
} from "@/types/activity";
import type { PageItemIndex } from "@/types/grid";
import type { FlashMessageData } from "@/types/flashMessages";

import type { TFunction } from "i18next";

import { useTiming } from "@/composables/timing";
import { addErrorBottom } from "@/stores/messages";

import {
  offTheGrid,
  isOccupiedSpace as isOccupiedSpaceOnPage,
  getEmptyItemStyle as buildEmptyItemStyle,
} from "./editorGrid";
import { deepClone } from "@/composables/dataHelper";

const { sleep } = useTiming();

/**
 * Editor state and callbacks the CRUD logic reads and writes but does not own.
 * They are threaded in so the widget create/update/delete/move concern can live
 * in its own module while still sharing the page/grid model with the rest of
 * the editor composable.
 *
 * `saveableItem` and `preventCollision` are shared with the drag code (drag
 * writes them, the CRUD code reads/writes them); `editButton`/`editButtonCoord`
 * and `closeButtonEdit` come from the popup composable.
 */
export interface EditorCrudContext {
  t: TFunction;
  pages: Ref<ActivityUserInterfacePage[]>;
  activePage: Ref<number>;
  layouts: Ref<ActivityUserInterfaceGridItem[][]>;
  saveableItem: Ref<boolean>;
  preventCollision: Ref<boolean>;
  editButton: Ref<ActivityUserInterfaceItem | null>;
  editButtonCoord: Ref<{ page: number; index: number } | null>;
  closeButtonEdit: () => void;
  savePage: (pageIndex: number, skipActivitySetting?: boolean) => Promise<void>;
  setLayouts: () => Promise<void>;
}

/**
 * Widget CRUD for the page editor: placing new widgets (`addGridItem`), editing
 * (`updateGridItem`), deleting one or many (`deleteGridItem`/`deleteGridItems`),
 * copy/paste (`pasteGridItems`/`collectGridItems`), the drag-move/resize commit
 * paths (`movedGridItem`/`resizedGridItem`), and the occupancy/empty-cell
 * scanning helpers.
 *
 * Carved out of `useEditorKeyboardEvents`. It owns the pending-new-item state
 * (`newItemCoord`/`newItemLocation`); the shared page/grid refs, the shared
 * save-gate (`saveableItem`) and collision guard (`preventCollision`), the
 * popup edit refs, and the save/relayout callbacks come from the context so
 * behaviour is unchanged.
 */
export function useEditorCrud(ctx: EditorCrudContext) {
  const {
    t,
    pages,
    activePage,
    layouts,
    saveableItem,
    preventCollision,
    editButton,
    editButtonCoord,
    closeButtonEdit,
    savePage,
    setLayouts,
  } = ctx;

  const newItemCoord = ref<{ page: number; index: number } | null>(null);
  const newItemLocation = ref<{ x: number; y: number } | null>(null);

  function getPageIndexById(pageId: string): number {
    return pages.value.findIndex((item) => {
      return item.page_id === pageId;
    });
  }

  function validateComponent() {
    if (saveableItem.value == false) {
      pages.value[activePage.value].items.pop();
      layouts.value[activePage.value].pop();
      saveableItem.value = true;
    }
  }

  function isAddWidgetProgress() {
    return newItemCoord.value != null;
  }

  function isOccupiedSpace(
    x: number,
    y: number,
    width: number,
    height: number,
    pageIndex = -1,
  ) {
    const actPage = pageIndex > -1 ? pageIndex : activePage.value;
    return isOccupiedSpaceOnPage(pages.value[actPage], x, y, width, height);
  }

  async function addGridItem(item: ActivityUserInterfaceItem) {
    const newItem = deepClone(item);
    let placed = false;
    const { width, height } = newItem.size;

    if (newItemLocation.value != null) {
      if (
        !isOccupiedSpace(
          newItemLocation.value.x,
          newItemLocation.value.y,
          width,
          height,
        )
      ) {
        newItem.location.x = newItemLocation.value.x;
        newItem.location.y = newItemLocation.value.y;
        pages.value[activePage.value].items.push(newItem);
        placed = true;
      }
    } else {
      for (
        let y = 0;
        y <= pages.value[activePage.value].grid.height - height;
        y++
      ) {
        for (
          let x = 0;
          x <= pages.value[activePage.value].grid.width - width;
          x++
        ) {
          if (!isOccupiedSpace(x, y, width, height)) {
            newItem.location.x = x;
            newItem.location.y = y;
            pages.value[activePage.value].items.push(newItem);
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
    }

    if (!placed) {
      throw new Error(t("widget.error.no_position"));
    }

    newItemCoord.value = {
      page: activePage.value,
      index: pages.value[activePage.value].items.length - 1,
    };
    await savePage(activePage.value);
  }

  function testWidgetPlacing(item: ActivityUserInterfaceItem) {
    if (
      !pages.value[activePage.value] ||
      !pages.value[activePage.value].grid ||
      !pages.value[activePage.value].grid.height
    ) {
      return false;
    }

    let placed = false;
    const { width, height } = item.size;

    for (
      let y = 0;
      y <= pages.value[activePage.value].grid.height - height;
      y++
    ) {
      for (
        let x = 0;
        x <= pages.value[activePage.value].grid.width - width;
        x++
      ) {
        if (!isOccupiedSpace(x, y, width, height)) {
          placed = true;
          break;
        }
      }
      if (placed) break;
    }

    return placed;
  }

  /**
   * Save the given page and surface a failure to the user as a flash message.
   *
   * Used by call sites that are triggered directly from template event
   * handlers, where a rejected promise would otherwise go unhandled.
   */
  async function trySavePage(pageIndex: number) {
    try {
      await savePage(pageIndex);
    } catch (e) {
      addErrorBottom(e as FlashMessageData | string);
    }
  }

  async function updateGridItem(newValues: ActivityUserInterfaceItem) {
    const { page, index } =
      (editButtonCoord.value as {
        page: number;
        index: number;
      }) || newItemCoord.value;

    const item = {
      ...pages.value[page].items[index],
      type: newValues.type,
      size: newValues.size,
      ...(newValues.command && { command: newValues.command }),
      ...(newValues.media_player_id && {
        media_player_id: newValues.media_player_id,
      }),
      ...(newValues.sensor && { sensor: newValues.sensor }),
      ...(newValues.select && { select: newValues.select }),
    };

    if (newValues.type === "text") {
      item.text = newValues.text;

      if (item.icon) {
        delete item.icon;
      }
    }

    if (newValues.type === "icon") {
      item.icon = newValues.icon;

      if (item.text) {
        delete item.text;
      }
    }

    if (newValues.type === "sensor" || newValues.type === "select") {
      item.text = newValues.text;

      if (!newValues.text || newValues.text.length < 1) {
        delete item.text;
      }
    }

    // If component is not (mediaplayer, sensor and select) OR is mediaplayer and has id it can be saveable OR is sensor and has id OR is select and has id it can be saveable
    if (
      newValues.type !== "media_player" &&
      newValues.type !== "sensor" &&
      newValues.type !== "select"
    ) {
      saveableItem.value = true;
    } else if (
      newValues.type === "media_player" &&
      newValues.media_player_id &&
      newValues.media_player_id.length > 0
    ) {
      saveableItem.value = true;
    } else if (
      newValues.type === "sensor" &&
      newValues.sensor?.sensor_id &&
      newValues.sensor?.sensor_id.length > 0
    ) {
      saveableItem.value = true;
    } else if (
      newValues.type === "select" &&
      newValues.select?.select_id &&
      newValues.select?.select_id.length > 0
    ) {
      saveableItem.value = true;
    }

    pages.value[page].items[index] = item;

    if (isAddWidgetProgress() == false) {
      editButton.value = item;
    }

    if (saveableItem.value) {
      await trySavePage(page);
    }
  }

  async function deleteGridItem() {
    if (!editButton.value) {
      return;
    }
    const { page, index } = editButtonCoord.value as {
      page: number;
      index: number;
    };
    pages.value[page].items.splice(index, 1);
    closeButtonEdit();
    await trySavePage(page);
  }

  async function deleteGridItems(itemsToDelete: PageItemIndex[]) {
    const deleteMap = new Map();
    itemsToDelete.forEach(({ pageIndex, itemIndex }) => {
      if (!deleteMap.has(pageIndex)) {
        deleteMap.set(pageIndex, new Set());
      }
      deleteMap.get(pageIndex).add(itemIndex);
    });

    deleteMap.forEach((indices, pageIndex) => {
      pages.value[pageIndex].items = pages.value[pageIndex].items.filter(
        (_, index) => !indices.has(index),
      );
    });

    const pageIndices = Array.from(deleteMap.keys());

    for (let i = 0; i < pageIndices.length; i++) {
      await savePage(pageIndices[i], true);
    }
  }

  async function pasteGridItems(itemsToPaste: ActivityUserInterfaceItem[]) {
    const newItems = deepClone(itemsToPaste);

    for (const [index, newObject] of newItems.entries()) {
      let { x, y } = deepClone(newObject.location);
      const { width = 1, height = 1 } = newObject.size ?? {};

      if (newItemLocation.value != null) {
        if (index == 0) {
          x = newItemLocation.value.x;
          y = newItemLocation.value.y;
        } else {
          x = newItemLocation.value.x + (x - newItems[0].location.x);
          y = newItemLocation.value.y + (y - newItems[0].location.y);
        }
      }

      if (isOccupiedSpace(x, y, width, height)) {
        throw new Error(t("widget.error.no_position"));
      }
    }

    for (const [index, newObject] of newItems.entries()) {
      const newObj = deepClone(newObject);

      if (newItemLocation.value != null) {
        if (index == 0) {
          newObj.location.x = newItemLocation.value.x;
          newObj.location.y = newItemLocation.value.y;
        } else {
          newObj.location.x =
            newItemLocation.value.x +
            (newObj.location.x - newItems[0].location.x);
          newObj.location.y =
            newItemLocation.value.y +
            (newObj.location.y - newItems[0].location.y);
        }
      }

      pages.value[activePage.value].items.push(newObj);
    }

    await savePage(activePage.value);
  }

  function collectGridItems(itemsToCollect: PageItemIndex[]) {
    const collectedItems = [];

    for (let i = 0; i < itemsToCollect.length; i++) {
      const { pageIndex, itemIndex } = itemsToCollect[i];

      if (
        pages.value[pageIndex] &&
        pages.value[pageIndex].items[itemIndex] !== undefined
      ) {
        collectedItems.push(pages.value[pageIndex].items[itemIndex]);
      }
    }

    collectedItems.sort((a, b) => {
      if (a.location.x === b.location.x) {
        return a.location.y - b.location.y;
      }
      return a.location.x - b.location.x;
    });

    return collectedItems;
  }

  async function movedGridItem(
    pageId: string,
    newLayout: ActivityUserInterfaceGridItem[],
    maxHeight: number,
  ) {
    const pageIndex = getPageIndexById(pageId);
    const outHeight = offTheGrid(newLayout, pages.value[pageIndex].grid.height);

    if (outHeight > maxHeight) {
      await sleep(50);
      void setLayouts();
      return;
    }

    if (outHeight > -1) {
      pages.value[pageIndex].grid.height = outHeight;
    }

    for (const entry of newLayout) {
      // Each layout entry carries the item index in `i`: don't rely on order
      const itemIndex = Number(entry.i);
      if (Number.isNaN(itemIndex)) {
        continue;
      }
      pages.value[pageIndex].items[itemIndex] = {
        ...pages.value[pageIndex].items[itemIndex],
        location: {
          x: entry.x,
          y: entry.y,
        },
      };
    }

    preventCollision.value = true;
    await trySavePage(pageIndex);
  }

  async function resizedGridItem(
    pageId: string,
    newLayout: ActivityUserInterfaceGridItem[],
    maxHeight: number,
  ) {
    const pageIndex = getPageIndexById(pageId);
    const outHeight = offTheGrid(newLayout, pages.value[pageIndex].grid.height);

    if (outHeight > maxHeight) {
      await sleep(50);
      void setLayouts();
      return;
    }

    if (outHeight > -1) {
      pages.value[pageIndex].grid.height = outHeight;
    }

    for (const entry of newLayout) {
      // Each layout entry carries the item index in `i`: don't rely on order
      const itemIndex = Number(entry.i);
      if (Number.isNaN(itemIndex)) {
        continue;
      }
      pages.value[pageIndex].items[itemIndex] = {
        ...pages.value[pageIndex].items[itemIndex],
        size: {
          width: entry.w,
          height: entry.h,
        },
        location: {
          x: entry.x,
          y: entry.y,
        },
      };
    }

    await trySavePage(pageIndex);
  }

  function isActivePageFull(): boolean {
    const page = pages.value[activePage.value];
    const gridWidth = page.grid.width;
    const gridHeight = page.grid.height;

    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        if (!isOccupiedSpace(x, y, 1, 1)) {
          return false;
        }
      }
    }

    return true;
  }

  function getEmptyCells(): {
    [pageIndex: number]: { x: number; y: number }[];
  } {
    const emptyCells: { [pageIndex: number]: { x: number; y: number }[] } = {};

    for (let pageIndex = 0; pageIndex < pages.value.length; pageIndex++) {
      const page = pages.value[pageIndex];
      const gridWidth = page.grid.width;
      const gridHeight = page.grid.height;

      const emptyCs: { x: number; y: number }[] = [];

      for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
          if (!isOccupiedSpace(x, y, 1, 1, pageIndex)) {
            emptyCs.push({ x, y });
          }
        }
      }

      emptyCells[pageIndex] = emptyCs;
    }

    return emptyCells;
  }

  function getEmptyItemStyle(x: number, y: number, pageInd: number) {
    return buildEmptyItemStyle(pages.value[pageInd].grid, x, y);
  }

  function resetNewItemMeta() {
    newItemCoord.value = null;
    newItemLocation.value = null;
  }

  return {
    newItemLocation,
    getPageIndexById,
    validateComponent,
    isAddWidgetProgress,
    isOccupiedSpace,
    addGridItem,
    testWidgetPlacing,
    updateGridItem,
    deleteGridItem,
    deleteGridItems,
    pasteGridItems,
    collectGridItems,
    movedGridItem,
    resizedGridItem,
    isActivePageFull,
    getEmptyCells,
    getEmptyItemStyle,
    resetNewItemMeta,
  };
}
