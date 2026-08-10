<script setup lang="ts">
import { ref, watch, computed, onMounted, useTemplateRef } from "vue";
import { useElementSize } from "@vueuse/core";
import { useTranslation } from "i18next-vue";
import { FlashMessageInfoStatus } from "@/types/enums";
import type { TabItem } from "@/types/ui";

interface SelectOption {
  label: string;
  value: string;
}

// Types
import type { ComponentPublicInstance } from "vue";
import type {
  ActivityUserInterfaceItem,
  ActivityUserInterfacePage,
  DeviceButton,
} from "@/types/activity";

import type { Remote } from "@/types/remote";

import { appStateStore } from "@/stores/appState";
import { systemBaseStore } from "@/stores/systemBase";
import { configStore } from "@/stores/config";
import { addInfoFull, addErrorBottom } from "@/stores/messages";
import { remotesStore } from "@/stores/remotes";

// Mixins
import { getComponent } from "@/composables/components";
import { asError } from "@/composables/error";
import {
  useEditorKeyboardEvents,
  validateChange,
} from "@/composables/remote/editor";
import translatedProperty from "@/composables/translatedProperty";
import { useTiming } from "@/composables/timing";
import { useWindowDimension } from "@/composables/windowDimension";
import { useRemoteProperties } from "@/composables/remote/properties";
import { deepClone, useDataHelper } from "@/composables/dataHelper";

// Utils
import { adjustWidgetHeights, adjustWidgetWidths } from "@/utils/remoteUtils";

// Components
import { Carousel, Slide, Pagination } from "vue3-carousel";
import "vue3-carousel/carousel.css";
import { GridLayout, GridItem } from "grid-layout-plus";
import UCSelect from "@/components/ui/UCSelect.vue";
import GridItemEdit from "@/components/ui/GridItemEdit.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import AddWidget from "@/components/elements/widget/AddWidget.vue";
import GridSize from "@/components/ui/GridSize.vue";
import RemoteButtonLayout from "@/components/remote-controller/RemoteButtonLayout.vue";
import TabMenu from "@/components/ui/TabMenu.vue";

// Props
const { t } = useTranslation();
const { sleep } = useTiming();
const { isSmallScreen } = useWindowDimension();
const { getDeviceColor, getRemotControllerClasses } = useRemoteProperties();
const { isNonEmptyObject } = useDataHelper();

const props = defineProps({
  remote: {
    type: Object,
    required: true,
  },
  editButtonMapping: {
    type: Boolean,
    default: false,
  },
  highlightedRemoteButton: {
    type: Object,
    default: () => ({}),
  },
});

const defaultActionTabItem = { value: "move" };

// computed, not a plain array: t() only re-runs on a language change when it is
// read inside a tracked scope.
const actionTabItems = computed(() => [
  {
    label: t("ui.move"),
    value: "move",
  },
  {
    label: t("ui.edit"),
    value: "edit",
  },
  {
    label: t("ui.select"),
    value: "select",
  },
]);

const appState = appStateStore();
const systemBase = systemBaseStore();
const config = configStore();
const storage = remotesStore();

const activeActionTab = ref<TabItem>(defaultActionTabItem);
const currentRemote = ref<Remote | null>(null);
const icon = ref("");
const elAddWidget =
  useTemplateRef<InstanceType<typeof AddWidget>>("elAddWidget");
const values = ref(getRemoteFormValues());

const {
  registerDragArea,
  registerGridItem,

  pages,
  activePage,
  layouts,
  selectedItems,
  editButton,
  editButtonCoord,
  popupLeft,
  newItemLocation,
  mediaPlayerMinHeight,
  setMediaPlayerMinHeight,
  startButtonEdit,
  closeButtonEdit,
  toggleItemSelect,
  itemSelected,
  movedGridItem,
  resizedGridItem,
  addGridItem,
  testWidgetPlacing,
  updateGridItem,
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

  getButtonSize,
  getEmptyItemStyle,
  resetNewItemMeta,
  isAddWidgetProgress,
} = useEditorKeyboardEvents(t, addUiPage, savePage, setLayouts);
const buttonLayouts = ref<DeviceButton[]>([]);
const updateButtonLayout = ref(1);

const emptyCellLayout = ref<{
  [pageIndex: number]: { x: number; y: number }[];
}>([]);

/**
 * Pixel size of the page grid, measured rather than assumed.
 *
 * CSS owns this box — the device frame, its display, and the page's own padding
 * all feed into it — so a hardcoded per-model size went stale whenever any of
 * that moved (most recently when a vue3-carousel upgrade freed up the strip the
 * pagination used to occupy), and it could follow neither a breakpoint nor a
 * window resize. All slides render the same box, so measuring one is enough.
 */
const pageContentEls = useTemplateRef<HTMLElement[]>("elPageContent");
const { width: gridWidth, height: gridHeight } = useElementSize(
  computed(() => pageContentEls.value?.[0] ?? null),
);

// A media widget may not be shorter than a quarter of the screen.
const gridDimensions = computed(() => ({
  width: gridWidth.value,
  height: gridHeight.value,
  widgetMeta: {
    mediaPlayerMinHeight: gridHeight.value / 4,
  },
}));

watch(gridHeight, (height) => setMediaPlayerMinHeight(height / 4), {
  immediate: true,
});

const minDimensions = ref<{ width: number; height: number }[]>([]);

const pageListUpdate = ref(1);
const activePageModel = ref<SelectOption>({ label: "", value: "" });

const isSecondModel = ref(false);
const deviceColor = ref("d");
const editable = ref(false);
const selectable = ref(false);

const deleting = ref(false);

const dialogDelete =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDelete");
const dialogDeleteItems =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDeleteItems");
const dialogReset =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogReset");

const loading = ref(true);
const displaySaving = ref(false);
const saving = ref(false);

const gridMaxHeight = ref(
  config.$state.list.screenLayout.grid.max.height || 12,
);

const elRemoteControllerDevice = useTemplateRef<HTMLDivElement>(
  "elRemoteControllerDevice",
);

defineExpose({
  setActivePageById,
  isSaving,
});

const emit = defineEmits(["addPage", "showPageList", "update", "itemDragging"]);

// Pushed to the parent rather than pulled from it: reading this off the
// component instance made the parent's render depend on the instance, so a
// child that failed to mount re-triggered that render on every retry and the
// page locked up in a re-mount loop.
watch(isGridItemDragging, (val) => emit("itemDragging", val));

watch(
  () => props.remote,
  () => {
    if (!deleting.value) {
      setRemote(props.remote as Remote);
    }
  },
);

watch(
  editButton,
  async (newValue, prevValue) => {
    if (!prevValue || !editButton.value || !editButtonCoord.value) {
      return;
    }
    const page = editButtonCoord.value.page;
    const index = editButtonCoord.value.index;
    pages.value[page].items[index] = editButton.value;
    await savePage(page);
  },
  // editButton is mutated in place by the button editor, so watch its contents
  // deeply to write each nested change back to the page and persist it.
  { deep: true },
);

watch(pages, () => {
  handlePageNames();

  if (pages.value[activePage.value]) {
    activePageModel.value = {
      label: pages.value[activePage.value].name ?? "",
      value: pages.value[activePage.value].page_id ?? "",
    };
  }
});

watch(activePage, (newVal, oldVal) => {
  if (newVal != oldVal) {
    selectedItems.value = [];
  }

  if (pages.value[activePage.value]) {
    activePageModel.value = {
      label: pages.value[activePage.value].name ?? "",
      value: pages.value[activePage.value].page_id ?? "",
    };
  }
});

const enableMediaWidget = computed(() => {
  const widgetWidth = pages.value[activePage.value]?.grid?.width;
  if (!widgetWidth) {
    return false;
  }

  const widgetHeight = Math.ceil(
    mediaPlayerMinHeight.value /
      (gridDimensions.value.height /
        pages.value[activePage.value]?.grid?.height),
  );
  const testItem = {
    size: { width: widgetWidth, height: widgetHeight },
    location: { x: 1, y: 1 },
    type: "media_player",
  } as ActivityUserInterfaceItem;

  return testWidgetPlacing(testItem);
});

const helperGridRows = computed(() => {
  const pgRows = [];
  for (let index = 0; index < pages.value.length; index++) {
    const arr = Array.from(
      { length: pages.value[index]?.grid?.height },
      (_, i) => i,
    );
    pgRows.push(arr);
  }
  return pgRows;
});

const helperGridCols = computed(() => {
  const pgCols = [];
  for (let index = 0; index < pages.value.length; index++) {
    const arr = Array.from(
      { length: pages.value[index]?.grid?.width },
      (_, i) => i,
    );
    pgCols.push(arr);
  }
  return pgCols;
});

const pageContentClasses = computed(() => {
  let classList = "";
  classList += selectable.value ? `ui-page__content--selectable ` : "";
  return classList;
});

async function getRemoteMeta() {
  let model = "";
  let systemInfo = null;

  try {
    model = await config.getDeviceModel();
  } catch (e) {
    addErrorBottom(e);
  }

  try {
    systemInfo = await systemBase.getSystemInfo();
  } catch (e) {
    console.error(e);
  }

  // The model only picks the frame; the grid it leaves is measured, not assumed.
  if (model?.toLowerCase() == "ucr2") {
    isSecondModel.value = true;
  } else {
    isSecondModel.value = false;

    if (systemInfo != null && systemInfo.serial_number) {
      deviceColor.value = getDeviceColor(systemInfo.serial_number);
    }
  }
}

const questionResetPage = computed(() => {
  return t("user_interface.pages.reset_page.question", {
    name:
      activePage.value != null && pages.value[activePage.value]
        ? pages.value[activePage.value].name
        : "",
  });
});

const pageListOptions = computed(() => {
  return pages.value.map((page) => ({
    label: page.name ?? "",
    value: page.page_id,
  }));
});

const toolsButtonsClasses = computed(() => {
  let classList = "";
  if (isSmallScreen.value) {
    classList += "button--secondary button--icon";
  } else {
    classList += "button--tertiary button--hybrid";
  }

  return classList;
});

function setActivePageById(id: string) {
  const actPage = pages.value.findIndex((obj) => obj.page_id === id);
  if (actPage > -1) {
    activePage.value = actPage;
  }
}

function getRemoteFormValues() {
  return {
    name: translatedProperty(currentRemote.value?.name),
    icon: currentRemote.value?.icon || "uc:remote",
  };
}

async function setLayouts() {
  layouts.value = (
    currentRemote.value?.options?.user_interface?.pages || []
  ).map((page) => {
    return buildLayout(page.items);
  });
}

function setRemote(newValue: Remote | undefined) {
  if (!newValue || !isNonEmptyObject(newValue)) {
    return false;
  }

  currentRemote.value = deepClone(newValue);
  values.value = getRemoteFormValues();
  pages.value = currentRemote.value?.options?.user_interface?.pages || [];
  setLayouts();
  icon.value = currentRemote.value?.icon || "";
  buttonLayouts.value = config.$state.list.buttonLayout[0]?.buttons || [];
  updateButtonLayout.value = updateButtonLayout.value * -1;
  handlePageNames();
  setMinDimensions();
  setEmptyCells();

  if (isAddWidgetProgress() == true) {
    const itemIndex = pages.value[activePage.value].items.length - 1;
    elAddWidget.value?.update(pages.value[activePage.value].items[itemIndex]);
  }
}

function handlePageNames() {
  for (const page of pages.value) {
    if (!page.name) {
      page.name = "New page";
    }
  }
}

function setMinDimensions() {
  const dimensions = [] as { width: number; height: number }[];
  for (let index = 0; index < pages.value.length; index++) {
    let minWidth = 1;
    let minHeight = 1;
    const pageItems = pages.value[index].items;

    for (let ind = 0; ind < pageItems.length; ind++) {
      const minPageHeight =
        pageItems[ind].location.y +
        (pageItems[ind].size && pageItems[ind].size.height
          ? pageItems[ind].size.height
          : 1);

      if (minPageHeight > minHeight) {
        minHeight = minPageHeight;
      }

      if (pageItems[ind].type != "media_player") {
        const minPageWidth =
          pageItems[ind].location.x +
          (pageItems[ind].size && pageItems[ind].size.width
            ? pageItems[ind].size.width
            : 1);

        if (minPageWidth > minWidth) {
          minWidth = minPageWidth;
        }
      }
    }

    dimensions.push({ width: minWidth, height: minHeight });
  }

  minDimensions.value = dimensions;
}

function setEmptyCells() {
  emptyCellLayout.value = getEmptyCells();
}

async function addUiPage() {
  if (!currentRemote.value) {
    return;
  }

  const oldIds = pages.value.map((item) => {
    return item.page_id;
  });
  const newItem = {
    name: "new page",
    items: [],
  };

  saving.value = true;
  try {
    const newValue = await storage.addUiPage(currentRemote.value, newItem);
    setRemote(newValue);
    emit("update");
  } catch (e) {
    setRemote(props.remote as Remote);
    addErrorBottom(e);
  }
  const newIndex = pages.value.findIndex((item) => {
    return !oldIds.includes(item.page_id);
  });
  activePage.value = Math.max(newIndex, 0);
  pageListUpdate.value++;
  saving.value = false;
}

const pageIsSaving: Record<number, boolean> = {};
async function savePage(pageIndex: number, skipRemoteSetting = false) {
  saving.value = true;
  if (pageIsSaving[pageIndex]) {
    return;
  }
  pageIsSaving[pageIndex] = true;
  layouts.value[pageIndex] = buildLayout(pages.value[pageIndex].items);

  try {
    const newValue = await storage.updateUiPage(
      props.remote.entity_id,
      pages.value[pageIndex],
    );
    if (!skipRemoteSetting) {
      setRemote(newValue);
    }
    emit("update");
  } catch (e) {
    if (elAddWidget.value?.isActive()) {
      elAddWidget.value?.closeModal();
    } else {
      closeButtonEdit();
    }
    setRemote(props.remote as Remote);
    addErrorBottom(
      e,
      "user_interface.pages.update",
      elRemoteControllerDevice.value ?? undefined,
    );
  }

  pageIsSaving[pageIndex] = false;
  await sleep(500);
  saving.value = false;
}

function validateButtonSize(newValues: ActivityUserInterfaceItem) {
  const { page, index } = editButtonCoord.value as {
    page: number;
    index: number;
  };
  return validateChange(pages.value[page].items, index, newValues);
}

// async function startEditPage(selected: ActivityUserInterfacePage) {
//   let index = -1;
//   if (selected) {
//     index = pages.value.findIndex((item) => {
//       return item.page_id === selected.page_id;
//     });
//   }

//   if (index !== -1) {
//     pageToEdit.value = pages.value[index];
//   } else {
//     pageToEdit.value = null;
//   }

//   await sleep(10);
//   activePage.value = index;
//   pageListUpdate.value = pageListUpdate.value * -1;
// }

function getPageRowHeight(rowNumber: number) {
  return gridDimensions.value.height / rowNumber;
}

async function deleteItems() {
  deleting.value = true;
  try {
    await deleteGridItems(selectedItems.value);
    resetSelectedItems();
    emit("update");
  } catch (e) {
    setRemote(props.remote as Remote);
    addErrorBottom(e);
  }
  deleting.value = false;
}

async function pasteItems() {
  const newPageItems = appState.$state.clipboard.remote.pageItems || [];

  if (!newPageItems) {
    return;
  }

  // Check commands availability
  const commandsIDsFromPage = (newPageItems ?? [])
    .map((item: ActivityUserInterfaceItem) => item.command?.cmd_id)
    .filter((id: string | undefined): id is string => !!id);

  const uniqueCommandsIDsFromPage = [
    ...new Set(commandsIDsFromPage),
  ] as string[];
  const includedCommandsIDs = (props.remote.options.simple_commands ?? []).map(
    (cmd: string) => cmd,
  );
  const missingCommandsIDs =
    uniqueCommandsIDsFromPage.filter(
      (id) => !includedCommandsIDs.includes(id),
    ) || [];

  const itemsToPaste = newPageItems.filter(
    (item: ActivityUserInterfaceItem) => {
      const cmdId = item.command?.cmd_id;
      return cmdId && !missingCommandsIDs.includes(cmdId);
    },
  );

  if (itemsToPaste.length > 0) {
    try {
      await pasteGridItems(itemsToPaste);
      appState.setClipboard([], "remote", "pageItems");

      if (newPageItems.length > itemsToPaste.length) {
        addErrorBottom(
          t("customise_remote.pages.paste.errors.not_fully_completed"),
        );
      }
    } catch (e) {
      const err = asError(e);
      if (err.message && typeof err.message == "string") {
        addErrorBottom(err.message);
      } else {
        addErrorBottom(e);
      }
    }
  } else {
    addErrorBottom(
      t("customise_remote.pages.paste.errors.no_available_command"),
    );
  }

  resetSelectedItems();
}

function copyGridItem() {
  if (!editButton.value) {
    return false;
  }

  const pgItems = new Array(editButton.value);
  appState.setClipboard(pgItems, "remote", "pageItems");
}

function copyItems() {
  const pgItems = collectGridItems(selectedItems.value);
  appState.setClipboard(pgItems, "remote", "pageItems");
  resetSelectedItems();
}

function resetSelectedItems() {
  selectedItems.value = [];
}

function startDeleteGridItem() {
  dialogDelete.value?.open();
}

function startDeleteItems() {
  dialogDeleteItems.value?.open();
}

function startResetPage() {
  dialogReset.value?.open();
}

async function resetPage() {
  if (activePage.value == null) {
    return false;
  }

  const pageToReset = pages.value[
    activePage.value
  ] as ActivityUserInterfacePage;

  if (!pageToReset) {
    return false;
  }

  addInfoFull(FlashMessageInfoStatus.SAVING);
  await sleep(1000);

  saving.value = true;
  try {
    await storage.updateUiPage(props.remote.entity_id, {
      ...pageToReset,
      items: [],
    });
    await storage.getRemote(props.remote.entity_id);
    addInfoFull(FlashMessageInfoStatus.SUCCESS);
    emit("update");
  } catch (e) {
    setRemote(props.remote as Remote);
    addErrorBottom(
      e,
      "user_interface.pages.update",
      elRemoteControllerDevice.value ?? undefined,
    );
  }
  saving.value = false;
}

async function saveDimensions(dimensions: { width: number; height: number }) {
  displaySaving.value = true;
  const oldGridWidth = pages.value[activePage.value].grid.width;
  const oldGridHeight = pages.value[activePage.value].grid.height;

  if (dimensions.width < oldGridWidth) {
    await updateWidgetWidths(dimensions.width);
  }

  pages.value[activePage.value].grid.width = dimensions.width;
  pages.value[activePage.value].grid.height = dimensions.height;

  await savePage(activePage.value);

  if (dimensions.width > oldGridWidth) {
    await updateWidgetWidths(dimensions.width);
  }

  if (dimensions.height > oldGridHeight) {
    await updateWidgetHeights(dimensions.height);
  }

  displaySaving.value = false;
}

async function updateWidgetWidths(newWidth: number) {
  const pageItems = pages.value[activePage.value].items;
  const doSave = adjustWidgetWidths(pageItems, newWidth);

  doSave && (await savePage(activePage.value));
}

async function updateWidgetHeights(newHeight: number) {
  const pageItems = pages.value[activePage.value].items;
  const mediaMinHeight = Math.ceil(
    mediaPlayerMinHeight.value / (gridDimensions.value.height / newHeight),
  );
  const doSave = adjustWidgetHeights(pageItems, mediaMinHeight);

  doSave && (await savePage(activePage.value));
}

function startAddWidget() {
  elAddWidget.value?.open();
}

async function clickEmptyItem(x: number, y: number) {
  newItemLocation.value = { x: x, y: y };
  if (appState.$state.clipboard.remote.pageItems.length > 0) {
    await pasteItems();
  } else {
    elAddWidget.value?.open();
  }
}

function addPage() {
  emit("addPage");
}

async function addWidgetItem(item: ActivityUserInterfaceItem) {
  try {
    await addGridItem(item);
  } catch (e) {
    elAddWidget.value?.closeModal();
    const err = asError(e);
    if (err.message && typeof err.message == "string") {
      addErrorBottom(err.message);
    } else {
      addErrorBottom(e);
    }
  }
}

function showPageList() {
  emit("showPageList");
}

function changeAction(item: TabItem) {
  activeActionTab.value = item;
  editable.value = false;
  selectable.value = false;

  if (item.value == "edit") {
    editable.value = true;
  } else if (item.value == "select") {
    selectable.value = true;
  }

  if (item.value != "select") {
    selectedItems.value = [];
  }
}

function getGridItemMinSize(type = "icon", pageInd: number, height = false) {
  if (height && type === "media_player") {
    const mediaMinHeight = Math.ceil(
      mediaPlayerMinHeight.value /
        (gridDimensions.value.height / pages.value[pageInd]?.grid?.height),
    );
    return mediaMinHeight || 3;
  } else if (type === "media_player") {
    return pages.value[pageInd]?.grid?.width || 4;
  }

  return 1;
}

function isSaving() {
  return saving.value;
}

onMounted(async () => {
  loading.value = true;
  try {
    await getRemoteMeta();
    setRemote(props.remote as Remote);
  } catch (e) {
    addErrorBottom(e);
  }
  loading.value = false;
});
</script>
<template>
  <div
    class="remote-controller remote-controller--device"
    :class="
      !loading ? getRemotControllerClasses(isSecondModel, deviceColor) : ''
    "
  >
    <div
      class="remote-controller__page-triggers"
      :class="{
        'remote-controller__page-triggers--no-pages':
          pageListOptions.length < 1,
      }"
    >
      <UCSelect
        v-if="pageListOptions && pageListOptions.length > 0"
        v-model="activePageModel"
        :options="pageListOptions"
        :light="true"
        @select="
          (m: SelectOption) => {
            setActivePageById(m.value);
          }
        "
      />
      <button
        :title="$t('ui.edit')"
        class="button button--secondary button--icon"
        @click="showPageList"
      >
        <i class="fa-light fa-edit"></i>
      </button>
    </div>
    <Transition name="opacity">
      <div
        v-show="editButtonMapping == false && pages.length > 0"
        class="remote-controller__tools"
      >
        <button
          v-show="pages.length > 0 && isActivePageFull() == false"
          :title="$t('ui.add')"
          class="button"
          :class="toolsButtonsClasses"
          @click="startAddWidget"
        >
          <i class="fa-light fa-plus"></i>
          <span>{{ $t("ui.add") }}</span>
        </button>
        <GridSize
          v-if="pages[activePage]"
          :actual-dimensions="{
            width: pages[activePage].grid.width,
            height: pages[activePage].grid.height,
          }"
          :min-dimensions="minDimensions[activePage] || { width: 1, height: 1 }"
          @save="saveDimensions"
        />
        <button
          :title="$t('ui.reset')"
          class="button button-reset"
          :class="toolsButtonsClasses"
          @click="startResetPage"
        >
          <i class="fa-light fa-arrow-rotate-left"></i>
          <span>{{ $t("ui.reset") }}</span>
        </button>
        <button
          v-show="appState.$state.clipboard.remote.pageItems.length > 0"
          :title="$t('ui.paste')"
          class="button"
          :class="toolsButtonsClasses"
          @click="pasteItems"
        >
          <i class="fa-light fa-paste"></i>
          <span>{{ $t("ui.paste") }}</span>
        </button>
        <button
          v-show="selectedItems.length > 0"
          :title="$t('ui.copy')"
          class="button"
          :class="toolsButtonsClasses"
          @click="copyItems"
        >
          <i class="fa-light fa-copy"></i>
          <span>{{ $t("ui.copy") }}</span>
        </button>
        <button
          v-show="selectedItems.length > 0"
          :title="$t('ui.delete')"
          class="button"
          :class="toolsButtonsClasses"
          @click="startDeleteItems"
        >
          <i class="fa-light fa-trash"></i>
          <span>{{ $t("ui.delete") }}</span>
        </button>
      </div>
    </Transition>
    <Transition name="opacity">
      <TabMenu
        v-show="editButtonMapping == false && pages.length > 0"
        :list-data="actionTabItems"
        :active-tab="activeActionTab"
        :responsive="false"
        :compact="true"
        @item-click="changeAction"
      />
    </Transition>
    <div
      ref="elRemoteControllerDevice"
      class="remote-controller__device"
      :class="{
        'remote-controller__device--button-mapping': editButtonMapping,
      }"
    >
      <div
        class="remote-controller__display"
        :class="{
          'remote-controller__display--single-page': pages.length < 1,
          'remote-controller__display--disabled': editButtonMapping,
        }"
      >
        <Carousel
          v-model="activePage"
          :items-to-show="1"
          :items-to-scroll="1"
          :wrap-around="false"
          :mouse-drag="false"
          :touch-drag="false"
          snap-align="start"
          class="remote-controller__carousel"
        >
          <Slide
            v-for="(page, pageIndex) in pages"
            :key="pageIndex"
            class="ui-page"
            :class="{ 'ui-page--v2': isSecondModel }"
          >
            <div class="ui-page__head">
              <span class="ui-page__name">
                {{ page.name }}
              </span>
            </div>
            <div
              ref="elPageContent"
              class="ui-page__content"
              :class="pageContentClasses"
            >
              <div class="ui-page__background">
                <div
                  v-for="row in helperGridRows[pageIndex]"
                  :key="row"
                  class="ui-page__background__row"
                >
                  <span
                    v-for="item in helperGridCols[pageIndex]"
                    :key="row + item"
                    class="ui-page__background__item"
                  >
                  </span>
                </div>
              </div>
              <div
                class="ui-page__drag-area"
                :class="
                  getButtonSize(
                    pages[pageIndex]?.grid?.width,
                    pages[pageIndex]?.grid?.height,
                  )
                "
              >
                <grid-layout
                  v-if="
                    Array.isArray(layouts[pageIndex]) &&
                    gridDimensions.width > 0
                  "
                  :ref="
                    (el: Element | ComponentPublicInstance | null) => {
                      if (el) {
                        registerDragArea(page.page_id, el);
                      }
                    }
                  "
                  v-model:layout="layouts[pageIndex]"
                  :col-num="pages[pageIndex]?.grid?.width"
                  :row-height="getPageRowHeight(pages[pageIndex]?.grid?.height)"
                  :max-rows="pages[pageIndex]?.grid?.height"
                  :margin="[0, 0]"
                  :is-draggable="!editable"
                  :is-resizable="true"
                  :is-mirrored="false"
                  :is-bounded="true"
                  :responsive="false"
                  :auto-size="false"
                  :vertical-compact="false"
                  :use-css-transforms="true"
                  :prevent-collision="preventCollision"
                >
                  <grid-item
                    v-for="(item, index) in layouts[pageIndex]"
                    :key="item.i"
                    :ref="
                      (el: Element | ComponentPublicInstance | null) => {
                        if (el) {
                          registerGridItem(page.page_id, index, el);
                        }
                      }
                    "
                    :x="item.x"
                    :y="item.y"
                    :w="item.w"
                    :h="item.h"
                    :i="item.i"
                    :min-w="getGridItemMinSize(item.item?.type, pageIndex)"
                    :min-h="
                      getGridItemMinSize(item.item?.type, pageIndex, true)
                    "
                    :class="{
                      'vgl-item--media-player':
                        item.item.type == 'media_player',
                    }"
                    @move="onGridMove"
                    @pointerdown="isGridItemDragging = true"
                    @pointermove="onGridNativeMove"
                    @pointerup="isGridItemDragging = false"
                    @moved="
                      movedGridItem(
                        page.page_id,
                        layouts[pageIndex],
                        gridMaxHeight,
                      )
                    "
                    @resized="
                      resizedGridItem(
                        page.page_id,
                        layouts[pageIndex],
                        gridMaxHeight,
                      )
                    "
                  >
                    <div
                      class="ui-page__item"
                      :class="{ selected: itemSelected(pageIndex, index) }"
                    >
                      <component
                        :is="getComponent(item.item.type)"
                        :key="JSON.stringify(item)"
                        :settings="item.item"
                      />
                      <span
                        v-if="!selectable && editable"
                        class="ui-page__item__edit"
                        @click="
                          startButtonEdit(pageIndex, index, item.item, $event)
                        "
                      >
                        <i class="fa-regular fa-edit"></i>
                      </span>
                      <div
                        v-if="selectable"
                        class="ui-page__item__select"
                        @click="toggleItemSelect(pageIndex, index)"
                      >
                        <div class="form-item form-item--checkbox-tick">
                          <input
                            :id="`${pageIndex}-${index}-component-tick`"
                            type="checkbox"
                            :checked="itemSelected(pageIndex, index)"
                          />
                          <label
                            class="toggle"
                            :for="`${pageIndex}-${index}-component-tick`"
                          />
                          <button class="button--toggle-tick"></button>
                        </div>
                      </div>
                      <span v-else-if="!editable" class="ui-page__item__drag">
                        <i class="fa-regular fa-up-down-left-right"></i>
                      </span>
                    </div>
                  </grid-item>
                </grid-layout>
              </div>
              <div class="ui-page__empty-list">
                <template
                  v-for="(item, index) in emptyCellLayout[pageIndex]"
                  :key="`empty-cell-${pageIndex}-${index}`"
                >
                  <button
                    :style="getEmptyItemStyle(item.x, item.y, pageIndex)"
                    class="ui-page__empty-list__item"
                    @click="clickEmptyItem(item.x, item.y)"
                  >
                    <i
                      class="fa-regular"
                      :class="
                        appState.$state.clipboard.remote.pageItems.length > 0
                          ? 'fa-paste'
                          : 'fa-plus'
                      "
                    ></i>
                  </button>
                </template>
              </div>
            </div>
          </Slide>
          <template #addons>
            <Pagination />
          </template>
        </Carousel>
        <Transition name="opacity-fast">
          <div
            v-show="pages.length == 0 && loading == false"
            class="remote-controller__display__no-pages"
          >
            <img alt="Add page" src="/images/add-page.svg" @click="addPage" />
            <h2>{{ $t("user_interface.no_pages.title") }}</h2>
          </div>
        </Transition>
        <Transition name="opacity-fast">
          <div
            v-show="displaySaving"
            class="remote-controller__display__saving"
          >
            <img
              src="/images/loading-indicator.png"
              alt="Loading"
              class="list-loader__img img-loading"
            />
          </div>
        </Transition>
      </div>
      <RemoteButtonLayout
        v-if="editButtonMapping && !isSmallScreen"
        :button="highlightedRemoteButton"
      />
    </div>
  </div>

  <AddWidget
    ref="elAddWidget"
    :entity="remote"
    :entity-type="'remote'"
    :pages="pages"
    :active-page="activePage"
    :enable-media="enableMediaWidget"
    :grid-dimensions="gridDimensions"
    :saving="saving"
    @add="addWidgetItem"
    @change="updateGridItem"
    @close="resetNewItemMeta"
  />

  <Transition name="opacity-fast">
    <div
      v-show="editButton"
      :style="popupLeft != null ? { left: popupLeft + 'px' } : undefined"
      class="widget-popup-wrapper"
    >
      <div
        class="widget-popup-wrapper__background"
        @click="closeButtonEdit"
      ></div>
      <GridItemEdit
        v-if="editButton && remote"
        :key="JSON.stringify(editButton)"
        :settings="editButton"
        :entity="remote"
        :entity-type="'remote'"
        :active-page="pages[activePage]"
        :validate-size="validateButtonSize"
        :grid-dimensions="gridDimensions"
        :saving="saving"
        @change="updateGridItem"
        @copy="copyGridItem"
        @delete="startDeleteGridItem"
        @close="closeButtonEdit"
      />
    </div>
  </Transition>

  <AppDialog
    ref="dialogDelete"
    :title="$t('widget.popup.delete_widget.title', { count: 1 })"
    :text="$t('widget.popup.delete_widget.question', { count: 1 })"
    :submit-text="$t('ui.delete')"
    :cancel-text="$t('ui.cancel')"
    @submit="deleteGridItem"
  />
  <AppDialog
    ref="dialogDeleteItems"
    :title="
      $t('widget.popup.delete_widget.title', { count: selectedItems.length })
    "
    :text="
      $t('widget.popup.delete_widget.question', { count: selectedItems.length })
    "
    :submit-text="$t('ui.delete')"
    :cancel-text="$t('ui.cancel')"
    @submit="deleteItems"
  />
  <AppDialog
    ref="dialogReset"
    :title="$t('user_interface.pages.reset_page.title')"
    :text="questionResetPage"
    :submit-text="$t('ui.reset')"
    :cancel-text="$t('ui.cancel')"
    @submit="resetPage"
  />
</template>
