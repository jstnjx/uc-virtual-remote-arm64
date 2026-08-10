<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from "vue";
import type { Page } from "@/types/page";
import type { SelectOption } from "@/types/ui";
import type {
  ConfiguredEntity,
  IntegrationInstance,
} from "@/types/integrationInstance";
import type { Group } from "@/types/group";

import type { IncludedEntity } from "@/types/activity";

import { appStateStore } from "@/stores/appState";
import { profileStore } from "@/stores/profile";
import type { ProfileStore } from "@/stores/profile";
import { integrationsStore } from "@/stores/integrations";
import { messagesStore, addErrorBottom } from "@/stores/messages";

import UCSelect from "@/components/ui/UCSelect.vue";
import CustomiseRemoteAddEntities from "@/components/customise-remote/CustomiseRemoteAddEntities.vue";
import CustomiseRemoteAddGroups from "@/components/customise-remote/CustomiseRemoteAddGroups.vue";

const props = defineProps({
  activeProfile: {
    type: Object,
    required: true,
  },
  activePageId: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["editPage", "editOption"]);

const appState = appStateStore();
const storage = profileStore();
const integrationStorage = integrationsStore();
const msgStore = messagesStore();
const pages = ref<Page[]>([]);

const activePage = ref<Page>();

// const allEntities = ref<ConfiguredEntity[]>([]);
const filteredEntities = computed<ConfiguredEntity[]>(
  () => integrationStorage.configuredIntegrationEntities,
);
const selectedEntities = ref<IncludedEntity[]>([]);
const instances = computed<IntegrationInstance[]>(
  () => integrationStorage.instances,
);

const activeOptionItem = ref({ label: "", value: "" });
const activeNotiMessage = computed(() => msgStore.message != null);
const showAddEntities = ref(false);
const showAddGroups = ref(false);
const pageSelectOpened = ref(false);

const elAddEntities =
  useTemplateRef<InstanceType<typeof CustomiseRemoteAddEntities>>(
    "elAddEntities",
  );

defineExpose({
  reloadEntityList,
});

watch(props, async (val) => {
  if (val && val.activePageId && val.activePageId.length > 0) {
    getProfile();
  } else {
    exitEdit();
  }
});

watch(showAddEntities, async (val) => {
  emit("editOption", val == true ? "add-entities" : "");
});

watch(showAddGroups, async (val) => {
  emit("editOption", val == true ? "add-groups" : "");
});

watch(
  () => storage.pages,
  (pages) => {
    if (pages) {
      setPageData(storage);
    }
  },
);

const pageList = computed(() => {
  return pages.value.map((page) => ({
    value: page.page_id,
    label: page.name,
  }));
});

async function getProfile() {
  if (props.activeProfile.profile_id) {
    try {
      setPageData(storage);
    } catch (e) {
      console.error(e);
    }
  }
}

function setPageData(store: ProfileStore) {
  pages.value = store.$state.pages;
  if (props.activePageId && props.activePageId != null) {
    activePage.value = pages.value.find((p) => p.page_id == props.activePageId);

    if (activePage.value) {
      activeOptionItem.value = {
        label: activePage.value?.name,
        value: activePage.value?.page_id,
      };
    }

    selectedEntities.value = activePage.value?.items.filter((item) => {
      return item.entity_id;
    }) as IncludedEntity[];
  }
}

async function addItemsToPage(items: ConfiguredEntity[] | Group[]) {
  if (!activePage.value) {
    return;
  }

  const newPageItems = JSON.parse(
    JSON.stringify(activePage.value.items),
  ).concat(items);

  const modifiedPage = {
    ...activePage.value,
    items: newPageItems.map((item: any, index: number) => {
      return {
        entity_id: item.entity_id,
        group_id: item.group_id,
        pos: index + 1,
      };
    }),
  };

  try {
    await storage.updatePage(modifiedPage as Page);

    if (items.length > 0) {
      if ("entity_id" in items[0] && elAddEntities.value) {
        reloadEntityList();
      }
    }
  } catch (e) {
    addErrorBottom(e, "customise_remote.pages.add");
  }
}

function exitEdit() {
  emit("editPage", null);
  showAddEntities.value = false;
  showAddGroups.value = false;
  pageSelectOpened.value = false;
}

function onActivePageUpdate(item: SelectOption) {
  emit("editPage", item.value);
}

function uCselectOpened(message: boolean) {
  pageSelectOpened.value = message;
}

function reloadEntityList() {
  elAddEntities.value?.loadData();
}

onMounted(async () => {
  getProfile();
  try {
    await integrationStorage.getInstances();
  } catch (e) {
    addErrorBottom(e);
  }

  // try {
  //   allEntities.value = await integrationStorage.getConfiguredEntities(null, true);
  // } catch (error) {
  //   console.error(error);
  // }

  try {
    await integrationStorage.pagedUpdateConfiguredEntityLists("", true);
  } catch (error) {
    console.error(error);
  }
});
</script>
<template>
  <div class="customise-remote-options">
    <div class="customise-remote-options__main">
      <div class="customise-remote-options__header">
        <button
          class="button button--blank button--icon button--icon--medium customise-remote-options__back--desktop"
          @click="exitEdit"
        >
          <i class="fa-regular fa-arrow-left"></i>
        </button>
        <Teleport to="body">
          <button
            v-if="activePageId && !activeNotiMessage"
            class="button button--secondary button--icon customise-remote-options__back--mobile"
            :class="{
              'customise-remote-options__back--mobile--in-background':
                appState.activeDropdown,
            }"
            @click="exitEdit"
          >
            <i class="fa-regular fa-arrow-left"></i>
          </button>
        </Teleport>

        <div class="customise-remote-options__page-select--desktop">
          <UCSelect
            v-model="activeOptionItem"
            :options="pageList"
            @select="onActivePageUpdate"
          />
        </div>
        <Teleport to="body">
          <div
            v-if="activePageId"
            class="customise-remote-options__page-select--mobile"
            :class="{
              'customise-remote-options__page-select--mobile--in-background':
                appState.activeDropdown,
            }"
            :style="pageSelectOpened ? 'z-index:1205;' : ''"
          >
            <UCSelect
              v-model="activeOptionItem"
              :options="pageList"
              :position="'center'"
              @select="onActivePageUpdate"
              @opened="uCselectOpened"
            />
          </div>
        </Teleport>
      </div>

      <p>{{ $t("customise_remote.options.description") }}</p>
      <p>{{ $t("customise_remote.options.description_options") }}</p>

      <div class="customise-remote-options__list">
        <button
          class="button button--secondary"
          @click="showAddEntities = true"
        >
          <img
            src="/images/customise-remote/add-entities.png"
            alt="Add entities"
          />
          <span>{{ $t("customise_remote.options.list.add_entities") }}</span>
        </button>
        <button class="button button--secondary" @click="showAddGroups = true">
          <img src="/images/customise-remote/add-groups.png" alt="Add groups" />
          <span>{{ $t("customise_remote.options.list.add_groups") }}</span>
        </button>
        <!-- <button class="button button--secondary">
          <img src="/images/customise-remote/configure-buttons.png" alt="Configure buttons">
          <span>{{ $t("customise_remote.options.list.configure_buttons") }}</span>
        </button> -->
      </div>
    </div>
    <div class="customise-remote-options__footer">
      <p>{{ $t("customise_remote.options.rearrange_items") }}</p>
    </div>
    <Transition name="slide">
      <CustomiseRemoteAddEntities
        v-show="showAddEntities"
        ref="elAddEntities"
        :show="showAddEntities"
        :filtered-entities="filteredEntities"
        :selected-entities="selectedEntities"
        :page-id="activePageId"
        :instances="instances"
        @add-to-page="addItemsToPage"
        @close="showAddEntities = false"
      />
    </Transition>
    <Transition name="slide">
      <CustomiseRemoteAddGroups
        v-show="showAddGroups"
        :show="showAddGroups"
        :page="activePage"
        @add-to-page="addItemsToPage"
        @close="showAddGroups = false"
      />
    </Transition>
  </div>
</template>
