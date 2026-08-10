<script setup lang="ts">
import { ref, watch, computed } from "vue";

import type { Headers, PaginationMeta } from "@/types/rest";
import type {
  ConfiguredEntity,
  EntityFilterData,
} from "@/types/integrationInstance";

import { useTiming } from "@/composables/timing";
import {
  getPaginationLimit,
  savePaginationLimit,
  readPaginationMeta,
} from "@/composables/listing";

import { integrationsStore } from "@/stores/integrations";

import EntityListFiltered from "@/components/elements/entity/EntityListFiltered.vue";

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  pageId: {
    type: String,
    default: "",
  },
  filteredEntities: {
    type: Array,
    required: true,
  },
  selectedEntities: {
    type: Array,
    required: false,
    default: () => [],
  },
  instances: {
    type: Array,
    required: false,
    default: () => [],
  },
});

const integrationStorage = integrationsStore();
const { sleep } = useTiming();

const emit = defineEmits(["close", "addToPage"]);

const entityListFilterDefaults = {
  searchText: "",
  entityTypes: "",
  instances: "",
};

const localFilteredEntities = ref<ConfiguredEntity[]>([]);

const entityListFilter = ref<EntityFilterData>(entityListFilterDefaults);

const showList = ref(false); // For transition, animation

const pagination = ref<PaginationMeta>({
  limit: getPaginationLimit() ?? 20,
  page: 1,
});

/**
 * What `ListPaging` renders: the view owns page and limit, the store owns the
 * server's total — so a refetch the view never made (the WS-event reloads)
 * still moves the footer (#685).
 */
const paging = computed<PaginationMeta>(() => ({
  ...pagination.value,
  count: integrationStorage.configuredEntitiesByPage.count,
}));

defineExpose({
  loadData,
});

watch(props, async (val) => {
  if (val.show == true && showList.value == false) {
    entityListFilter.value = entityListFilterDefaults;
    showList.value = true;
    loadData();
  } else if (showList.value == true && val.show == false) {
    await sleep(1000);
    showList.value = false;
  }
});

watch(
  () => pagination.value.limit,
  (val) => {
    savePaginationLimit(val);
  },
);

watch(
  () => integrationStorage.configuredEntities,
  (configuredEntities) => {
    updateFilteredEntities(configuredEntities);
  },
  // configuredEntities entries can be updated in place (WS entity changes),
  // so watch their contents deeply to keep the local list in sync.
  { deep: true },
);

function changeFilter(data: EntityFilterData) {
  entityListFilter.value = data;
  fetchFilteredEntities(true);
}

function reloadEntities() {
  fetchFilteredEntities(true);
}

async function addToPage(entities: ConfiguredEntity[]) {
  emit("addToPage", entities);
}

async function fetchFilteredEntities(userFetchFirstPage = false) {
  if (userFetchFirstPage === true) {
    pagination.value.page = 1;
  }

  const searchText = entityListFilter.value.searchText;

  try {
    const entList = await integrationStorage.getConfiguredEntitiesByPageByLimit(
      entityListFilter.value.instances || "",
      false,
      pagination.value.page,
      pagination.value.limit,
      searchText,
      entityListFilter.value.entityTypes,
      props.pageId,
    );
    localFilteredEntities.value = entList.data
      .configuredEntities as ConfiguredEntity[];

    const listHeaders = entList.headers as Headers;
    if (listHeaders) {
      pagination.value = readPaginationMeta(
        listHeaders,
        pagination.value.limit,
      );
    }
  } catch (e) {
    console.error(e);
  }
}

function updateFilteredEntities(configuredList: ConfiguredEntity[]) {
  for (let index = 0; index < localFilteredEntities.value.length; index++) {
    for (let ind = 0; ind < configuredList.length; ind++) {
      if (
        localFilteredEntities.value[index].entity_id ==
          configuredList[ind].entity_id &&
        JSON.stringify(localFilteredEntities.value[index]) !=
          JSON.stringify(configuredList[ind])
      ) {
        localFilteredEntities.value[index] = configuredList[ind];
      }
    }
  }
}

function changePage(value: number) {
  pagination.value.page = value;
  fetchFilteredEntities();
}

function changePerPage(value: number) {
  pagination.value.page = 1;
  pagination.value.limit = value;
  fetchFilteredEntities();
}

function close() {
  emit("close");
}

async function loadData() {
  await fetchFilteredEntities(true);
}
</script>
<template>
  <div class="custom-remote-modify custom-remote-add-entities">
    <div
      class="custom-remote-modify__header custom-remote-add-entities__header"
    >
      <button
        class="button button--blank button--icon button--icon--medium"
        @click="close"
      >
        <i class="fa-regular fa-arrow-left"></i>
      </button>
      <span>{{ $t("customise_remote.add_entities.title") }}</span>
    </div>
    <EntityListFiltered
      v-if="show || showList"
      :pagination="paging"
      :all-entities="localFilteredEntities"
      :instances="instances"
      :drag-group="'customise-remote-items'"
      :has-quick-options="true"
      @change-filter="changeFilter"
      @reload-entities="reloadEntities"
      @change-page="changePage"
      @change-per-page="changePerPage"
      @add-entities="addToPage"
    />
  </div>
</template>
