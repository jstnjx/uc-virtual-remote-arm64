<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";
import { asyncComputed } from "@vueuse/core";

import type { DeviceScreenLayout } from "@/types/activity";

import { configStore } from "@/stores/config";

import { useWindowDimension } from "@/composables/windowDimension";
import { getIconName } from "@/composables/icon";

import ModalSecondary from "@/components/elements/ModalSecondary.vue";

const { isSmallScreen } = useWindowDimension();

const props = defineProps({
  actualDimensions: {
    type: Object,
    required: true,
  },
  minDimensions: {
    type: Object,
    required: true,
  },
});

const config = configStore();
const screenLayout = config.$state.list.screenLayout as DeviceScreenLayout;

const grid = ref(
  Array.from({ length: screenLayout.grid.max.height || 6 }, () =>
    Array.from({ length: screenLayout.grid.max.width || 4 }, () => ""),
  ),
);
const showGridSizeModal = ref(false);

const selectedWidth = ref<number>(0);
const selectedHeight = ref<number>(0);

const previewWidth = ref<number>(0);
const previewHeight = ref<number>(0);

const gridSizeTrigger = useTemplateRef<HTMLButtonElement>("gridSizeTrigger");
const gridSizeModalTop = ref<string>("");
const gridSizeModalLeft = ref<string>("");

const emit = defineEmits(["save"]);

watch(showGridSizeModal, (val) => {
  if (val) {
    selectedWidth.value = props.actualDimensions.width - 1;
    selectedHeight.value = props.actualDimensions.height - 1;
    setModalPosition();
  }
});

const iconGrid = asyncComputed(async () => {
  return await getIconName("fa-border-all");
});

const smallerPreview = computed(() => {
  if (previewWidth.value < 1 && previewHeight.value < 1) {
    return false;
  }

  return (
    previewWidth.value <= selectedWidth.value ||
    previewHeight.value <= selectedHeight.value
  );
});

const isInvalidDimension = computed(() => {
  if (smallerPreview.value) {
    return (
      previewWidth.value < props.minDimensions.width - 1 ||
      previewHeight.value < props.minDimensions.height - 1
    );
  }

  return (
    selectedWidth.value < props.minDimensions.width - 1 ||
    selectedHeight.value < props.minDimensions.height - 1
  );
});

const triggerButtonClasses = computed(() => {
  let classList = "";
  if (isSmallScreen.value) {
    classList += "button--secondary button--icon";
  } else {
    classList += "button--tertiary button--hybrid";
  }

  return classList;
});

function onSave() {
  if (isInvalidDimension.value) {
    return false;
  }

  emit("save", {
    width: selectedWidth.value + 1,
    height: selectedHeight.value + 1,
  });
  // showGridSizeModal.value = false;
}

function setModalPosition() {
  if (gridSizeTrigger.value) {
    gridSizeModalLeft.value =
      gridSizeTrigger.value.getBoundingClientRect().x - 100 + "px";
    gridSizeModalTop.value =
      gridSizeTrigger.value.getBoundingClientRect().y + "px";
  }
}

function isActive(height: number, width: number, preview = false) {
  if (preview) {
    return (
      previewWidth.value != null &&
      previewWidth.value >= width &&
      previewHeight.value != null &&
      previewHeight.value >= height
    );
  }

  return (
    selectedWidth.value != null &&
    selectedWidth.value >= width &&
    selectedHeight.value != null &&
    selectedHeight.value >= height
  );
}

function setSelect(height: number, width: number) {
  selectedWidth.value = width;
  selectedHeight.value = height;
  onSave();
}

function setPreview(height: number, width: number) {
  previewWidth.value = width;
  previewHeight.value = height;
}
</script>
<template>
  <div class="grid-size">
    <button
      ref="gridSizeTrigger"
      class="button"
      :class="triggerButtonClasses"
      :title="$t('user_interface.grid')"
      @click="showGridSizeModal = true"
    >
      <i v-if="iconGrid" class="fa-light" :class="iconGrid"></i>
      <span>{{ $t("user_interface.grid") }}</span>
    </button>
    <Teleport to="body">
      <ModalSecondary
        :show="showGridSizeModal"
        :width="'15rem'"
        :height="'fit-content;'"
        :top="gridSizeModalTop"
        :left="gridSizeModalLeft"
        :name="'grid-size-modal'"
        class="grid-size-modal"
        @close="showGridSizeModal = false"
      >
        <template #header>
          {{ $t("user_interface.grid") }}
        </template>

        <div
          class="grid-size__items"
          :class="{ 'grid-size__items--error': isInvalidDimension }"
          @mouseleave="setPreview(0, 0)"
        >
          <div
            v-for="(row, rowIndex) in grid"
            :key="rowIndex"
            class="grid-size__items__row"
          >
            <div
              v-for="(cell, cellIndex) in row"
              :key="cellIndex"
              class="grid-size__item"
              :class="{
                'grid-size__item--active': isActive(
                  rowIndex,
                  cellIndex,
                  smallerPreview,
                ),
                'grid-size__item--preview': isActive(
                  rowIndex,
                  cellIndex,
                  !smallerPreview,
                ),
              }"
              @click="setSelect(rowIndex, cellIndex)"
              @mouseover="setPreview(rowIndex, cellIndex)"
            ></div>
          </div>
        </div>

        <div class="grid-size__value">
          <template v-if="previewWidth > 0 && previewHeight > 0"
            >{{ previewWidth + 1 }}x{{ previewHeight + 1 }}</template
          >
          <template v-else
            >{{ selectedWidth + 1 }}x{{ selectedHeight + 1 }}</template
          >
        </div>
      </ModalSecondary>
    </Teleport>
  </div>
</template>
