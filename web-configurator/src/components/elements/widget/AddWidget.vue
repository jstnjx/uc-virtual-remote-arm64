<script setup lang="ts">
import { ref, computed } from "vue";

import type {
  ActivityUserInterfaceItem,
  ActivityUserInterfacePage,
} from "@/types/activity";

import {
  getComponentPool,
  getActivityComponentPool,
} from "@/composables/components";

import GridItemEdit from "@/components/ui/GridItemEdit.vue";
import ModalSecondary from "@/components/elements/ModalSecondary.vue";
import { deepClone } from "@/composables/dataHelper";

const emit = defineEmits(["add", "change", "close"]);

const props = defineProps({
  entity: {
    type: Object,
    required: true,
  },
  entityType: {
    type: String,
    default: "activity",
  },
  pages: {
    type: Array,
    default: () => [],
  },
  activePage: {
    type: Number,
    required: true,
  },
  enableMedia: {
    type: Boolean,
    default: true,
  },
  gridDimensions: {
    type: Object,
    required: true,
  },
  saving: {
    type: Boolean,
    default: false,
  },
});

defineExpose({
  open,
  update,
  closeModal,
  isActive,
});

const types =
  (props.entityType == "activity"
    ? getActivityComponentPool()
    : getComponentPool()) ?? [];
const showAddModal = ref(false);
const editButton = ref<ActivityUserInterfaceItem | {}>({});

const added = ref(false);

const isSelected = computed(() => {
  return editButton.value && Object.keys(editButton.value).length > 0;
});

function selectType(item: ActivityUserInterfaceItem) {
  const gridCols =
    (props.pages as ActivityUserInterfacePage[])[props.activePage]?.grid
      ?.width || 4;
  const gridRows =
    (props.pages as ActivityUserInterfacePage[])[props.activePage]?.grid
      ?.height || 6;

  const uiItem = deepClone(item);
  if (uiItem.type == "media_player") {
    uiItem.size.width = gridCols;
    const mediaMinHeight = Math.ceil(
      props.gridDimensions.widgetMeta.mediaPlayerMinHeight /
        (props.gridDimensions.height / gridRows),
    );
    uiItem.size.height = mediaMinHeight || 3;
  } else if (item.type == "slider") {
    uiItem.size.width = gridCols;
  }
  editButton.value = uiItem;
}

function changeItem(item: ActivityUserInterfaceItem) {
  if (added.value) {
    emit("change", item);
  } else {
    emit("add", item);
    added.value = true;
  }
}

function update(item: ActivityUserInterfaceItem) {
  if (item) {
    editButton.value = item;
  }
}

function setDefaults() {
  added.value = false;
  editButton.value = {};
}

function isActive() {
  return showAddModal.value;
}

function closeModal() {
  showAddModal.value = false;
  setDefaults();
  emit("close");
}

function open() {
  setDefaults();
  showAddModal.value = true;
}
</script>
<template>
  <ModalSecondary
    :show="showAddModal"
    :name="'add-widget-modal'"
    :width="isSelected ? '22.5rem' : '100%'"
    :saving="saving"
    :focusable-input="!added"
    :class="`modal--add-widget ${
      !isSelected ? 'modal--add-widget--select' : ''
    }`"
    @close="closeModal"
  >
    <template #header>
      {{ $t("widget.add_widget") }}
    </template>

    <div
      v-show="!isSelected"
      :style="isSelected ? 'position:absolute' : ''"
      class="modal--add-widget__select"
    >
      <div
        v-if="types[0] && types[0].type == 'icon'"
        class="widget-card"
        @click="selectType(types[0])"
      >
        <div class="widget-card__image">
          <i class="fa-regular fa-play"></i>
        </div>
        <h4 class="widget-card__title">
          {{ $t("widget.type.icon.title") }}
        </h4>
        <span class="widget-card__description">
          {{ $t("widget.type.icon.description") }}
        </span>
      </div>
      <div
        v-if="types[1] && types[1].type == 'text'"
        class="widget-card"
        @click="selectType(types[1])"
      >
        <div class="widget-card__image">
          <i class="fa-regular fa-text-height"></i>
        </div>
        <h4 class="widget-card__title">
          {{ $t("widget.type.text.title") }}
        </h4>
        <span class="widget-card__description">
          {{ $t("widget.type.text.description") }}
        </span>
      </div>
      <div
        v-if="types[4] && types[4].type == 'sensor'"
        class="widget-card"
        @click="selectType(types[4])"
      >
        <div class="widget-card__image">
          <i class="fa-regular fa-gauge"></i>
        </div>
        <h4 class="widget-card__title">
          {{ $t("widget.type.sensor.title") }}
        </h4>
        <span class="widget-card__description">
          {{ $t("widget.type.sensor.description") }}
        </span>
      </div>
      <div
        v-if="types[5] && types[5].type == 'select'"
        class="widget-card"
        @click="selectType(types[5])"
      >
        <div class="widget-card__image">
          <i class="fa-regular fa-square-caret-down"></i>
        </div>
        <h4 class="widget-card__title">
          {{ $t("widget.type.select.title") }}
        </h4>
        <span class="widget-card__description">
          {{ $t("widget.type.select.description") }}
        </span>
      </div>
      <div
        v-if="types[6] && types[6].type == 'media_player'"
        class="widget-card"
        :class="{ 'widget-card--disabled': !enableMedia }"
        @click="enableMedia && selectType(types[6])"
      >
        <div class="widget-card__image widget-card__image--media">
          <i class="fa-regular fa-film"></i>
        </div>
        <h4 class="widget-card__title">
          {{ $t("widget.type.media.title") }}
        </h4>
        <span class="widget-card__description">
          {{ $t("widget.type.media.description") }}
        </span>
        <div v-if="!enableMedia" class="widget-card__image widget-card__error">
          <i class="fa-light fa-exclamation"></i>
          {{ $t("widget.type.media.no_space") }}
        </div>
      </div>
      <!-- <div v-if="types[2] && types[2].type == 'slider'" @click="selectType(types[2])" class="widget-card">
        <div class="widget-card__image widget-card__image--slider"></div>
        <h4 class="widget-card__title">
          {{ $t("widget.type.slider.title") }}
        </h4>
        <span class="widget-card__description">
          {{ $t("widget.type.slider.description") }}
        </span>
      </div> -->
      <!-- <div v-if="types[3] && types[3].type == 'jump'" @click="selectType(types[3])" class="widget-card">
        <div class="widget-card__image">
          <i class="fa-regular fa-file"></i>
        </div>
        <h4 class="widget-card__title">
          {{ $t("widget.type.jump_to_page.title") }}
        </h4>
        <span class="widget-card__description">
          {{ $t("widget.type.jump_to_page.description") }}
        </span>
      </div> -->
    </div>
    <Transition name="opacity-fast">
      <div
        v-if="isSelected && editButton && entity"
        class="modal--add-widget__edit"
      >
        <GridItemEdit
          :key="JSON.stringify(editButton)"
          :add-item="true"
          :settings="editButton"
          :entity="entity"
          :entity-type="entityType"
          :active-page="pages[activePage] || []"
          :grid-dimensions="gridDimensions"
          @change="changeItem"
        />
      </div>
    </Transition>
  </ModalSecondary>
</template>
