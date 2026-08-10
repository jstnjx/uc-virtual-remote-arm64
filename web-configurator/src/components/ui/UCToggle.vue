<script setup lang="ts">
import { computed, getCurrentInstance } from "vue";

const props = withDefaults(
  defineProps<{
    label?: string;
    description?: string;
    errorMessage?: string;
    fullW?: boolean;
    settings?: boolean;
    inactiveLabel?: boolean;
    light?: boolean;
    disabled?: boolean;
  }>(),
  {
    label: "",
    description: "",
    errorMessage: "",
    fullW: false,
    settings: false,
    inactiveLabel: false,
    light: false,
    disabled: false,
  },
);

const model = defineModel<boolean>({ required: true });

const instanceId =
  getCurrentInstance()?.uid ||
  Math.floor(Math.random() * (99999 - 10000 + 1)) + 10000; // with fallback

const mainClasses = computed(() => {
  let classList = "";
  classList += props.errorMessage ? "form-item--error " : "";
  classList += props.fullW ? "form-item--full-w " : "";
  classList += props.settings ? "form-item--toggle--settings " : "";
  classList += props.light ? "form-item--toggle--light " : "";
  classList +=
    props.inactiveLabel || props.disabled
      ? "form-item--toggle--inactive-label "
      : "";
  classList += props.disabled ? "form-item--toggle--disabled " : "";
  return classList;
});
</script>
<template>
  <div class="form-item form-item--toggle" :class="mainClasses">
    <div class="form-item--toggle__body">
      <label
        v-if="props.label"
        :for="inactiveLabel ? undefined : `toggle-${instanceId}`"
        class="form-item--toggle__label"
      >
        {{ props.label }}
      </label>
      <input
        :id="`toggle-${instanceId}`"
        v-model="model"
        :disabled="disabled"
        type="checkbox"
      />
      <label
        :for="`toggle-${instanceId}`"
        class="form-item--toggle__switch"
      ></label>
    </div>
    <p v-if="props.description" class="form-item--toggle__description">
      {{ props.description }}
    </p>
  </div>
</template>
