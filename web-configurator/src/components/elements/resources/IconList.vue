<script setup lang="ts">
import { ref, watch, computed, onBeforeMount, useTemplateRef } from "vue";

import ApiConnection from "@/api";

import type { Headers, PaginationMeta } from "@/types/rest";
import type { SelectOption } from "@/types/config";
import type { ResourceItem } from "@/types/resources";
import {
  SelectTypes,
  FlashMessageInfoStatus,
  ResourceTypeEnum,
} from "@/types/enums";

import { buildOptions } from "@/composables/select/options";
import rawOptions from "@/composables/select/iconList";
import { useResources } from "@/composables/resources";
import { focusInput } from "@/composables/device";
import { getPaginationLimit, savePaginationLimit } from "@/composables/listing";

import { addErrorFull, addErrorBottom, addInfoFull } from "@/stores/messages";

import UCSearch from "@/components/ui/UCSearch.vue";
import ListWithFilter from "@/components/elements/ListWithFilter.vue";
import ResourceUpload from "@/components/elements/resources/ResourceUpload.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import ListPaging from "@/components/ui/ListPaging.vue";

const { cleanDeletedResourceItem } = useResources();

const props = defineProps({
  value: {
    type: String,
    default: null,
  },
  title: {
    type: String,
    default: "",
  },
  iconType: {
    type: String,
    default: "Icon",
  },
  changeCallback: {
    type: Function,
    default: null,
  },
  hasTvChannel: {
    type: Boolean,
    default: false,
  },
  active: {
    type: Boolean,
    default: true,
  },
});

defineExpose({
  reset,
});

const allUcOptions = ref<SelectOption[]>(
  buildOptions(rawOptions as Array<string>, SelectTypes.Icon),
);
const allCustomOptions = ref<ResourceItem[]>([]);

const selectedIcon = ref<string | null>(null);

const itemToDelete = ref<ResourceItem | null>(null);

const filter = ref("");
const selectedList = ref(props.iconType == "Icon" ? "uc" : "custom");

const imageCropping = ref(false);

const deleting = ref(false);

const assignedItems = ref<ResourceItem[]>([]);
const elFormTools = useTemplateRef<HTMLDivElement>("elFormTools");
const dialogDeleteItems =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDeleteItems");

const pagination = ref<PaginationMeta>({
  limit: getPaginationLimit(true) ?? 20,
  page: 1,
});

const emit = defineEmits(["iconDelete"]);

watch(props, async () => {
  if (props.value != selectedIcon.value) {
    selectedIcon.value = props.value;
  }
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

watch([filter, selectedList], () => {
  pagination.value.page = 1;

  if (selectedList.value != "uc") {
    loadItems(true);
  }
});

watch(selectedList, () => {
  if (elFormTools.value) {
    focusInput(elFormTools.value);
  }
});

watch(
  () => pagination.value.limit,
  (val) => {
    savePaginationLimit(val, true);
  },
);

const reducedUcOptions = computed(() => {
  const search = filter.value.toLowerCase();
  return allUcOptions.value.filter((item) => {
    return (
      item.search.toLowerCase().includes(search) ||
      item.label.toLowerCase().includes(search)
    );
  });
});

const iconList = computed(() => {
  let list = [];
  if (selectedList.value == "uc") {
    list = reducedUcOptions.value;
    const startIndex = (pagination.value.page - 1) * pagination.value.limit;
    const endIndex = startIndex + pagination.value.limit;

    return { items: list.slice(startIndex, endIndex), count: list.length };
  } else {
    list = allCustomOptions.value;
    return { items: list, count: pagination.value.count || 0 };
  }
});

watch(iconList, () => {
  pagination.value.count = iconList.value.count;
});

const titleResourceUpload = computed(() => {
  if (props.iconType == "Icon") {
    return "icons.title";
  } else if (props.iconType == "TvChannelIcon") {
    return "tv_channels.title";
  }

  return "";
});

function createIconName(icon: string | number) {
  let name = icon.toString().replace(/^uc:/, "fa-");
  const found = allUcOptions.value.find((item) => {
    return item.value === icon;
  });
  if (!found) {
    name += " fa-user";
  }
  return name;
}

function doSelectUcOption(option: SelectOption) {
  doSelectOption(option.value.toString());
}

function doSelectCustomOption(option: ResourceItem) {
  let prefix = "custom:";
  if (
    option &&
    option.type &&
    option.type === ResourceTypeEnum.TV_CHANNEL_ICON
  ) {
    prefix = "ctv:";
  }

  doSelectOption(prefix + option.id);
}

function doSelectOption(value: string) {
  if (itemToDelete.value != null) {
    return false;
  }
  if (props.changeCallback) {
    props.changeCallback(value);
  }
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

      cleanDeletedResourceItem(ResourceTypeEnum.ICON, option);
      emit("iconDelete", option);
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

function getUrl(item: ResourceItem) {
  return ApiConnection.rest().resourceUrl(
    selectedList.value === "tv-channels" ? "TvChannelIcon" : props.iconType,
    "" + item.id,
  );
}

function newUploaded() {
  // selectedList.value = "custom";
  loadItems(true);
}

async function loadItems(fetchFirstPage = false) {
  if (fetchFirstPage === true) {
    pagination.value.page = 1;
  }

  try {
    const resourceType =
      selectedList.value === "tv-channels" ? "TvChannelIcon" : props.iconType;
    const resourceList = await ApiConnection.resources.loadItems(
      resourceType,
      pagination.value.page,
      pagination.value.limit,
      filter.value,
    );

    if (
      selectedList.value === "custom" ||
      selectedList.value === "tv-channels"
    ) {
      allCustomOptions.value = resourceList.data;
    }

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
}

function handleCrop(cropping = false) {
  imageCropping.value = cropping;
}

function reset() {
  filter.value = "";
  selectedList.value = props.iconType == "Icon" ? "uc" : "custom";
  assignedItems.value = [];
}

function changePage(value: number) {
  pagination.value.page = value;

  if (selectedList.value != "uc") {
    loadItems();
  }
}

function changePerPage(value: number) {
  pagination.value.page = 1;
  pagination.value.limit = value;

  if (selectedList.value != "uc") {
    loadItems();
  }
}

onBeforeMount(async () => {
  selectedIcon.value = props.value;
  if (!props.active) return;
  loadItems(true);
});
</script>
<template>
  <div
    class="icon-list"
    :class="{
      'icon-list--empty-list':
        selectedList === 'custom' && allCustomOptions.length < 1,
    }"
  >
    <ListWithFilter>
      <template #form>
        <span v-if="title" class="icon-list__title">
          {{ title }}
        </span>
        <div ref="elFormTools" class="list-with-filter__form__tools">
          <div v-if="iconType == 'Icon'" class="button-group">
            <button
              class="button"
              :class="{ active: selectedList === 'uc' }"
              @click.stop="selectedList = 'uc'"
            >
              {{ $t("icons.default") }}
            </button>
            <button
              class="button"
              :class="{ active: selectedList === 'custom' }"
              @click.stop="selectedList = 'custom'"
            >
              {{ $t("icons.custom") }}
            </button>
            <button
              v-if="hasTvChannel"
              class="button"
              :class="{ active: selectedList === 'tv-channels' }"
              @click.stop="selectedList = 'tv-channels'"
            >
              {{ $t("icons.tv_channels") }}
            </button>
          </div>
          <div class="list-with-filter__form__tools__col-right">
            <div class="list-with-filter__search icon-list__search">
              <UCSearch v-model="filter" :debouncing="true" :gray="true" />
            </div>
            <button
              v-if="selectedList === 'custom' || selectedList === 'tv-channels'"
              :disabled="assignedItems.length < 1"
              class="button button--secondary button--icon list-with-filter__form__button-delete"
              @click="startDelete"
            >
              <i class="fa-light fa-trash" />
            </button>
          </div>
        </div>
        <div v-if="title" class="icon-list__button-placeholder"></div>
      </template>

      <template #items>
        <template v-if="selectedList === 'uc' && iconType == 'Icon'">
          <div
            v-for="(option, index) in iconList.items as SelectOption[]"
            :key="index"
            class="icon-list__item"
            @click="doSelectUcOption(option)"
          >
            <i
              class="icon-list__item__icon"
              :class="'fa-light ' + createIconName(option.value)"
            />
            <span class="icon-list__item__label">{{ option.label }}</span>
          </div>
        </template>
        <template
          v-else-if="
            selectedList === 'custom' ||
            selectedList === 'tv-channels' ||
            iconType != 'Icon'
          "
        >
          <ResourceUpload
            ref="resource-upload-icon"
            :default-type="
              selectedList === 'tv-channels' ? 'TvChannelIcon' : iconType
            "
            :allowed-types="[
              selectedList === 'tv-channels' ? 'TvChannelIcon' : iconType,
            ]"
            :modal-title="$t(titleResourceUpload || '')"
            :class="{ 'resource-upload--no-items': iconList.items.length < 1 }"
            @uploaded="newUploaded"
            @crop="handleCrop"
          />
          <div
            v-for="(item, index) in iconList.items as ResourceItem[]"
            :key="index"
            class="icon-list__item"
            :class="{ 'icon-list__item--assigned': isAssignedItem(item) }"
          >
            <div class="icon-list__item__image-wrapper">
              <img
                v-if="item.type !== 'Sound'"
                :src="getUrl(item)"
                class="icon-list__item__image"
                :alt="item.id"
                @click="doSelectCustomOption(item)"
              />
              <button
                v-if="item.id"
                class="button button--icon button--icon--small icon-list__item__assign"
                @click.stop="toggleItemCheckbox(item)"
              >
                <i class="fa-light fa-check"></i>
              </button>
            </div>
            <span
              class="icon-list__item__label"
              @click="doSelectCustomOption(item)"
            >
              {{ item.id }}
            </span>
          </div>
        </template>
      </template>
      <template #pagination>
        <ListPaging
          v-if="iconList.items && iconList.items.length > 0"
          :pagination="pagination || {}"
          :length="iconList.items.length"
          :large-quantity="true"
          @change-page="changePage"
          @change-per-page="changePerPage"
        />
      </template>
    </ListWithFilter>
  </div>
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
