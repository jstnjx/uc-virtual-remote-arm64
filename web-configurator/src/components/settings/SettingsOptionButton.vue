<script setup lang="ts" generic="M extends SelectOption | SelectOption[]">
import { computed } from "vue";
import type { PropType } from "vue";

import type { SelectOption } from "@/types/ui";

import { useWindowDimension } from "@/composables/windowDimension";

import UCSelect from "@/components/ui/UCSelect.vue";

const { isSmallScreen } = useWindowDimension();

const activeOptionItem = defineModel<M>("activeOptionItem", {
  default: () => ({ label: "", value: "" }) as unknown as M,
});

const props = defineProps({
  label: {
    type: String,
    default: "",
  },
  type: {
    type: String,
    default: "",
  },
  description: {
    type: String,
    default: "",
  },
  icon: {
    type: String,
    default: "",
  },
  buttonLabel: {
    type: String,
    default: "",
  },
  buttonIcon: {
    type: String,
    default: "",
  },
  clickable: {
    type: Boolean,
    default: false,
  },
  select: {
    type: Boolean,
    default: false,
  },
  selectSearchable: {
    type: Boolean,
    default: false,
  },
  selectSmallScreenPosition: {
    type: String,
    default: "",
  },
  selectDynamicPosition: {
    type: Boolean,
    default: false,
  },
  selectUpdate: {
    type: Function as PropType<(value: M) => void>,
    required: false,
  },
  selectMultiple: {
    type: Boolean,
    required: false,
  },
  selectItems: {
    type: Array as PropType<SelectOption[]>,
    default: () => [],
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["clickButton"]);

function clickButton() {
  emit("clickButton");
}

const hasInput = computed(() => {
  return props.select;
});

const mainClasses = computed(() => {
  let classList = "";
  classList += props.type
    ? `settings-option-button--${props.type.replace(/ /g, "-").toLowerCase()} `
    : "";
  classList += props.clickable ? "settings-option-button--clickable " : "";
  classList += hasInput.value ? "settings-option-button--has-input " : "";
  return classList;
});
</script>
<template>
  <div class="settings-option-button" :class="mainClasses">
    <span v-if="icon" class="settings-option-button__icon">
      <i :class="icon"></i>
    </span>
    <span class="settings-option-button__text">
      <span class="settings-option-button__title">
        {{ label }}
      </span>
      <span class="settings-option-button__description">
        {{ description }}
      </span>
    </span>
    <template v-if="!!$slots.customFields">
      <slot name="customFields" />
    </template>
    <template v-else>
      <template v-if="!!$slots.extra">
        <div class="settings-option-button__extra">
          <slot name="extra" />
        </div>
      </template>
      <button
        v-if="buttonLabel"
        :disabled="disabled"
        class="button button--secondary"
        @click="clickButton"
      >
        {{ buttonLabel }}
      </button>
      <span v-if="buttonIcon" class="settings-option-button__nav-icon">
        <i :class="buttonIcon"></i>
      </span>
      <div v-if="select" class="page-settings-section__select">
        <UCSelect
          v-model="activeOptionItem"
          :options="selectItems"
          :searchable="selectSearchable"
          :position="isSmallScreen ? selectSmallScreenPosition : 'right'"
          :dynamic-position="selectDynamicPosition"
          :multiple="selectMultiple"
          :disabled="disabled"
          @select="(value) => props.selectUpdate?.(value)"
        />
      </div>
    </template>
  </div>
</template>
