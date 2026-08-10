<script setup lang="ts">
import { ref, watch, computed, onMounted, useTemplateRef } from "vue";
import { useElementSize } from "@vueuse/core";
import { useTranslation } from "i18next-vue";
import ApiConnection from "@/api";

import { FlashMessageInfoStatus } from "@/types/enums";
import type { TabItem } from "@/types/ui";
import type { ConfiguredEntity } from "@/types/integrationInstance";

interface SelectOption {
  label: string;
  value: string;
}

import type { ComponentPublicInstance } from "vue";
import type {
  Activity,
  ActivityUserInterfaceItem,
  ActivityUserInterfacePage,
  DeviceButton,
  IncludedEntity,
} from "@/types/activity";

import { appStateStore } from "@/stores/appState";
import { systemBaseStore } from "@/stores/systemBase";
import { configStore } from "@/stores/config";
import { addErrorBottom, addInfoFull } from "@/stores/messages";
import { activitiesStore } from "@/stores/activities";
import { integrationsStore } from "@/stores/integrations";

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

const { t } = useTranslation();
const { sleep } = useTiming();
const { isSmallScreen } = useWindowDimension();
const { isNonEmptyObject } = useDataHelper();

const { getDeviceColor, getRemotControllerClasses } = useRemoteProperties();

const props = defineProps({
  activity: {
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
  {
    label: t("ui.test"),
    value: "test",
  },
]);

const appState = appStateStore();
const systemBase = systemBaseStore();
const config = configStore();
const storage = activitiesStore();
const integrationsStorage = integrationsStore();

const integrationsApi = ApiConnection.integrations;

const activeActionTab = ref<TabItem>(defaultActionTabItem);
const currentActivity = ref<Activity | null>(null);
const icon = ref("");
const elAddWidget =
  useTemplateRef<InstanceType<typeof AddWidget>>("elAddWidget");
const values = ref(getActivityFormValues());

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

// const pageToEdit = ref<ActivityUserInterfacePage | null>(null);
const pageListUpdate = ref(1);
const activePageModel = ref<SelectOption>({ label: "", value: "" });

const isSecondModel = ref(false);
const deviceColor = ref("d");
const editable = ref(false);
const selectable = ref(false);
const testable = ref(false);

const deleting = ref(false);

const dialogDelete =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDelete");
const dialogDeleteItems =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDeleteItems");
const dialogReset =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogReset");
const dialogMissingEntity = useTemplateRef<InstanceType<typeof AppDialog>>(
  "dialogMissingEntity",
);

const loading = ref(true);
const displaySaving = ref(false);
const saving = ref(false);

const gridMaxHeight = ref(
  config.$state.list.screenLayout.grid.max.height || 12,
);
const elRemoteControllerDevice = useTemplateRef<HTMLDivElement>(
  "elRemoteControllerDevice",
);

const allEntities = ref<ConfiguredEntity[]>([]);
const missingEntitiesIDs = ref<string[]>([]);

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
  () => props.activity,
  () => {
    if (!deleting.value) {
      setActivity(props.activity as Activity);
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

const toolsButtonsClasses = computed(() => {
  let classList = "";
  if (isSmallScreen.value) {
    classList += "button--secondary button--icon";
  } else {
    classList += "button--tertiary button--hybrid";
  }

  return classList;
});

const danglingEntities = computed(() => {
  if (!props.activity) return [];
  return (props.activity.options?.included_entities ?? [])
    .filter((e: IncludedEntity) => e.available === false)
    .map((e: IncludedEntity) => {
      return e.entity_id;
    });
});

const questionMissingEntity = computed(() => {
  let names = "**";
  missingEntitiesIDs.value.forEach((id) => {
    const entData = allEntities.value.find((e) => e.entity_id === id);
    if (names.length > 2) {
      names += ", ";
    }

    names += translatedProperty(entData?.name) || "";
  });

  return t("entity.missing_entity.question_widget", {
    entities: `${names.replace(/[,\s]+$/g, "")}**`,
    count: missingEntitiesIDs.value.length,
  });
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

function setActivePageById(id: string) {
  const actPage = pages.value.findIndex((obj) => obj.page_id === id);
  if (actPage > -1) {
    activePage.value = actPage;
  }
}

function getActivityFormValues() {
  return {
    name: translatedProperty(currentActivity.value?.name) || "",
    icon: currentActivity.value?.icon || "uc:clapperboard",
  };
}

async function setLayouts() {
  layouts.value = (
    currentActivity.value?.options?.user_interface?.pages || []
  ).map((page) => {
    return buildLayout(page.items);
  });
}

function setActivity(newValue: Activity | undefined) {
  if (!newValue || !isNonEmptyObject(newValue)) {
    return false;
  }

  currentActivity.value = deepClone(newValue);
  values.value = getActivityFormValues();
  pages.value = currentActivity.value?.options?.user_interface?.pages || [];
  setLayouts();
  icon.value = currentActivity.value?.icon || "";
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
  if (!currentActivity.value) {
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
    const newValue = await storage.addUiPage(currentActivity.value, newItem);
    setActivity(newValue);
  } catch (e) {
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
async function savePage(pageIndex: number, skipActivitySetting = false) {
  saving.value = true;
  if (pageIsSaving[pageIndex]) {
    return;
  }
  pageIsSaving[pageIndex] = true;
  layouts.value[pageIndex] = buildLayout(pages.value[pageIndex].items);

  try {
    const newValue = await storage.updateUiPage(
      props.activity.entity_id,
      pages.value[pageIndex],
    );
    if (!skipActivitySetting) {
      setActivity(newValue);
    }
    emit("update");
  } catch (e) {
    if (elAddWidget.value?.isActive()) {
      elAddWidget.value?.closeModal();
    } else {
      closeButtonEdit();
    }
    setActivity(props.activity as Activity);
    addErrorBottom(
      e,
      "activity.user_interface.update",
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
  } catch (e) {
    addErrorBottom(e);
  }
  deleting.value = false;
  await sleep(200);
  setActivity(props.activity as Activity);
}

async function startPasteItems() {
  const newPageItems = appState.$state.clipboard.activity.pageItems || [];

  // Check entities availability
  const entitiesIDsFromWidget = (newPageItems ?? [])
    .map((item: ActivityUserInterfaceItem) => item.command?.entity_id)
    .filter((id: string | undefined): id is string => !!id);

  const uniqueEntitiesIDsFromWidget = [
    ...new Set(entitiesIDsFromWidget),
  ] as string[];
  const includedEntitiesIDs = (
    props.activity.options?.included_entities ?? []
  ).map((item: IncludedEntity) => item.entity_id);
  missingEntitiesIDs.value = uniqueEntitiesIDsFromWidget.filter(
    (id) => !includedEntitiesIDs.includes(id),
  );

  if (missingEntitiesIDs.value.length > 0 && dialogMissingEntity.value) {
    try {
      allEntities.value = await integrationsStorage.getConfiguredEntities(
        null,
        false,
      );
      dialogMissingEntity.value?.open();
    } catch (e) {
      addErrorBottom(e);
    }
  } else {
    pasteItems();
  }
}

async function pasteItems() {
  const newPageItems = appState.$state.clipboard.activity.pageItems || [];

  if (!newPageItems) {
    return;
  }

  try {
    await pasteGridItems(newPageItems);
    appState.setClipboard([], "activity", "pageItems");
  } catch (e) {
    const err = asError(e);
    if (err.message && typeof err.message == "string") {
      addErrorBottom(err.message);
    } else {
      addErrorBottom(e);
    }
  }
  resetSelectedItems();
}

async function addMissingEntities() {
  if (!props.activity) {
    return;
  }
  const includedEntitiesIDs = (
    props.activity.options?.included_entities ?? []
  ).map((item: IncludedEntity) => item.entity_id);
  const newValues = {
    options: {
      entity_ids: JSON.parse(
        JSON.stringify(includedEntitiesIDs.concat(missingEntitiesIDs.value)),
      ),
    },
  };

  saving.value = true;
  try {
    (await storage.update(props.activity.entity_id, newValues)) as Activity;

    await pasteItems();
    emit("update");
  } catch (e) {
    addErrorBottom(e);
  }
  saving.value = false;
}

function copyGridItem() {
  if (!editButton.value) {
    return false;
  }

  const pgItems = new Array(editButton.value);
  appState.setClipboard(pgItems, "activity", "pageItems");
}

function copyItems() {
  const pgItems = collectGridItems(selectedItems.value);
  appState.setClipboard(pgItems, "activity", "pageItems");
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
    await storage.updateUiPage(props.activity.entity_id, {
      ...pageToReset,
      items: [],
    });
    await storage.getActivity(props.activity.entity_id);
    addInfoFull(FlashMessageInfoStatus.SUCCESS);
    emit("update");
  } catch (e) {
    addErrorBottom(
      e,
      "activity.user_interface.update",
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
  let doSave = false;
  const pageItems = pages.value[activePage.value].items;

  for (const item of pageItems) {
    if (item.type == "media_player") {
      item.size.width = newWidth;
      doSave = true;
    }
  }

  doSave && (await savePage(activePage.value));
}

async function updateWidgetHeights(newHeight: number) {
  let doSave = false;
  const pageItems = pages.value[activePage.value].items;
  const mediaMinHeight = Math.ceil(
    mediaPlayerMinHeight.value / (gridDimensions.value.height / newHeight),
  );

  for (const item of pageItems) {
    const heightDiff = mediaMinHeight - item.size.height;
    if (item.type == "media_player" && heightDiff > 0) {
      item.size.height = item.size.height + heightDiff;
      let hasCollision = false;

      for (const itm of pageItems) {
        if (
          item.location.x != itm.location.x &&
          item.location.y != itm.location.y &&
          item.location.y + item.size.height >= itm.location.y
        ) {
          hasCollision = true;
        }
      }

      if (hasCollision) {
        for (const itm of pageItems) {
          if (item.location.y < itm.location.y) {
            itm.location.y = itm.location.y + heightDiff;
          }
        }
      }

      doSave = true;
    }
  }

  doSave && (await savePage(activePage.value));
}

function startAddWidget() {
  elAddWidget.value?.open();
}

async function clickEmptyItem(x: number, y: number) {
  newItemLocation.value = { x: x, y: y };
  if (appState.$state.clipboard.activity.pageItems.length > 0) {
    await startPasteItems();
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
  testable.value = false;

  if (item.value == "edit") {
    editable.value = true;
  } else if (item.value == "select") {
    selectable.value = true;
  } else if (item.value == "test") {
    testable.value = true;
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

function isDangling(item: ActivityUserInterfaceItem) {
  return danglingEntities.value.includes(item.command?.entity_id);
}

async function executeButtonCommand(item: ActivityUserInterfaceItem) {
  if (
    !item.command ||
    !item.command.entity_id ||
    !item.command.cmd_id ||
    !item.command.params
  ) {
    return;
  }

  try {
    await integrationsApi.executeEntityCommand(
      item.command.entity_id,
      item.command.cmd_id,
      item.command.params,
    );
  } catch (e) {
    addErrorBottom(e, "entity.execute_command");
  }
}

function isSaving() {
  return saving.value;
}

onMounted(async () => {
  loading.value = true;
  try {
    await getRemoteMeta();
    setActivity(props.activity as Activity);
  } catch (e) {
    addErrorBottom(e);
  }
  loading.value = false;
});
</script>
<template>
  <div
    class="remote-controller remote-controller--activity"
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
          v-show="appState.$state.clipboard.activity.pageItems.length > 0"
          :title="$t('ui.paste')"
          class="button"
          :class="toolsButtonsClasses"
          @click="startPasteItems"
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
                  :is-resizable="!editable && !selectable && !testable"
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
                      :class="{
                        selected: itemSelected(pageIndex, index),
                        'ui-page__item--dangling': isDangling(item.item),
                      }"
                    >
                      <component
                        :is="getComponent(item.item.type)"
                        :key="JSON.stringify(item)"
                        :settings="item.item"
                      />
                      <span
                        v-if="!selectable && !testable && editable"
                        class="ui-page__item__edit"
                        @click="
                          startButtonEdit(pageIndex, index, item.item, $event)
                        "
                      >
                        <i class="fa-regular fa-edit"></i>
                      </span>
                      <span
                        v-if="!selectable && !editable && testable"
                        class="ui-page__item__test"
                        :class="{
                          'ui-page__item__test--disabled':
                            item.item.type === 'media_player' ||
                            item.item.type === 'sensor',
                        }"
                        @click="executeButtonCommand(item.item)"
                      >
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
                      <span
                        v-else-if="!editable && !testable"
                        class="ui-page__item__drag"
                      >
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
                        appState.$state.clipboard.activity.pageItems.length > 0
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
    :entity="activity"
    :entity-type="'activity'"
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
        v-if="editButton && activity"
        :key="JSON.stringify(editButton)"
        :settings="editButton"
        :entity="activity"
        :entity-type="'activity'"
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
  <AppDialog
    ref="dialogMissingEntity"
    :markdown="true"
    :title="
      $t('entity.missing_entity.title', { count: missingEntitiesIDs.length })
    "
    :text="questionMissingEntity"
    :submit-text="
      $t('entity.missing_entity.add', { count: missingEntitiesIDs.length })
    "
    :cancel-text="$t('ui.cancel')"
    @submit="addMissingEntities"
  />
</template>
