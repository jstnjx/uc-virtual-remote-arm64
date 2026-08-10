<script setup lang="ts">
import { getCurrentInstance } from "vue";

withDefaults(
  defineProps<{
    min?: number;
    max?: number;
    disabled?: boolean;
  }>(),
  {
    min: 0,
    max: 100,
    disabled: false,
  },
);

const model = defineModel<number | string>({ required: true });
const emit = defineEmits<{
  change: [value: number];
}>();

const instanceId =
  getCurrentInstance()?.uid ||
  Math.floor(Math.random() * (99999 - 10000 + 1)) + 10000; // with fallback

function onChange() {
  emit("change", Number(model.value));
}
</script>
<template>
  <div class="form-item form-item--color-temperature">
    <input
      :id="`color-temperature-${instanceId}`"
      v-model.number="model"
      :min="min"
      :max="max"
      :disabled="disabled"
      type="range"
      @change="onChange"
    />
  </div>
</template>
