import { ref, onMounted, onUnmounted } from "vue";

import type { ComponentPublicInstance } from "vue";
import type {
  ActivityUserInterfaceGridItem,
  ActivityUserInterfacePage,
} from "@/types/activity";
import type { GridLayoutComponent, GridItemComponent } from "@/types/grid";

import type { TFunction } from "i18next";

import {
  collides,
  getAllCollisions,
  validateChange,
  buildLayout,
  getButtonSize,
} from "./editorGrid";
import { useItemSelection } from "./editorSelection";
import { useEditorPopups } from "./editorPopups";
import { useEditorDrag } from "./editorDrag";
import { useEditorCrud } from "./editorCrud";

// Pure grid math lives in ./editorGrid; re-exported here for existing consumers
// (and the composable delegates to it below).
export { collides, getAllCollisions, validateChange };

export function useEditorKeyboardEvents(
  t: TFunction,
  addUiPage: () => Promise<void> = async () => {},
  savePage: (
    pageIndex: number,
    skipActivitySetting?: boolean,
  ) => Promise<void> = async () => {},
  setLayouts: () => Promise<void> = async () => {},
) {
  const dragAreas = ref<Record<string, GridLayoutComponent>>({});
  const gridItems = ref<Record<string, GridItemComponent>>({});
  const layouts = ref<ActivityUserInterfaceGridItem[][]>([]);
  const { selectedItems, toggleItemSelect, itemSelected } = useItemSelection();

  const pages = ref<ActivityUserInterfacePage[]>([]);
  const activePage = ref(0);

  const {
    editButton,
    editButtonCoord,
    editPhysicalButton,
    physicalPopupOpen,
    editTouchSlider,
    popupLeft,
    closeButtonEdit,
    startButtonEdit,
    startWidgetEditAt,
    startPhysicalButtonEdit,
    startTouchSliderEdit,
    updatePhysicalButtonEdit,
    onPhysicalPopupAfterLeave,
  } = useEditorPopups();

  // Shared with the drag code (which sets it) and read by the CRUD code below.
  const saveableItem = ref(true);

  const mediaPlayerMinHeight = ref(225);

  const {
    preventCollision,
    isGridItemDragging,
    prototypeDrag,
    prototypeDragEnd,
    prototypeAdd,
    onGridMove,
    onGridNativeMove,
  } = useEditorDrag({
    pages,
    activePage,
    layouts,
    dragAreas,
    gridItems,
    saveableItem,
    savePage,
    addUiPage,
    startWidgetEditAt,
  });

  const {
    newItemLocation,
    getPageIndexById,
    validateComponent,
    isAddWidgetProgress,
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
  } = useEditorCrud({
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
  });

  function registerDragArea(
    pageId: string,
    el: Element | ComponentPublicInstance,
  ) {
    dragAreas.value[pageId] = el as GridLayoutComponent;
  }

  function registerGridItem(
    pageId: string,
    index: number,
    el: Element | ComponentPublicInstance,
  ) {
    gridItems.value[pageId + ":" + index] = el as GridItemComponent;
  }

  function onKeyup(event: KeyboardEvent) {
    if (event.code === "Escape") {
      closeButtonEdit();
      validateComponent();
    }
  }

  function onClick(event: MouseEvent) {
    if (!editPhysicalButton.value && !editTouchSlider.value) {
      return;
    }

    // It's ignored in case of widget edit
    if (editButton.value) {
      return;
    }

    const path = (event.composedPath() as HTMLElement[]) || [];

    const buttonEditClose = path.find((el) => {
      return el.classList && el.classList.contains("edit-button-li__close");
    });

    const buttonEditBg = path.find((el) => {
      return el.classList && el.classList.contains("edit-button-li-bg");
    });

    const buttonEditWrapper = path[0].classList.contains(
      "edit-button-li-wrapper",
    );

    if (
      (editPhysicalButton.value || editTouchSlider.value) &&
      (buttonEditClose || buttonEditBg || buttonEditWrapper)
    ) {
      closeButtonEdit();
      validateComponent();
    }
  }

  function setMediaPlayerMinHeight(minHeight: number) {
    mediaPlayerMinHeight.value = minHeight;
  }

  onMounted(() => {
    document.addEventListener("keyup", onKeyup);
    document.addEventListener("click", onClick);
  });

  onUnmounted(() => {
    document.removeEventListener("keyup", onKeyup);
    document.removeEventListener("click", onClick);
  });

  return {
    dragAreas,
    gridItems,
    registerDragArea,
    registerGridItem,

    pages,
    activePage,
    layouts,
    selectedItems,
    editButton,
    editButtonCoord,
    editPhysicalButton,
    physicalPopupOpen,
    editTouchSlider,
    popupLeft,
    newItemLocation,
    mediaPlayerMinHeight,
    setMediaPlayerMinHeight,
    closeButtonEdit,
    startPhysicalButtonEdit,
    startTouchSliderEdit,
    onPhysicalPopupAfterLeave,
    toggleItemSelect,
    itemSelected,
    startButtonEdit,
    movedGridItem,
    resizedGridItem,
    addGridItem,
    testWidgetPlacing,
    updateGridItem,
    updatePhysicalButtonEdit,
    deleteGridItem,
    deleteGridItems,
    pasteGridItems,
    collectGridItems,
    buildLayout,
    getEmptyCells,
    isActivePageFull,
    preventCollision,
    isGridItemDragging,
    onGridMove,
    onGridNativeMove,

    getPageIndexById,
    prototypeDrag,
    prototypeDragEnd,
    prototypeAdd,
    getButtonSize,
    getEmptyItemStyle,
    resetNewItemMeta,
    isAddWidgetProgress,
  };
}
