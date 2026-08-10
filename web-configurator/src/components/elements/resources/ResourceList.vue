<script setup lang="ts">
import { ref, watch, onBeforeMount, useTemplateRef } from "vue";

import ApiConnection from "@/api";
import type { Headers, PaginationMeta } from "@/types/rest";
import type ServiceResources from "@/api/services/resources";

import type { ResourceItem, SupportedResource } from "@/types/resources";
import { FlashMessageInfoStatus } from "@/types/enums";

import { useResources } from "@/composables/resources";
import { getPaginationLimit, savePaginationLimit } from "@/composables/listing";

import { addErrorFull, addErrorBottom, addInfoFull } from "@/stores/messages";

import UCSearch from "@/components/ui/UCSearch.vue";
import ListWithFilter from "@/components/elements/ListWithFilter.vue";
import ResourceUpload from "@/components/elements/resources/ResourceUpload.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import ListPaging from "@/components/ui/ListPaging.vue";

const { cleanDeletedResourceItem } = useResources();

const props = defineProps({
  allowedTypes: {
    type: Array,
    default: () => [],
  },
  defaultType: {
    type: String,
    default: "Icon",
  },
  searchFullWidth: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: "",
  },
  inModal: {
    type: Boolean,
    default: false,
  },
  active: {
    type: Boolean,
    default: true,
  },
});
const emit = defineEmits(["itemClick", "close"]);

const API: ServiceResources = ApiConnection.resources as ServiceResources;

const types = ref<SupportedResource[]>([]);
const itemsList = ref<ResourceItem[]>([]);

const filter = ref("");
const selectedType = ref<string>(props.defaultType);

const itemsLoading = ref(false);

const itemToDelete = ref<ResourceItem | null>(null);

const deleting = ref(false);

const assignedItems = ref<ResourceItem[]>([]);
const dialogDeleteItems =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDeleteItems");

const pagination = ref<PaginationMeta>({
  limit: getPaginationLimit(true) ?? 20,
  page: 1,
});

watch(
  () => props.active,
  (newVal, oldVal) => {
    if (newVal == true && oldVal == false) {
      pagination.value = {
        limit: getPaginationLimit(true) ?? 20,
        page: 1,
      };
      loadItems(true);
    }
  },
);

watch(filter, () => {
  loadItems(true);
});

watch(
  () => pagination.value.limit,
  (val) => {
    savePaginationLimit(val, true);
  },
);

async function loadItems(fetchFirstPage = false) {
  itemsLoading.value = true;

  if (fetchFirstPage === true) {
    pagination.value.page = 1;
  }

  try {
    const resourceList = await ApiConnection.resources.loadItems(
      selectedType.value,
      pagination.value.page,
      pagination.value.limit,
      filter.value,
    );
    itemsList.value = resourceList.data;
    const listHeaders = resourceList.headers as Headers;
    if (listHeaders) {
      const headerLimit = Number(listHeaders["pagination-limit"]);
      const newLimit =
        headerLimit <= Number(listHeaders["pagination-count"])
          ? pagination.value.limit
          : headerLimit;
      pagination.value = {
        count: Number(listHeaders["pagination-count"]) || 0,
        limit: newLimit || 0,
        page: Number(listHeaders["pagination-page"]) || 0,
      };
    }
  } catch (e) {
    addErrorBottom(e);
  }
  itemsLoading.value = false;
}

function onItemClick(item: ResourceItem) {
  emit("itemClick", item);
}

function getUrl(item: ResourceItem) {
  return ApiConnection.rest().resourceUrl("" + item.type, "" + item.id);
}

function startDelete() {
  dialogDeleteItems.value?.open();
}

async function deleteCustomOptions() {
  if (assignedItems.value.length < 1) {
    return false;
  }

  addInfoFull(FlashMessageInfoStatus.SAVING);
  try {
    for (let index = 0; index < assignedItems.value.length; index++) {
      const option = assignedItems.value[index];
      await ApiConnection.resources.deleteResource(option);
      cleanDeletedResourceItem(selectedType.value, option);
    }

    addInfoFull(FlashMessageInfoStatus.SUCCESS);
    assignedItems.value = [];
  } catch (e) {
    addErrorFull(e);
  }
  itemToDelete.value = null;
  loadItems();
}

function isAssignedItem(item: ResourceItem) {
  return (
    assignedItems.value.findIndex((i: ResourceItem) => i.id === item.id) > -1
  );
}

function toggleItemCheckbox(item: ResourceItem) {
  const itemIndex = assignedItems.value.findIndex(
    (i: ResourceItem) => i.id === item.id,
  );
  if (itemIndex > -1) {
    assignedItems.value.splice(itemIndex, 1);
  } else {
    assignedItems.value.push(item);
  }
}

function closeList() {
  emit("close");
}

function changePage(value: number) {
  pagination.value.page = value;
  loadItems();
}

function changePerPage(value: number) {
  pagination.value.page = 1;
  pagination.value.limit = value;
  loadItems();
}

onBeforeMount(async () => {
  let typeList: SupportedResource[] = [];
  try {
    typeList = await API.getSupportedResources();
  } catch (e) {
    addErrorBottom(e);
  }

  const filterOptions =
    props.allowedTypes &&
    Array.isArray(props.allowedTypes) &&
    props.allowedTypes.length;

  types.value = typeList.filter((item) => {
    if (!filterOptions) {
      return true;
    }
    return props.allowedTypes.includes(item.type);
  });
  selectedType.value = types.value[0].type;
  if (!props.active) return;
  loadItems(true);
});

defineExpose({
  loadItems,
});
</script>
<template>
  <ListWithFilter
    class="resource-list"
    :class="{ 'resource-list--empty-list': itemsList.length < 1 }"
  >
    <template #form>
      <div v-if="title && inModal" class="resource-list__title">
        {{ title }}
      </div>
      <div class="resource-list__filter">
        <div class="list-with-filter__form__tools">
          <UCSearch
            v-model="filter"
            :debouncing="true"
            :full-w="searchFullWidth"
          />
          <button
            :disabled="assignedItems.length < 1"
            class="button button--secondary button--icon list-with-filter__form__button-delete"
            @click="startDelete"
          >
            <i class="fa-light fa-trash" />
          </button>
        </div>
      </div>
      <div v-if="inModal" class="resource-list__button-placeholder"></div>
    </template>
    <template #items>
      <ResourceUpload
        ref="resource-upload"
        :modal-title="title"
        :default-type="selectedType"
        :allowed-types="props.allowedTypes"
        :class="{ 'resource-upload--no-items': itemsList.length < 1 }"
        @uploaded="loadItems"
      />
      <div
        v-for="(item, index) in itemsList"
        :key="index"
        class="resource-list__item"
        :class="{ 'resource-list__item--assigned': isAssignedItem(item) }"
      >
        <div class="resource-list__item__image-wrapper">
          <img
            v-if="item.type !== 'Sound'"
            :src="getUrl(item)"
            class="resource-list__item__image"
            :alt="item.id"
            @click="onItemClick(item)"
          />
          <button
            v-if="item.id"
            class="button button--icon button--icon--small resource-list__item__assign"
            @click.stop="toggleItemCheckbox(item)"
          >
            <i class="fa-light fa-check"></i>
          </button>
        </div>
        <span class="resource-list__item__label" @click="onItemClick(item)">{{
          item.id
        }}</span>
      </div>
    </template>
    <template #pagination>
      <ListPaging
        v-if="itemsList && itemsList.length > 0"
        :pagination="pagination || {}"
        :length="itemsList.length"
        :large-quantity="true"
        @change-page="changePage"
        @change-per-page="changePerPage"
      />
    </template>
  </ListWithFilter>
  <button
    v-if="inModal"
    class="button button--secondary button--icon button--icon--medium button-close"
    @click="closeList"
  >
    <i class="fa-regular fa-close"></i>
  </button>
  <AppDialog
    ref="dialogDeleteItems"
    :title="$t('resource.delete_items.title', { count: assignedItems.length })"
    :text="
      $t('resource.delete_items.question', { count: assignedItems.length })
    "
    :submit-text="$t('ui.delete')"
    :cancel-text="$t('ui.cancel')"
    :disable-buttons="deleting"
    @submit="deleteCustomOptions"
  />
</template>
