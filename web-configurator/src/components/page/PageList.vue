<script setup lang="ts">
import { ref, watch, computed, onMounted, useTemplateRef } from "vue";
import { asyncComputed } from "@vueuse/core";
import { useTranslation } from "i18next-vue";

import { EntityType, FlashMessageInfoStatus } from "@/types/enums";
import type { DropdownItem } from "@/types/ui";
import type { ConfiguredEntity } from "@/types/integrationInstance";
import type {
  Activity,
  ActivityUserInterfaceItem,
  ActivityUserInterfacePage,
  NewActivityUserInterfacePage,
  IncludedEntity,
} from "@/types/activity";
import type { Remote } from "@/types/remote";
import type { Page } from "@/types/page";

type DragChangedEvent = {
  moved: {
    newIndex: number;
    oldIndex: number;
    element: Page;
  };
};

import { useTiming } from "@/composables/timing";
import { getIconName } from "@/composables/icon";

import { appStateStore } from "@/stores/appState";
import { addInfoFull, addErrorBottom } from "@/stores/messages";
import { activitiesStore } from "@/stores/activities";
import { remotesStore } from "@/stores/remotes";
import { integrationsStore } from "@/stores/integrations";

import Draggable from "vuedraggable";

import UCInput from "@/components/ui/UCInput.vue";
import DropdownMenu from "@/components/ui/DropdownMenu.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import translatedProperty from "@/composables/translatedProperty";
import { deepClone } from "@/composables/dataHelper";

const props = defineProps({
  entity: {
    type: Object,
    required: true,
  },
  entityType: {
    type: String,
    default: "activity",
  },
  loading: {
    type: Boolean,
    default: false,
  },
});
const emit = defineEmits(["editPage", "update", "hide"]);

const { t } = useTranslation();
const { sleep } = useTiming();

defineExpose({
  setAddPage,
  isSaving,
});

const basePageItemDropdownItems = [
  {
    icon: "fa-light fa-i-cursor",
    label: "user_interface.pages.options.rename",
    value: "rename",
  },
  {
    icon: "fa-light fa-clone",
    label: "user_interface.pages.options.copy",
    value: "copy",
  },
  {
    icon: "fa-light fa-arrow-rotate-left",
    label: "user_interface.pages.options.reset",
    value: "reset",
  },
  {
    icon: "fa-light fa-trash",
    label: "user_interface.pages.options.delete",
    value: "delete",
  },
] as DropdownItem[];

const appState = appStateStore();
const activitiesStorage = activitiesStore();
const remotesStorage = remotesStore();
const integrationsStorage = integrationsStore();

const pages = ref<ActivityUserInterfacePage[]>([]);
const pageToEditIndex = ref<number | null>(null);

const newPageName = ref(t("user_interface.pages.default_name"));
const editedName = ref("");
const addPage = ref(false);
const creatingNewPage = ref(false);
const savingName = ref(false);
const pageToResetIndex = ref<number | null>(null);
const pageToDelete = ref<ActivityUserInterfacePage | null>(null);
const deleting = ref(false);
const dialogReset =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogReset");
const dialogResetUI =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogResetUI");
const dialogDelete =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDelete");
const dialogMissingEntity = useTemplateRef<InstanceType<typeof AppDialog>>(
  "dialogMissingEntity",
);
const pageListMain = useTemplateRef<HTMLDivElement>("pageListMain");

const allEntities = ref<ConfiguredEntity[]>([]);
const missingEntitiesIDs = ref<string[]>([]);

const saving = ref(false);

watch(props, async (val) => {
  const ui = val.entity?.options?.user_interface;
  pages.value = Array.isArray(ui?.pages) ? ui.pages : [];
  handlePageNames();
});

const iconDrag = asyncComputed(async () => {
  return await getIconName("fa-grip-vertical");
});

const questionResetPage = computed(() => {
  return t("user_interface.pages.reset_page.question", {
    name:
      pageToResetIndex.value != null && pages.value[pageToResetIndex.value]
        ? pages.value[pageToResetIndex.value].name
        : "",
  });
});

const questionDeletePage = computed(() => {
  return t("customise_remote.pages.delete_page.question", {
    name: pageToDelete.value ? pageToDelete.value.name : "",
  });
});

const questionMissingEntity = computed(() => {
  let names = "";
  missingEntitiesIDs.value.forEach((id) => {
    const entData = allEntities.value.find((e) => e.entity_id === id);
    if (names.length > 2) {
      names += ", ";
    }

    names += translatedProperty(entData?.name) || "";
  });

  return t("entity.missing_entity.question_page", {
    entities: `${names.replace(/[,\s]+$/g, "")}`,
    count: missingEntitiesIDs.value.length,
  });
});

async function getEntity() {
  try {
    if (props.entityType == EntityType.activity) {
      await activitiesStorage.getActivity(props.entity.entity_id);
    } else if (props.entityType == EntityType.remote) {
      await remotesStorage.getRemote(props.entity.entity_id);
    }
  } catch (e) {
    addErrorBottom(e);
  }
}

function handlePageNames() {
  for (const page of pages.value) {
    if (!page.name) {
      page.name = "New page";
    }
  }
}

function submitPageName() {
  createNewPage();
}

async function createNewPage(
  copiedItem: NewActivityUserInterfacePage | null = null,
) {
  const copying = copiedItem != null;
  if (newPageName.value.length < 1 && copiedItem == null) {
    return false;
  }

  creatingNewPage.value = true;
  copying && addInfoFull(FlashMessageInfoStatus.SAVING);
  await sleep(1000);
  saving.value = true;

  try {
    const oldids = pages.value.map((page) => {
      return page.page_id;
    });

    const newItem =
      copiedItem != null && copiedItem.name
        ? copiedItem
        : ({
            name: newPageName.value,
            items: [],
          } as NewActivityUserInterfacePage);

    let newValue;

    if (props.entityType == EntityType.activity) {
      newValue = await activitiesStorage.addUiPage(
        props.entity as Activity,
        newItem,
      );
    } else if (props.entityType == EntityType.remote) {
      newValue = await remotesStorage.addUiPage(
        props.entity as Remote,
        newItem,
      );
    }

    resetCreating();
    await getEntity();

    copying && addInfoFull(FlashMessageInfoStatus.SUCCESS);
    emit("update");

    if (newValue && Object.keys(newValue).length > 1) {
      const newPageList = (newValue as Activity).options?.user_interface
        ?.pages as ActivityUserInterfacePage[];
      const created = newPageList.find((item) => {
        return !oldids.includes(item.page_id);
      });

      if (created) {
        await sleep(200);
        editPage(created.page_id);
      }
    }
  } catch (e) {
    addErrorBottom(
      e,
      "user_interface.pages.update",
      pageListMain.value ?? undefined,
    );
  }
  saving.value = false;
  resetCreating();
}

async function editPageName(index: number) {
  await sleep(10);
  pageToEditIndex.value = index;

  if (pages.value[index] && pages.value[index].name) {
    editedName.value = pages.value[index].name ?? "";
  }
}

function changePageName(page: ActivityUserInterfacePage) {
  doChangePageName(page);
}

async function doChangePageName(page: ActivityUserInterfacePage) {
  if (editedName.value.length < 1) {
    return false;
  }

  savingName.value = true;
  if (pageToEditIndex.value != null) {
    pages.value[pageToEditIndex.value].name = editedName.value;
  }
  await sleep(1000);
  saving.value = true;

  try {
    if (props.entityType == EntityType.activity) {
      await activitiesStorage.updateUiPage(props.entity.entity_id, {
        page_id: page.page_id,
        name: editedName.value,
      });
    } else if (props.entityType == EntityType.remote) {
      await remotesStorage.updateUiPage(props.entity.entity_id, {
        page_id: page.page_id,
        name: editedName.value,
      });
    }
    resetEdit();
  } catch (e) {
    addErrorBottom(
      e,
      "user_interface.pages.update",
      pageListMain.value ?? undefined,
    );

    editedName.value = "";
    savingName.value = false;
    pageToEditIndex.value = null;
  }
  savingName.value = false;
  saving.value = false;
  emit("update");
}

async function copyPage(index: number) {
  const pg = pages.value[index];

  if (props.entityType == EntityType.activity) {
    appState.setClipboard(pg, "activity", "page");
  } else if (props.entityType == EntityType.remote) {
    appState.setClipboard(pg, "remote", "page");
  }
}

function startResetUI() {
  dialogResetUI.value?.open();
}

function startResetPage(index: number) {
  pageToResetIndex.value = index;
  dialogReset.value?.open();
}

async function resetPage() {
  if (pageToResetIndex.value == null) {
    return false;
  }

  const pageToReset = pages.value[
    pageToResetIndex.value
  ] as ActivityUserInterfacePage;

  if (!pageToReset) {
    return false;
  }

  addInfoFull(FlashMessageInfoStatus.SAVING);
  await sleep(1000);
  saving.value = true;

  try {
    if (props.entityType == EntityType.activity) {
      await activitiesStorage.updateUiPage(props.entity.entity_id, {
        ...pageToReset,
        items: [],
      });
    } else if (props.entityType == EntityType.remote) {
      await remotesStorage.updateUiPage(props.entity.entity_id, {
        ...pageToReset,
        items: [],
      });
    }

    await getEntity();
    addInfoFull(FlashMessageInfoStatus.SUCCESS);
    emit("update");
  } catch (e) {
    addErrorBottom(
      e,
      "user_interface.pages.update",
      pageListMain.value ?? undefined,
    );
  }

  saving.value = false;
}

async function resetUI() {
  addInfoFull(FlashMessageInfoStatus.SAVING);
  await sleep(1000);
  saving.value = true;

  try {
    if (props.entityType == EntityType.activity) {
      await activitiesStorage.allUiReset(props.entity.entity_id);
    } else if (props.entityType == EntityType.remote) {
      await remotesStorage.allUiReset(props.entity.entity_id);
    }

    await getEntity();
    addInfoFull(FlashMessageInfoStatus.SUCCESS);
    emit("update");
  } catch (e) {
    addErrorBottom(
      e,
      "user_interface.pages.update",
      pageListMain.value ?? undefined,
    );
  }
  saving.value = false;
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
  addInfoFull(FlashMessageInfoStatus.SAVING);
  await sleep(1000);
  saving.value = true;
  const pageId = pageToDelete.value.page_id;

  if (!pageId) {
    return false;
  }

  try {
    if (props.entityType == EntityType.activity) {
      await activitiesStorage.deleteUiPage(props.entity.entity_id, pageId);
    } else if (props.entityType == EntityType.remote) {
      await remotesStorage.deleteUiPage(props.entity.entity_id, pageId);
    }

    await getEntity();
    if (pages.value && pages.value.length > 0) {
      editPage(pages.value[0].page_id);
    }
    addInfoFull(FlashMessageInfoStatus.SUCCESS);
  } catch (e) {
    addErrorBottom(
      e,
      "user_interface.pages.update",
      pageListMain.value ?? undefined,
    );
  }
  deleting.value = false;
  saving.value = false;
  emit("update");
}

async function sortChange(_event: DragChangedEvent) {
  saving.value = true;
  try {
    if (props.entityType == EntityType.activity) {
      await activitiesStorage.updatePagesOrder(
        props.entity as Activity,
        pages.value,
      );
    } else if (props.entityType == EntityType.remote) {
      await remotesStorage.updatePagesOrder(
        props.entity as Remote,
        pages.value,
      );
    }

    await getEntity();
    emit("update");
  } catch (e) {
    addErrorBottom(
      e,
      "user_interface.pages.update",
      pageListMain.value ?? undefined,
    );
  }
  saving.value = false;
}

function goTo(item: DropdownItem, index: number, _pageId: string) {
  switch (item.value) {
    case "rename":
      editPageName(index);
      break;
    case "copy":
      copyPage(index);
      break;
    case "reset":
      startResetPage(index);
      break;
    case "delete":
      startDelete(index);
      break;
    default:
      return false;
  }
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

function resetCreating() {
  if (addPage.value == false) {
    return;
  }

  creatingNewPage.value = false;
  addPage.value = false;
  newPageName.value = t("user_interface.pages.default_name");
}

function editPage(id: string) {
  emit("editPage", id);
}

function getPageItemDropdownItems(item: ActivityUserInterfacePage) {
  const dropdownItems = deepClone(basePageItemDropdownItems);
  if (props.entityType == EntityType.activity) {
    let hasDanglingEntity = false;
    const danglingEntities = (props.entity.options?.included_entities ?? [])
      .filter((e: IncludedEntity) => e.available === false)
      .map((e: IncludedEntity) => {
        return e.entity_id;
      });

    item.items.forEach((i) => {
      if (danglingEntities.includes(i.command?.entity_id)) {
        hasDanglingEntity = true;
      }
    });

    if (hasDanglingEntity) {
      const copyItemIndex = dropdownItems.findIndex(
        (i: DropdownItem) => i.value == "copy",
      );

      if (copyItemIndex > -1) {
        dropdownItems[copyItemIndex] = {
          ...dropdownItems[copyItemIndex],
          disabled: true,
          description: t("user_interface.pages.non_existent_entities"),
        };
      }
    }
  }

  return dropdownItems;
}

async function startPastePage() {
  if (props.entityType == EntityType.activity) {
    const pageToPaste = JSON.parse(
      JSON.stringify(appState.$state.clipboard.activity.page),
    );

    // Check entities availability
    const entitiesIDsFromPage = (pageToPaste.items ?? [])
      .map((item: ActivityUserInterfaceItem) => item.command?.entity_id)
      .filter((id: string | undefined): id is string => !!id);

    const uniqueEntitiesIDsFromPage = [
      ...new Set(entitiesIDsFromPage),
    ] as string[];
    const includedEntitiesIDs = (
      props.entity.options?.included_entities ?? []
    ).map((item: IncludedEntity) => item.entity_id);
    missingEntitiesIDs.value = uniqueEntitiesIDsFromPage.filter(
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
      const pageToPaste = JSON.parse(
        JSON.stringify(appState.$state.clipboard.activity.page),
      );
      pastePage(pageToPaste);
    }
  } else if (props.entityType == EntityType.remote) {
    const pageToPaste = JSON.parse(
      JSON.stringify(appState.$state.clipboard.remote.page),
    );
    const itemsLength = pageToPaste.items.length;

    // Check commands availability
    const commandsIDsFromPage = (pageToPaste.items ?? [])
      .map((item: ActivityUserInterfaceItem) => item.command?.cmd_id)
      .filter((id: string | undefined): id is string => !!id);

    const uniqueCommandsIDsFromPage = [
      ...new Set(commandsIDsFromPage),
    ] as string[];
    const includedCommandsIDs = (
      props.entity.options.simple_commands ?? []
    ).map((cmd: string) => cmd);
    const missingCommandsIDs =
      uniqueCommandsIDsFromPage.filter(
        (id) => !includedCommandsIDs.includes(id),
      ) || [];

    const itemsToPaste = (pageToPaste.items ?? []).filter(
      (item: ActivityUserInterfaceItem) => {
        const cmdId = item.command?.cmd_id;
        return cmdId && !missingCommandsIDs.includes(cmdId);
      },
    );

    if (pageToPaste.items) {
      pageToPaste.items = itemsToPaste;
    }

    await pastePage(pageToPaste);

    if (itemsToPaste.length < itemsLength) {
      await sleep(2000);
      addErrorBottom(
        t("customise_remote.pages.paste.errors.not_fully_completed"),
      );
    }
  }
}

async function pastePage(page: NewActivityUserInterfacePage) {
  const pageToPaste = page;

  if (!pageToPaste) {
    return false;
  }

  delete pageToPaste.page_id;
  await createNewPage(pageToPaste);
  missingEntitiesIDs.value = [];
}

async function addMissingEntities() {
  if (!props.entity) {
    return;
  }

  const includedEntitiesIDs = (
    props.entity.options?.included_entities ?? []
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
    (await activitiesStorage.update(
      props.entity.entity_id,
      newValues,
    )) as Activity;

    const pageToPaste = JSON.parse(
      JSON.stringify(appState.$state.clipboard.activity.page),
    );
    await pastePage(pageToPaste);
    emit("update");
  } catch (e) {
    addErrorBottom(e);
  }
  saving.value = false;
}

function setAddPage(val: boolean) {
  addPage.value = val;
}

function hideList() {
  emit("hide");
}

function isSaving() {
  return saving.value;
}

onMounted(() => {
  pages.value = props.entity.options?.user_interface?.pages || [];
  handlePageNames();
});
</script>
<template>
  <div class="page-list page-list--entity">
    <Transition name="opacity-fast">
      <div
        v-show="pages.length > 0 || addPage == true"
        ref="pageListMain"
        class="page-list__main"
      >
        <div class="page-list__header">
          <span class="page-list__header__nav">
            <button class="button button--blank button--icon" @click="hideList">
              <i class="fa-light fa-arrow-left"></i>
            </button>
            <h4>{{ $t("user_interface.edit_pages") }}</h4>
          </span>
          <span class="page-list__header__intro">
            {{ $t(`${entityType}.user_interface.intro`) }}
          </span>
          <div class="page-list__header__buttons">
            <button
              :title="$t('ui.add')"
              class="button button--secondary button--icon"
              @click="addPage = true"
            >
              <i class="fa-light fa-plus"></i>
            </button>
            <button
              v-if="
                (entityType == EntityType.activity &&
                  appState.$state.clipboard.activity.page) ||
                (entityType == EntityType.remote &&
                  appState.$state.clipboard.remote.page)
              "
              :title="$t('ui.paste')"
              class="button button--secondary button--icon"
              @click="startPastePage"
            >
              <i class="fa-light fa-paste"></i>
            </button>
            <button
              :title="$t('ui.reset_all')"
              class="button button--secondary button--icon button-reset-ui"
              @click="startResetUI"
            >
              <i class="fa-light fa-arrow-rotate-left"></i>
            </button>
          </div>
        </div>
        <div v-overflow-indicator class="page-list__body">
          <div
            v-if="addPage"
            v-click-outside="resetCreating"
            class="page-list-item page-list-item--editing"
          >
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
                    @submit="submitPageName"
                    @on-esc="resetCreating"
                  />
                </div>
              </Transition>
            </div>
            <span v-if="creatingNewPage == true" class="page-list-item__saving">
              <img
                src="/images/loading-indicator.png"
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
                :class="{ 'page-list-item--editing': index == pageToEditIndex }"
                @click="editPage(element.page_id)"
              >
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
                <div class="page-list-item__options">
                  <DropdownMenu
                    :list-data="getPageItemDropdownItems(element)"
                    :icon="'fa-regular fa-edit'"
                    :title="element.name"
                    :on-right="true"
                    @item-click="(item) => goTo(item, index, element.page_id)"
                  />
                </div>
                <span v-if="savingName == true" class="page-list-item__saving">
                  <img
                    src="/images/loading-indicator.png"
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
          class="button button--secondary button--hybrid button--hybrid--reversed"
          @click="addPage = true"
        >
          {{ $t("ui.add") }}
          <i class="fa-light fa-plus"></i>
        </button>
      </div>
    </Transition>
  </div>
  <AppDialog
    ref="dialogReset"
    :title="$t('user_interface.pages.reset_page.title')"
    :text="questionResetPage"
    :submit-text="$t('ui.reset')"
    :cancel-text="$t('ui.cancel')"
    @submit="resetPage"
  />
  <AppDialog
    ref="dialogResetUI"
    :title="$t('user_interface.pages.reset_ui.title')"
    :text="$t('user_interface.pages.reset_ui.question')"
    :submit-text="$t('ui.reset')"
    :cancel-text="$t('ui.cancel')"
    @submit="resetUI"
  />
  <AppDialog
    ref="dialogDelete"
    :title="$t('customise_remote.pages.delete_page.title')"
    :text="questionDeletePage"
    :submit-text="$t('ui.delete')"
    :cancel-text="$t('ui.cancel')"
    :disable-buttons="deleting"
    @submit="deletePage"
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
