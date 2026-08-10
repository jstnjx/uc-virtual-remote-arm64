<script setup lang="ts">
import { ref, watch, computed, onMounted, useTemplateRef } from "vue";
import { asyncComputed } from "@vueuse/core";
import { useTranslation } from "i18next-vue";

import type { ResourceItem } from "@/types/resources";
import type { DropdownItem } from "@/types/ui";
import type { Page, NewPageData } from "@/types/page";
import type { ProfileStore } from "@/stores/profile";

import { getIconName } from "@/composables/icon";

type DragChangedEvent = {
  moved: {
    newIndex: number;
    oldIndex: number;
    element: Page;
  };
};

import { useTiming } from "@/composables/timing";

import ApiConnection from "@/api";
import { addErrorBottom } from "@/stores/messages";
import { profileStore } from "@/stores/profile";

import Draggable from "vuedraggable";

import UCInput from "@/components/ui/UCInput.vue";
import LoadImage from "@/components/elements/icon/LoadImage.vue";
import DropdownMenu from "@/components/ui/DropdownMenu.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import ModalSecondary from "@/components/elements/ModalSecondary.vue";
import ResourceList from "@/components/elements/resources/ResourceList.vue";
import { deepClone } from "@/composables/dataHelper";

const props = defineProps({
  activeProfile: {
    type: Object,
    required: true,
  },
  loading: {
    type: Boolean,
    defafult: false,
  },
});
const emit = defineEmits(["showPage", "editPage"]);

const { t } = useTranslation();
const { sleep } = useTiming();

const storage = profileStore();
const pages = ref<Page[]>([]);
const pageToEditIndex = ref<number | null>(null);
const pageToEditBgIndex = ref<number | null>(null);
const newPageName = ref(t("user_interface.pages.default_name"));
const editedName = ref("");
const addPage = ref(false);
const creatingNewPage = ref(false);
const savingName = ref(false);
const pageToDelete = ref<Page | null>(null);
const updating = ref(false);
const deleting = ref(false);
const dialogDelete =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDelete");
const dialogRemoveBackground = useTemplateRef<InstanceType<typeof AppDialog>>(
  "dialogRemoveBackground",
);
const pageListMain = useTemplateRef<HTMLDivElement>("pageListMain");
const showBackgroundModal = ref(false);

watch(props, async (_val) => {
  getProfile();
});

watch(
  () => storage.pages,
  (pages) => {
    if (pages) {
      setProfile(storage);
    }
  },
);

const iconDrag = asyncComputed(async () => {
  return await getIconName("fa-grip-vertical");
});

const questionDeletePage = computed(() => {
  return t("customise_remote.pages.delete_page.question", {
    name: pageToDelete.value ? pageToDelete.value.name : "",
  });
});

async function getProfile() {
  if (props.activeProfile.profile_id) {
    try {
      setProfile(storage);
    } catch (e) {
      console.error(e);
    }
    pageToEditIndex.value = null;
  }
}

function setProfile(store: ProfileStore) {
  pages.value = deepClone(store.$state.pages);
}

function getImage(page: Page) {
  return ApiConnection.rest().resourceUrl(
    "BackgroundImage",
    page.image.replace(/^custom:/, ""),
  );
}

async function createNewPage() {
  if (newPageName.value.length < 1) {
    return false;
  }
  creatingNewPage.value = true;
  await sleep(1000);
  try {
    pages.value = await storage.createPage({
      name: newPageName.value,
    });
  } catch (e) {
    addErrorBottom(
      e,
      "customise_remote.pages.add",
      pageListMain.value ?? undefined,
    );
    getProfile();
  }
  resetCreating();
}

async function editPageName(index: number) {
  await sleep(10);
  pageToEditIndex.value = index;
  editedName.value = pages.value[index].name;
}

function changePageName(page: Page) {
  doChangePageName(page);
}

async function doChangePageName(page: Page) {
  if (editedName.value.length < 1) {
    return false;
  }
  savingName.value = true;
  if (pageToEditIndex.value != null) {
    pages.value[pageToEditIndex.value].name = editedName.value;
  }
  await sleep(1000);
  const newData = page;
  newData.name = editedName.value;
  try {
    await storage.updatePage({
      ...newData,
    });
  } catch (e) {
    addErrorBottom(
      e,
      "customise_remote.pages.update",
      pageListMain.value ?? undefined,
    );
    getProfile();
  }
  resetEdit();
}

async function duplicatePage(index: number) {
  const pageToDuplicate = pages.value[index];
  const newPage: NewPageData = {
    name: pageToDuplicate.name + " - copy",
    image: pageToDuplicate.image || "",
    items: pageToDuplicate.items || [],
  };

  try {
    pages.value = await storage.createPage(newPage);
    await sleep(1000);
  } catch (e) {
    addErrorBottom(
      e,
      "customise_remote.pages.add",
      pageListMain.value ?? undefined,
    );
  }
  getProfile();
}

function startDelete(index: number) {
  pageToDelete.value = pages.value[index];
  if (pageToDelete.value != null) {
    dialogDelete.value?.open();
  }
}

async function deletePage() {
  if (pageToDelete.value == null) {
    return false;
  }

  deleting.value = true;
  try {
    await storage.deletePage(pageToDelete.value as Page);
  } catch (e) {
    addErrorBottom(e);
  }
  deleting.value = false;
  getProfile();
}

function replaceBackground(index: number) {
  pageToEditBgIndex.value = index;
  showBackgroundModal.value = true;
}

function closeBackgroundModal() {
  pageToEditBgIndex.value = null;
  showBackgroundModal.value = false;
}

function startRemoveBackground(index: number) {
  pageToEditBgIndex.value = index;
  dialogRemoveBackground.value?.open();
}

async function removeBackground() {
  await doSelectImage();
}

async function doSelectImage(item?: ResourceItem) {
  if (pageToEditBgIndex.value == null) {
    return;
  }

  const modifiedPage = pages.value[pageToEditBgIndex.value];

  if (!modifiedPage) {
    return;
  }

  if (item) {
    modifiedPage.image = "custom:" + item.id; // Select background
  } else {
    modifiedPage.image = ""; // Remove background
  }

  updating.value = true;
  try {
    showBackgroundModal.value = false;
    await storage.updatePage(modifiedPage);
    await sleep(1000);
  } catch (e) {
    addErrorBottom(
      e,
      "customise_remote.pages.update",
      pageListMain.value ?? undefined,
    );
  }
  updating.value = false;
}

async function sortChange(_event: DragChangedEvent) {
  try {
    pages.value = await storage.updatePagesOrder(pages.value);
  } catch (e) {
    addErrorBottom(
      e,
      "customise_remote.pages.update",
      pageListMain.value ?? undefined,
    );
  }
}

function getPageItemDropdownItems(index: number): DropdownItem[] {
  const pageItem = pages.value[index];
  const hasBackground = pageItem && pageItem.image && pageItem.image.length > 0;

  const items: DropdownItem[] = [
    {
      icon: "fa-light fa-edit",
      label: "customise_remote.pages.options.edit_contents",
      value: "edit_contents",
    },
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
    {
      icon: "fa-light fa-clone",
      label: "customise_remote.pages.options.duplicate",
      value: "duplicate",
    },
    {
      icon: "fa-light fa-trash",
      label: "customise_remote.pages.options.delete",
      value: "delete",
    },
  ];

  if (hasBackground) {
    items.splice(3, 0, {
      icon: "fa-light fa-eye-slash",
      label: "customise_remote.pages.options.remove_background",
      value: "remove_background",
    });
  }

  return items;
}

function goTo(item: DropdownItem, index: number, pageId: string) {
  switch (item.value) {
    case "edit_contents":
      editPage(pageId);
      break;
    case "rename":
      editPageName(index);
      break;
    case "replace_background":
      replaceBackground(index);
      break;
    case "remove_background":
      startRemoveBackground(index);
      break;
    case "duplicate":
      duplicatePage(index);
      break;
    case "delete":
      startDelete(index);
      break;
    default:
      return false;
  }
}

function resetCreating() {
  if (addPage.value == false) {
    return;
  }

  creatingNewPage.value = false;
  addPage.value = false;
  newPageName.value = t("user_interface.pages.default_name");
}

function resetEdit() {
  savingName.value = false;
  pageToEditIndex.value = null;
  editedName.value = "";
}

function resetEditNewPage() {
  if (pageToEditIndex.value == -1) {
    resetEdit();
  }
}

function editPage(id: string) {
  emit("editPage", id);
}

function showPage(id: string) {
  emit("showPage", id);
}

onMounted(() => {
  getProfile();
});
</script>
<template>
  <div class="page-list">
    <Transition name="opacity-fast">
      <div
        v-show="pages.length > 0 || addPage == true"
        ref="pageListMain"
        class="page-list__main"
      >
        <div class="page-list__header">
          <h2>{{ $t("customise_remote.pages.your_pages") }}</h2>
          <button
            class="button button--secondary button--icon button--icon--medium"
            @click="addPage = true"
          >
            <i class="fa-regular fa-plus"></i>
          </button>
        </div>
        <div v-overflow-indicator class="page-list__body">
          <div
            v-if="addPage"
            v-click-outside="resetCreating"
            class="page-list-item page-list-item--editing"
          >
            <div class="page-list-item__background">
              <i class="fa-light fa-image"></i>
            </div>
            <div class="page-list-item__main">
              <Transition name="opacity-fast">
                <div
                  v-if="creatingNewPage == false"
                  v-click-outside="resetEditNewPage"
                  class="page-list-item__name-editor"
                >
                  <UCInput
                    v-model="newPageName"
                    :focus="true"
                    :select-on-focus="true"
                    :full-w="true"
                    @submit="createNewPage"
                    @on-esc="resetCreating"
                  />
                </div>
              </Transition>
            </div>
            <span v-if="creatingNewPage == true" class="page-list-item__saving">
              <img
                src="/images/loading-indicator-dark.png"
                alt="Loading"
                class="img-loading"
              />
            </span>
          </div>
          <Draggable
            v-if="pages && pages.length > 0"
            v-model="pages"
            item-key="pos"
            handle=".page-list-item__drag"
            :group="'customise-remote-pages'"
            :force-fallback="true"
            class="page-list__body__list"
            @change="sortChange"
          >
            <template #item="{ element, index }">
              <li
                class="page-list-item"
                :class="{
                  'page-list-item--editing':
                    index == pageToEditIndex && showBackgroundModal == false,
                }"
                @click="editPage(element.page_id)"
                @mouseover="showPage(element.page_id)"
              >
                <div class="page-list-item__background">
                  <LoadImage v-if="element.image" :url="getImage(element)" />
                  <i v-else class="fa-light fa-image"></i>
                </div>
                <div
                  class="page-list-item__main"
                  @click.stop="editPage(element.page_id)"
                >
                  <span class="page-list-item__main__title">
                    {{ element.name }}
                  </span>
                  <Transition name="opacity-fast">
                    <div
                      v-if="index == pageToEditIndex && savingName == false"
                      v-click-outside="resetEdit"
                      class="page-list-item__name-editor"
                    >
                      <UCInput
                        v-model="editedName"
                        :focus="true"
                        :select-on-focus="true"
                        :full-w="true"
                        @submit="changePageName(element)"
                        @on-esc="resetEdit"
                      />
                    </div>
                  </Transition>
                </div>
                <span class="page-list-item__options">
                  <DropdownMenu
                    :list-data="getPageItemDropdownItems(index)"
                    :icon="'fa-light fa-edit'"
                    :title="element.name"
                    :on-right="true"
                    @item-click="(item) => goTo(item, index, element.page_id)"
                  />
                </span>
                <span v-if="savingName == true" class="page-list-item__saving">
                  <img
                    src="/images/loading-indicator-dark.png"
                    alt="Loading"
                    class="img-loading"
                  />
                </span>
                <span class="page-list-item__drag">
                  <i v-if="iconDrag" class="fa-regular" :class="iconDrag"></i>
                </span>
              </li>
            </template>
          </Draggable>
        </div>
      </div>
    </Transition>
    <Transition name="opacity-fast">
      <div
        v-show="pages.length < 1 && addPage == false && !loading"
        class="page-list page-list__no-pages"
      >
        <h2>{{ $t("user_interface.no_pages.title") }}</h2>
        <p>{{ $t("user_interface.no_pages.description") }}</p>
        <button
          class="button button--primary button--hybrid button--hybrid--reversed"
          @click="addPage = true"
        >
          {{ $t("ui.add") }}
          <i class="fa-light fa-plus"></i>
        </button>
      </div>
    </Transition>
  </div>
  <AppDialog
    ref="dialogDelete"
    :title="$t('customise_remote.pages.delete_page.title')"
    :text="questionDeletePage"
    :submit-text="$t('ui.delete')"
    :cancel-text="$t('ui.cancel')"
    :disable-buttons="updating"
    @submit="deletePage"
  />
  <AppDialog
    ref="dialogRemoveBackground"
    :title="$t('customise_remote.pages.remove_background.title')"
    :text="$t('customise_remote.pages.remove_background.question')"
    :submit-text="$t('ui.remove')"
    :cancel-text="$t('ui.cancel')"
    :disable-buttons="deleting"
    @submit="removeBackground"
  />
  <Teleport to="body">
    <ModalSecondary
      :show="showBackgroundModal"
      :name="'background-modal'"
      :slide="true"
      class="modal-background-images"
      @close="closeBackgroundModal"
    >
      <ResourceList
        ref="resourceListIcon"
        :title="t('ui.background_images')"
        :allowed-types="['BackgroundImage']"
        :search-full-width="true"
        :in-modal="true"
        :active="showBackgroundModal"
        default-type="BackgroundImage"
        @close="closeBackgroundModal"
        @item-click="doSelectImage"
      />
    </ModalSecondary>
  </Teleport>
</template>
