<!-- Labelled option dropdown for widget settings (UC Virtual Remote). -->
<script setup lang="ts">
import { computed, ref, watch, type PropType } from "vue";
import type { SelectOption } from "@/types/ui";

import UCSelect from "@/components/ui/UCSelect.vue";

const props = defineProps({
  label: {
    type: String,
    required: true,
  },
  value: {
    type: String,
    required: true,
  },
  options: {
    type: Array as PropType<SelectOption[]>,
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});
const emit = defineEmits(["change"]);

const current = computed(
  () =>
    props.options.find((option) => option.value === props.value) ??
    props.options[0],
);
const selected = ref<SelectOption>(current.value);

watch(current, (value) => {
  selected.value = value;
});

function doSelect(option: SelectOption) {
  if (option.value !== props.value) emit("change", option.value);
}
</script>
<template>
  <div class="param-setup param-setup--enum widget-option-select">
    <span class="param-setup__label">{{ label }}</span>
    <UCSelect
      v-model="selected"
      :options="options"
      :position="'right'"
      :dynamic-width="true"
      :dynamic-position="true"
      :disabled="disabled"
      @select="doSelect"
    />
  </div>
</template>
