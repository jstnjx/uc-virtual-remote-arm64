<script setup lang="ts">
import {
  ref,
  watch,
  computed,
  onMounted,
  onUnmounted,
  useTemplateRef,
} from "vue";
import { asyncComputed } from "@vueuse/core";
import { useTranslation } from "i18next-vue";

import type { Page, PageItem } from "@/types/page";
import type { Group } from "@/types/group";
import type { DropdownItem } from "@/types/ui";
import type { DraggableSortEvent } from "@/types/draggable";

import type { ConfiguredEntity } from "@/types/integrationInstance";

import type { ResourceItem } from "@/types/resources";

import { appStateStore } from "@/stores/appState";
import { systemBaseStore } from "@/stores/systemBase";
import { profileStore } from "@/stores/profile";
import { integrationsStore } from "@/stores/integrations";
import { configStore } from "@/stores/config";
import { addErrorBottom } from "@/stores/messages";

import Draggable from "vuedraggable";

import ApiConnection from "@/api";

import { getPrimaryCommandByEntityState } from "@/composables/entity";
import { useTiming } from "@/composables/timing";
import translatedProperty from "@/composables/translatedProperty";
import { isTouchEnabled } from "@/composables/device";
import { useWindowDimension } from "@/composables/windowDimension";
import { getIconName } from "@/composables/icon";
import { useRemoteProperties } from "@/composables/remote/properties";

import UCInput from "@/components/ui/UCInput.vue";
import DropdownMenu from "@/components/ui/DropdownMenu.vue";
import LoadImage from "@/components/elements/icon/LoadImage.vue";
import EntityListItem from "@/components/elements/entity/EntityListItem.vue";
import GroupListItem from "@/components/elements/group/GroupListItem.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import RemoteNav from "@/components/remote-controller/RemoteNav.vue";
import ModalSecondary from "@/components/elements/ModalSecondary.vue";
import ModalMinimal from "@/components/elements/ModalMinimal.vue";
import ResourceList from "@/components/elements/resources/ResourceList.vue";
import QuickEditModal from "@/components/elements/QuickEditModal.vue";
import EditGroup from "@/components/elements/group/EditGroup.vue";
import { deepClone } from "@/composables/dataHelper";
// import RemoteButtonLayout from "@/components/remote-controller/RemoteButtonLayout.vue";

const props = defineProps({
  activeProfile: {
    type: Object,
    default: null,
  },
  pageId: {
    type: String,
    default: "",
  },
  editView: {
    type: Boolean,
    default: false,
  },
  pages: {
    type: Array,
    default: () => [],
  },
  folded: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["deletedEntity"]);

const integrationsApi = ApiConnection.integrations;

const appState = appStateStore();
const systemBase = systemBaseStore();
const storage = profileStore();
const integrationStorage = integrationsStore();
const config = configStore();

const { t } = useTranslation();
const { sleep } = useTiming();
const { isSmallScreen } = useWindowDimension();
const { getDeviceColor, getRemotControllerClasses } = useRemoteProperties();

const activePage = ref<Page>();
const activePageItems = ref<PageItem[]>([]);

const itemToEdit = ref<PageItem | null>(null);
const itemToDelete = ref<PageItem | null>(null);
const itemToModify = ref<PageItem | null>(null);
const groupToEdit = ref<Group | null>(null);

const displayListScrollTop = ref(0);
const displayListScrollInverse = ref<number | null>(0);
const touchActionPosition = ref<number | null>(null);
const pageName = ref("");
const updating = ref(false);
const deleting = ref(false);
const showRenameModal = ref(false);
const showBackgroundModal = ref(false);

const modalEditGroup =
  useTemplateRef<InstanceType<typeof EditGroup>>("modalEditGroup");
const dialogRemoveBackground = useTemplateRef<InstanceType<typeof AppDialog>>(
  "dialogRemoveBackground",
);
const dialogDeleteItem =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDeleteItem");
const displayEl = useTemplateRef<HTMLDivElement>("displayEl");
const remoteControllerEl = useTemplateRef<HTMLDivElement>("remoteControllerEl");

const itemOnDrag = ref({});
const itemAlreadyRemoved = ref(false);
const settingRCOptionsPosition = ref(false);

const activePageID = ref<string | null>(null);
const activePages = ref<Page[]>([]);

const isSecondModel = ref(false);
const deviceColor = ref("d");
const loadingMeta = ref(true);

watch(props, () => {
  let update = false;
  let changedPageId = false;

  const pagesList = props.pages as Page[];
  if (props.pageId != null) {
    if (activePageID.value != props.pageId) {
      changedPageId = true;
    }
    activePageID.value = props.pageId;
    activePages.value = pagesList;
    update = true;
  } else if (props.pages.length > 0) {
    activePages.value = pagesList;
    update = true;
  }

  if (props.folded == true) {
    activePageID.value = props.pageId;
    activePages.value = pagesList;
    update = true;
  }

  if (update) {
    setActivePage(changedPageId);

    if (props.editView == true) {
      setUiDropdownPosition();
    }
  }
});

watch(showRenameModal, async (val) => {
  pageName.value = activePage.value?.name || "";

  if (val) {
    await sleep(100);
    const pageNameInput = document.querySelector(
      "#remote-controller__modal-rename-page input",
    );
    if (pageNameInput instanceof HTMLInputElement) {
      pageNameInput.focus();
      pageNameInput.select();
    }
  }
});

const groupList = computed<Group[]>(() => storage.groups);
const allEntities = computed<ConfiguredEntity[]>(
  () => integrationStorage.configuredEntities,
);

const pageOptions = computed(() => {
  const hasBackground =
    activePage.value &&
    activePage.value.image &&
    activePage.value.image.length > 0;
  const options: DropdownItem[] = [
    {
      icon: "fa-light fa-i-cursor",
      label: "customise_remote.pages.options.rename",
      value: "rename",
    },
    {
      icon: "fa-light fa-image",
      label: `customise_remote.pages.options.${
        hasBackground ? "replace_background" : "add_background"
      }`,
      value: "replace_background",
    },
  ];

  if (hasBackground) {
    options.push({
      icon: "fa-light fa-eye-slash",
      label: "customise_remote.pages.options.remove_background",
      value: "remove_background",
    });
  }

  return options;
});

const iconDrag = asyncComputed(async () => {
  return await getIconName("fa-grip-vertical");
});

const scrolledScreen = computed(() => {
  return displayListScrollTop.value >= 100;
});

const displayHeaderStyles = computed(() => {
  let styling = "";
  if (displayListScrollTop.value > 0) {
    styling += `height: calc(14rem - ${
      displayListScrollTop.value < 100 ? displayListScrollTop.value : 100
    }px);`;
    styling +=
      displayListScrollTop.value >= 100
        ? `top: -${displayListScrollTop.value - 100}px;`
        : "";
  } else if (
    displayListScrollInverse.value != null &&
    displayListScrollInverse.value > 0
  ) {
    styling += `height: calc(14rem + ${displayListScrollInverse.value / 6}px);`;
  }
  return styling;
});

const getPageItemId = (item: PageItem) => item.entity_id || item.group_id;

function updateActivePageItems(newItems: PageItem[], reset = false) {
  if (reset || activePageItems.value.length < 1) {
    activePageItems.value = newItems;
    return true;
  }

  activePageItems.value = activePageItems.value.filter((item: PageItem) =>
    newItems.some((newItem) => getPageItemId(newItem) === getPageItemId(item)),
  );

  newItems.forEach((newItem) => {
    const existingIndex = activePageItems.value.findIndex(
      (item: PageItem) => getPageItemId(item) === getPageItemId(newItem),
    );
    if (existingIndex !== -1) {
      activePageItems.value[existingIndex] = newItem;
    } else {
      activePageItems.value.push(newItem);
    }
  });
}

function setActivePage(reset = false) {
  const pageList = activePages.value as Page[];
  activePage.value = (pageList.find((p) => p.page_id === activePageID.value) ||
    props.pages[0]) as Page;
  if (activePage.value && activePage.value.items) {
    updateActivePageItems(activePage.value.items, reset);
  } else {
    activePageItems.value = [];
  }
}

async function fetchIntegrationData() {
  try {
    await integrationStorage.getConfiguredEntities(null, true);
  } catch (e) {
    addErrorBottom(e);
  }
}

function getPageItemComponent(element: PageItem) {
  if (element.entity_id) {
    return EntityListItem;
  }
  if (element.group_id) {
    return GroupListItem;
  }
  return null;
}

function getItem(item: PageItem) {
  let res: Group | ConfiguredEntity | null = null;
  if (item.entity_id) {
    res = allEntities.value.find((entity) => {
      return entity.entity_id === item.entity_id;
    }) as ConfiguredEntity;
  } else {
    res = groupList.value.find((group) => {
      return group.group_id === item.group_id;
    }) as Group;
  }

  if (!res) {
    return {};
  }
  // Keep JSON clone: this lookup returns a heterogeneous entity/group/`{}` shape
  // consumed via `any`-style access; `structuredClone`'s precise return type
  // surfaces a pre-existing typing gap out of scope for this cloning sweep.
  return JSON.parse(JSON.stringify(res));
}

function displayListScrolling(ev: Event) {
  if (ev == null) {
    return;
  }

  const scrllTop = (ev.target as HTMLElement).scrollTop;
  if (scrllTop) {
    displayListScrollTop.value = scrllTop;
  } else {
    displayListScrollTop.value = 0;
  }
}

function listTouchMoveHandler(ev: Event) {
  if (displayListScrollTop.value > 0 || props.folded) {
    displayListScrollInverse.value = null;
    return false;
  }

  if (
    touchActionPosition.value == null &&
    (ev as TouchEvent).touches[0]?.screenY
  ) {
    touchActionPosition.value = (ev as TouchEvent).touches[0]?.screenY;
  } else if (touchActionPosition.value != null) {
    displayListScrollInverse.value =
      (ev as TouchEvent).touches[0]?.screenY - touchActionPosition.value;
  }
}

function listTouchEndHandler(_ev: Event) {
  displayListScrollInverse.value = null;
}

function getItemClasses(element: PageItem) {
  let classList = "";
  classList +=
    element.entity_id && element.entity_id == itemToDelete.value?.entity_id
      ? "entity-item--to-delete"
      : "";
  classList +=
    element.group_id && element.group_id == itemToDelete.value?.group_id
      ? "entity-item--to-delete"
      : "";
  return classList;
}

async function clickMeta(item: any) {
  if (!isTouchEnabled() || !activePageItems.value || props.folded) {
    return false;
  }
  let currentItem = null;
  if (item.entity_id) {
    currentItem = activePageItems.value.find((entity) => {
      return entity.entity_id === item.entity_id;
    }) as PageItem;
  } else {
    currentItem = activePageItems.value.find((group) => {
      return group.group_id === item.group_id;
    }) as PageItem;
  }

  await sleep(10);
  itemToModify.value = currentItem;
}

async function executeCommand(entity: ConfiguredEntity) {
  const command = getPrimaryCommandByEntityState(entity);
  if (command != null) {
    try {
      await integrationsApi.executeEntityCommand(entity.entity_id, command);
    } catch (error) {
      console.error(error);
    }
  }
}

async function updatePage(modifiedPage: Page) {
  updating.value = true;
  try {
    await storage.updatePage(modifiedPage as Page);
  } catch (e) {
    addErrorBottom(e, "customise_remote.pages.update");
  }
  updating.value = false;
}

async function pageListChange(ev: any = null) {
  if (ev && "removed" in ev) {
    itemAlreadyRemoved.value = true;
  } else {
    itemAlreadyRemoved.value = false;
  }

  if (!activePageItems.value) {
    return false;
  }

  activePageItems.value.forEach((item, index) => {
    item.pos = index + 1;
  });

  const modifiedPage = {
    ...activePage.value,
    items: activePageItems.value.map((item, index) => {
      return {
        entity_id: item.entity_id,
        group_id: item.group_id,
        pos: index + 1,
      };
    }),
  };
  await updatePage(modifiedPage as Page);

  if (ev && "removed" in ev) {
    emit("deletedEntity");
  }
}

function removePageListItem(item: PageItem) {
  if (!item) {
    return false;
  }

  let itemIndex = null;
  if (item.entity_id && activePageItems.value) {
    itemIndex = activePageItems.value.findIndex(
      (i) => i.entity_id == item.entity_id,
    );
  } else if (item.group_id && activePageItems.value) {
    itemIndex = activePageItems.value.findIndex(
      (i) => i.group_id == item.group_id,
    );
  }

  if (itemIndex == null) {
    return false;
  }

  const newList = deepClone(activePageItems.value);
  newList.splice(itemIndex, 1);
  updateActivePageItems(newList);
  pageListChange();
}

function onDragStart(ev: DraggableSortEvent) {
  if (activePageItems.value) {
    itemOnDrag.value = activePageItems.value[ev.oldDraggableIndex];
  }
}

async function onDragEnd(ev: DraggableSortEvent) {
  const originalEvent = ev.originalEvent;
  const displayDimensions = displayEl.value!.getBoundingClientRect();

  // Return when touch screen
  if (isTouchEnabled()) {
    return false;
  }

  await sleep(10);
  // Return when event on remote display
  const checkOffset = 125;
  if (
    originalEvent.x - checkOffset > displayDimensions.x - checkOffset &&
    originalEvent.x - checkOffset <
      displayDimensions.x + displayDimensions.width + checkOffset &&
    originalEvent.y > displayDimensions.y &&
    originalEvent.y < displayDimensions.y + displayDimensions.height
  ) {
    return false;
  }

  if (itemOnDrag.value && itemAlreadyRemoved.value == false) {
    removePageListItem(itemOnDrag.value as PageItem);
  }
  itemAlreadyRemoved.value = false;
}

async function startItemEdit(element: PageItem | null) {
  if (element == null || (!element.entity_id && !element.group_id)) {
    itemToModify.value = null;
    return;
  }

  const item = getItem(element);

  if (!item) {
    return;
  }

  await sleep(10);
  if (item.entity_id) {
    itemToEdit.value = item;
  } else if (item.group_id) {
    groupToEdit.value = item;
    modalEditGroup.value?.open();
  }
}

async function startItemDelete(element: PageItem | null) {
  if (element == null) {
    itemToModify.value = null;
    return;
  }

  await sleep(10);
  itemToDelete.value = element;

  if (isTouchEnabled()) {
    dialogDeleteItem.value?.open();
  }
}

function clickOutsideDelete() {
  if (itemToModify.value == null) {
    clearItemToDelete();
  }
}

function clearItemToDelete() {
  if (itemToDelete.value) {
    itemToDelete.value = null;
  }
}

async function deleteItem() {
  if (itemToDelete.value == null) {
    return false;
  }
  deleting.value = true;

  const entity_id = itemToDelete.value.entity_id || null;
  const group_id = itemToDelete.value.group_id || null;

  const modifiedPage = {
    ...activePage.value,
    items: activePage.value?.items.filter((item) => {
      return (
        (entity_id && item.entity_id !== entity_id) ||
        (group_id && item.group_id !== group_id)
      );
    }),
  };
  modifiedPage.items?.forEach((item, pos) => {
    item.pos = pos + 1;
  });

  await updatePage(modifiedPage as Page);
  if (entity_id != null) {
    emit("deletedEntity");
  }
  itemToEdit.value = null;
  itemToDelete.value = null;
  itemToModify.value = null;
  deleting.value = false;
}

async function savePageName() {
  if (pageName.value.length < 1) {
    return false;
  }

  const modifiedPage = {
    ...activePage.value,
    name: pageName.value,
  };
  showRenameModal.value = false;
  await updatePage(modifiedPage as Page);
}

async function doChangeBackground(item?: ResourceItem) {
  if (activePage.value == null) {
    return;
  }

  const modifiedPage = deepClone(activePage.value);

  if (!modifiedPage) {
    return;
  }

  if (item) {
    modifiedPage.image = "custom:" + item.id; // Select background
  } else {
    modifiedPage.image = ""; // Remove background
  }

  showBackgroundModal.value = false;
  await updatePage(modifiedPage);
}

async function doSelectBackground(item: ResourceItem) {
  doChangeBackground(item);
}

async function removeBackground() {
  await doChangeBackground();
}

function doPageOption(item: DropdownItem) {
  switch (item.value) {
    case "rename":
      showRenameModal.value = true;
      break;
    case "replace_background":
      showBackgroundModal.value = true;
      break;
    case "remove_background":
      dialogRemoveBackground.value?.open();
      break;
    default:
      return false;
  }
}

const handleScroll = () => {
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  if (scrollTop > 0) {
    displayEl.value?.classList.add("scrolled");
  } else {
    displayEl.value?.classList.remove("scrolled");
  }
};

function getImage(page: Page) {
  return ApiConnection.rest().resourceUrl(
    "BackgroundImage",
    page.image.replace(/^custom:/, ""),
  );
}

async function setUiDropdownPosition() {
  if (isSmallScreen.value) {
    return;
  }

  const offset = 7;
  settingRCOptionsPosition.value = true;

  await sleep(800);
  const displayElPos = displayEl.value!.getBoundingClientRect();
  const elRCOptions = document.querySelector(
    ".remote-controller__options",
  ) as HTMLElement;

  if (elRCOptions && displayElPos) {
    elRCOptions.style.left = displayElPos.x + offset + "px";
    elRCOptions.style.top = displayElPos.y + offset + "px";
  }

  settingRCOptionsPosition.value = false;
}

function eventShowDropdown(value: boolean) {
  appState.activeDropdown = value;
}

async function getRemoteMeta() {
  loadingMeta.value = true;
  let model = "";
  let systemInfo = null;

  try {
    model = await config.getDeviceModel();
  } catch (e) {
    console.error(e);
  }

  try {
    systemInfo = await systemBase.getSystemInfo();
  } catch (e) {
    console.error(e);
  }

  if (model?.toLowerCase() == "ucr2") {
    isSecondModel.value = true;
  } else {
    isSecondModel.value = false;

    if (systemInfo != null && systemInfo.serial_number) {
      deviceColor.value = getDeviceColor(systemInfo.serial_number);
    }
  }
  loadingMeta.value = false;
}

onMounted(async () => {
  getRemoteMeta();
  await fetchIntegrationData();
  setActivePage();
  try {
    await storage.getGroups();
  } catch (e) {
    addErrorBottom(e);
  }
  window.addEventListener("scroll", handleScroll);

  window.onresize = () => {
    if (props.editView == true) {
      setUiDropdownPosition();
    }
  };
});

onUnmounted(() => {
  window.removeEventListener("scroll", handleScroll);
});
</script>
<template>
  <Suspense>
    <div
      ref="remoteControllerEl"
      class="remote-controller"
      :class="
        !loadingMeta
          ? getRemotControllerClasses(isSecondModel, deviceColor)
          : ''
      "
    >
      <div class="remote-controller__device">
        <div ref="displayEl" class="remote-controller__display">
          <RemoteNav
            v-if="activeProfile"
            :full-width="scrolledScreen"
            :active-profile="activeProfile"
            :page="activePage"
            class="remote-controller__display__nav"
          />

          <Teleport to="body" :disabled="isSmallScreen">
            <Transition name="opacity-fast">
              <DropdownMenu
                v-if="(editView && folded == false) || isSmallScreen"
                v-show="!scrolledScreen && settingRCOptionsPosition == false"
                :list-data="pageOptions"
                class="remote-controller__options"
                @item-click="(item) => doPageOption(item)"
                @show="eventShowDropdown"
              >
                <template #trigger>
                  <button class="button button--secondary button--icon">
                    <i class="fa-light fa-edit"></i>
                  </button>
                </template>
              </DropdownMenu>
            </Transition>
          </Teleport>

          <div
            class="remote-controller__display__header"
            :style="
              displayListScrollInverse != null && displayListScrollInverse > 0
                ? displayHeaderStyles
                : ''
            "
          >
            <div
              class="remote-controller__display__header__body"
              :style="displayHeaderStyles"
            >
              <LoadImage
                v-if="activePage && activePage.image"
                :url="getImage(activePage)"
              />
              <span
                v-if="activePage"
                class="remote-controller__display__header__title"
                >{{ activePage.name }}</span
              >
            </div>
          </div>
          <Draggable
            v-model="activePageItems"
            :group="'customise-remote-items'"
            item-key="id"
            handle=".entity-item__drag"
            :force-fallback="true"
            class="remote-controller__display__list"
            :style="
              displayListScrollInverse != null && displayListScrollInverse > 0
                ? `padding-top: calc(13rem + ${
                    displayListScrollInverse / 6
                  }px);`
                : ''
            "
            @scroll="displayListScrolling"
            @touchmove="listTouchMoveHandler"
            @touchend="listTouchEndHandler"
            @change="pageListChange"
            @start="onDragStart"
            @end="onDragEnd"
          >
            <template #item="{ element }">
              <div
                :id="
                  'entity-item-' +
                  (element.group_id ? element.group_id : element.entity_id)
                "
                :class="getItemClasses(element)"
                class="entity-item"
              >
                <span class="entity-item__options">
                  <button
                    class="button button--secondary"
                    @click="startItemEdit(element)"
                  >
                    <i class="fa-regular fa-edit"></i>
                  </button>
                  <button
                    v-click-outside="clickOutsideDelete"
                    class="button button--secondary"
                    @click="startItemDelete(element)"
                  >
                    <i class="fa-regular fa-trash"></i>
                  </button>
                  <span class="entity-item__options__deleting">
                    <button
                      class="button button--delete"
                      @click="clearItemToDelete"
                    >
                      <i class="fa-regular fa-xmark"></i>
                    </button>
                    <button class="button button--delete" @click="deleteItem">
                      <i class="fa-regular fa-check"></i>
                    </button>
                  </span>
                </span>
                <component
                  :is="getPageItemComponent(element)"
                  :list-item="getItem(element)"
                  @click-meta="clickMeta"
                  @execute-command="executeCommand"
                />
                <span v-if="editView" class="entity-item__drag">
                  <i v-if="iconDrag" class="fa-regular" :class="iconDrag"></i>
                </span>
              </div>
            </template>
            <template #footer>
              <p
                v-if="!activePageItems || activePageItems.length < 1"
                class="remote-controller__display__no-items"
              >
                <template v-if="!activePageItems">{{
                  $t("customise_remote.pages.no_pages")
                }}</template>
                <template v-else-if="activePageItems.length < 1">{{
                  $t("customise_remote.options.no_items")
                }}</template>
              </p>
            </template>
          </Draggable>
        </div>
        <!-- <RemoteButtonLayout
          v-if="!isSmallScreen"
        /> -->
      </div>
    </div>
  </Suspense>
  <Teleport to="body">
    <ModalMinimal
      id="remote-controller__modal-rename-page"
      :show="showRenameModal == true"
      :name="'modal-rename'"
      :title="$t('customise_remote.rename_page')"
      class="remote-controller__modal-rename-page"
      @close="showRenameModal = false"
    >
      <UCInput
        v-model="pageName"
        :disable-blur="true"
        :full-w="true"
        @submit="savePageName"
      />
      <template #footer>
        <button
          class="button button--tertiary"
          @click="showRenameModal = false"
        >
          {{ $t("ui.cancel") }}
        </button>
        <button class="button button--secondary" @click="savePageName">
          {{ $t("ui.save") }}
        </button>
      </template>
    </ModalMinimal>
  </Teleport>
  <Teleport to="body">
    <ModalSecondary
      :show="showBackgroundModal"
      :name="'background-modal'"
      :height="'40rem'"
      :slide="true"
      class="modal-background-images"
      @close="showBackgroundModal = false"
    >
      <ResourceList
        ref="resourceListIconRC"
        :title="t('ui.background_images')"
        :allowed-types="['BackgroundImage']"
        :search-full-width="true"
        :in-modal="true"
        :active="showBackgroundModal"
        default-type="BackgroundImage"
        @close="showBackgroundModal = false"
        @item-click="doSelectBackground"
      />
    </ModalSecondary>
  </Teleport>
  <Teleport to="body">
    <ModalMinimal
      :show="itemToModify != null"
      :name="'modal-remote-options'"
      :title="
        itemToModify != null
          ? itemToModify.entity_id
            ? translatedProperty(getItem(itemToModify)?.name)
            : getItem(itemToModify)?.name
          : ''
      "
      class="remote-controller__modal-item-modify"
      @close="itemToModify = null"
    >
      <div v-if="itemToModify != null" class="modal-minimal__list">
        <button @click="startItemEdit(itemToModify)">
          <i class="fa-light fa-pencil"></i>
          <span>{{ $t("ui.edit") }}</span>
        </button>
        <button @click="startItemDelete(itemToModify)">
          <i class="fa-light fa-trash"></i>
          <span>{{ $t("ui.delete") }}</span>
        </button>
      </div>
    </ModalMinimal>
    <AppDialog
      ref="dialogRemoveBackground"
      :title="$t('customise_remote.pages.remove_background.title')"
      :text="$t('customise_remote.pages.remove_background.question')"
      :submit-text="$t('ui.remove')"
      :cancel-text="$t('ui.cancel')"
      :disable-buttons="updating"
      @submit="removeBackground"
    />
    <AppDialog
      ref="dialogDeleteItem"
      :title="$t('customise_remote.pages.delete_item.title')"
      :text="$t('customise_remote.pages.delete_item.question')"
      :submit-text="$t('ui.delete')"
      :cancel-text="$t('ui.cancel')"
      :disable-buttons="deleting"
      @submit="deleteItem"
      @close="itemToDelete = null"
    />
  </Teleport>
  <EditGroup ref="modalEditGroup" :group="groupToEdit || {}" />
  <QuickEditModal
    v-if="itemToEdit != null"
    :item="itemToEdit"
    :show-by-parent="true"
    @closed="itemToEdit = null"
  />
</template>
