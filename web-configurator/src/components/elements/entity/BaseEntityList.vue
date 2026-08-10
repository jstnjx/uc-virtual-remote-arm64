<script setup lang="ts">
import {
  ref,
  watch,
  computed,
  onMounted,
  getCurrentInstance,
  useTemplateRef,
} from "vue";
import { useTranslation } from "i18next-vue";

import ApiConnection from "@/api";

import type { Headers, PaginationMeta } from "@/types/rest";
import type {
  ConfiguredEntity,
  IntegrationInstance,
} from "@/types/integrationInstance";
import type { Remote } from "@/types/remote";
import type { EntityType } from "@/types/enums";

import { integrationsStore } from "@/stores/integrations";
import { remotesStore } from "@/stores/remotes";
import { addErrorBottom } from "@/stores/messages";

import { getPaginationLimit, readPaginationMeta } from "@/composables/listing";

import AppDialog from "@/components/elements/AppDialog.vue";
import BaseEntityListItem from "@/components/elements/entity/BaseEntityListItem.vue";
import ListPaging from "@/components/ui/ListPaging.vue";

const integrationsApi = ApiConnection.integrations;

type AssignedEntity = {
  entity_id: string;
  entity_type: EntityType;
};

const { i18next } = useTranslation();

const integrationsStorage = integrationsStore();
const remotesStorage = remotesStore();

defineExpose({
  startDelete,
  clearAssignedEntities,
});

const emit = defineEmits(["loaded", "assignedEntities"]);

const props = defineProps({
  searchText: {
    type: String,
    default: "",
  },
  filterEntityTypes: {
    type: String,
    default: "",
  },
  filterInstances: {
    type: String,
    default: "",
  },
  filterRemoteType: {
    type: String,
    default: "",
  },
  pagination: {
    type: Object,
    default: () => ({}),
  },
});

const assignedEntities = ref<AssignedEntity[]>([]);
const fetching = ref(false);

// Pushed to the parent rather than pulled from it: reading this off the
// component instance made the parent's render depend on the instance, so a list
// that failed to mount re-triggered that render on every retry and the page
// locked up in a re-mount loop.
watch(
  () => assignedEntities.value.length > 0,
  (any) => emit("assignedEntities", any),
);

const isRemoteType = computed(() => {
  return props.filterRemoteType.length > 0;
});

const instances = computed<IntegrationInstance[]>(
  () => integrationsStorage.instances,
);

// Render directly from the store's page state — WS events update entries in
// place and Vue's fine-grained reactivity re-renders only the affected rows.
// The former $subscribe + sleep(1000) + objectsDeepEqual reconciliation (and
// its full-page JSON clones) is gone (REVIEW-Claude-ws-events.md P0-3).
const configuredEntities = computed<ConfiguredEntity[] | Remote[]>(() =>
  isRemoteType.value
    ? remotesStorage.remotesByPage.remotes
    : integrationsStorage.configuredEntitiesByPage.configuredEntities,
);

const pagination = ref<PaginationMeta>(
  Object.keys(props.pagination).length > 0
    ? (props.pagination as PaginationMeta)
    : { limit: getPaginationLimit() ?? 20, page: 1 },
);

/**
 * What `ListPaging` renders: the view owns page and limit, the store owns the
 * server's total — so a refetch the view never made (the WS-event reloads)
 * still moves the footer (#685). Read from whichever store this list is
 * showing, the same split as `configuredEntities` above.
 */
const paging = computed<PaginationMeta>(() => ({
  ...pagination.value,
  count: isRemoteType.value
    ? remotesStorage.remotesByPage.count
    : integrationsStorage.configuredEntitiesByPage.count,
}));

const dialogDelete =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDelete");
const instance = getCurrentInstance() || {
  uid: Math.floor(Math.random() * (999999 - 100000 + 1)) + 100000,
};

const currentSearchText = ref("");
const currentFilterEntityTypes = ref("");

const hasEntity = ref(true);

watch(
  () => ({
    filterRemoteType: props.filterRemoteType,
    searchText: props.searchText,
    filterEntityTypes: props.filterEntityTypes,
  }),
  async (val, oldVal) => {
    if (
      val.filterRemoteType !== oldVal.filterRemoteType ||
      val.searchText !== currentSearchText.value ||
      val.filterEntityTypes !== currentFilterEntityTypes.value
    ) {
      fetching.value = true;
      pagination.value.page = 1;
    }

    currentSearchText.value = val.searchText;
    currentFilterEntityTypes.value = val.filterEntityTypes;

    await fetchEntities();
  },
);

watch(configuredEntities, () => {
  if (configuredEntities.value.length < 1 && pagination.value.page > 1) {
    changePage(pagination.value.page - 1);
  }
});

async function fetchEntities() {
  fetching.value = true;

  try {
    let entList = {} as {
      data: { configuredEntities?: ConfiguredEntity[]; remotes?: Remote[] };
      headers: object;
    };

    if (isRemoteType.value) {
      entList = await remotesStorage.getRemotesByPageByLimit(
        props.filterRemoteType,
        false,
        pagination.value.page,
        pagination.value.limit,
        props.searchText,
      );
    } else {
      entList = await integrationsStorage.getConfiguredEntitiesByPageByLimit(
        props.filterInstances,
        false,
        pagination.value.page,
        pagination.value.limit,
        props.searchText,
        props.filterEntityTypes,
      );
    }

    // The list itself renders from the store (configuredEntities computed);
    // this only maintains pagination metadata from the response headers.
    if (entList && entList.data) {
      const actiHeaders = entList.headers as Headers;
      if (actiHeaders) {
        pagination.value = readPaginationMeta(
          actiHeaders,
          pagination.value.limit,
        );
      }
    }

    emit("loaded", paging.value);
  } catch (e) {
    addErrorBottom(e);
  }
  fetching.value = false;
}

watch(
  () => paging.value.count,
  async (count) => {
    if (isRemoteType.value) return;

    if (
      count == 0 &&
      props.searchText.length == 0 &&
      props.filterEntityTypes ==
        "button,climate,cover,light,media_player,sensor,switch,remote" &&
      props.filterInstances.length == 0
    ) {
      hasEntity.value = false;
    } else if (count == 0) {
      const entityNumber = await integrationsApi.getConfiguredEntityNumber();
      hasEntity.value = entityNumber > 0;
    } else {
      hasEntity.value = true;
    }
  },
);

function isAssignedItem(entity: ConfiguredEntity | Remote) {
  return (
    assignedEntities.value.findIndex(
      (item: AssignedEntity) => item.entity_id === entity.entity_id,
    ) > -1
  );
}

function toggleItemCheckbox(entity: ConfiguredEntity | Remote) {
  const itemIndex = assignedEntities.value.findIndex(
    (item: AssignedEntity) => item.entity_id === entity.entity_id,
  );
  if (itemIndex > -1) {
    assignedEntities.value.splice(itemIndex, 1);
  } else {
    if (isRemoteType.value == true) {
      assignedEntities.value.push(entity as Remote);
    } else {
      assignedEntities.value.push(entity as ConfiguredEntity);
    }
  }
}

function startDelete() {
  dialogDelete.value?.open();
}

async function deleteItems() {
  if (assignedEntities.value.length < 1) {
    return;
  }

  const entityIDs = assignedEntities.value
    .filter((entity: AssignedEntity) => entity.entity_type != "remote")
    .map((entity: AssignedEntity) => entity.entity_id);

  const remoteList = assignedEntities.value.filter(
    (entity: AssignedEntity) => entity.entity_type === "remote",
  );

  if (entityIDs.length > 0) {
    try {
      await integrationsStorage.removeEntities(entityIDs);
      clearAssignedEntities();
    } catch (e) {
      addErrorBottom(e);
    }
  }

  if (remoteList.length > 0) {
    try {
      // Due to lack of mass deletion
      for (const remote of remoteList) {
        try {
          await remotesStorage.delete(remote as Remote);
        } catch (e) {
          addErrorBottom(e);
        }
      }
      clearAssignedEntities();
    } catch (e) {
      addErrorBottom(e);
    }
  }
}

function clearAssignedEntities() {
  assignedEntities.value = [];
}

function changePage(value: number) {
  pagination.value.page = value;
  fetchEntities();
}

function changePerPage(value: number) {
  pagination.value.page = 1;
  pagination.value.limit = value;
  fetchEntities();
}

onMounted(async () => {
  fetchEntities();
  try {
    // populates the store; the `instances` computed picks it up reactively
    await integrationsStorage.getInstances();
  } catch (e) {
    addErrorBottom(e);
  }
});
</script>
<template>
  <div class="base-entity-list base-entity-list--compact-items">
    <div v-overflow-indicator class="base-entity-list__body-wrapper">
      <!-- Stays mounted during refreshes: unmounting 20 items per fetch caused
           visible flicker and lost scroll position (ws-events review P0-3b) -->
      <div
        v-if="configuredEntities.length > 0"
        class="base-entity-list__body"
        :class="{
          'base-entity-list__body--not-full':
            pagination.limit > configuredEntities.length,
        }"
      >
        <BaseEntityListItem
          v-for="element in configuredEntities"
          :key="element.entity_id"
          :list-item="element"
          :instances="instances"
          :compact="true"
          :in-category-list="isRemoteType"
        >
          <template #checkbox>
            <div
              class="form-item form-item--checkbox-tick entity-item__checkbox-tick"
            >
              <input
                :id="`${instance.uid}-${element.entity_id}-checkbox-tick`"
                type="checkbox"
                :checked="isAssignedItem(element)"
              />
              <label
                class="toggle"
                :for="`${instance.uid}-${element.entity_id}-checkbox-tick`"
              />
              <button
                class="button--toggle-tick"
                @click.stop="toggleItemCheckbox(element)"
              ></button>
            </div>
          </template>
        </BaseEntityListItem>
      </div>
      <p
        v-else-if="!fetching && !isRemoteType && hasEntity"
        class="ent-list__description"
      >
        {{ $t("ui.nothing_was_found") }}
      </p>
      <p v-else-if="!fetching && !isRemoteType" class="ent-list__description">
        {{ $t("entity.no_entity") }}
      </p>
      <p v-else-if="!fetching && isRemoteType" class="ent-list__description">
        {{
          i18next.exists(`entity.no_${filterRemoteType.toLowerCase()}`)
            ? $t(`entity.no_${filterRemoteType.toLowerCase()}`)
            : $t("entity.no_entity")
        }}
      </p>
    </div>
    <div class="base-entity-list__footer">
      <ListPaging
        v-if="configuredEntities && configuredEntities.length > 0"
        :pagination="paging"
        :length="configuredEntities.length"
        @change-page="changePage"
        @change-per-page="changePerPage"
      />
    </div>
    <AppDialog
      ref="dialogDelete"
      :title="
        assignedEntities.length > 1
          ? $t('entity.delete_entities.title')
          : $t('entity.delete_entity.title')
      "
      :text="
        assignedEntities.length > 1
          ? $t('entity.delete_entities.question')
          : $t('entity.delete_entity.question')
      "
      :submit-text="$t('ui.delete')"
      :cancel-text="$t('ui.cancel')"
      @submit="deleteItems"
    />
  </div>
</template>
