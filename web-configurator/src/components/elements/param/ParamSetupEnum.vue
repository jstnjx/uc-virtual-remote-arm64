<!-- Entity command parameter `type: enum` -->
<script setup lang="ts">
import { ref, watch, type PropType } from "vue";
import type { SelectOption } from "@/types/ui";

import { useWindowDimension } from "@/composables/windowDimension";

import UCSelect from "@/components/ui/UCSelect.vue";

const { isSmallScreen } = useWindowDimension();

const props = defineProps({
  paramName: {
    type: String,
    required: true,
  },
  label: {
    type: String,
    default: "",
  },
  value: {
    type: String,
    required: true,
  },
  options: {
    type: Array as PropType<string[]>,
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});
const selected = ref({ label: props.value, value: props.value });
const options = ref(
  props.options.map((item) => ({ label: item, value: item })),
);
const emit = defineEmits(["change"]);

watch(props, () => {
  selected.value = { label: props.value, value: props.value };
});

function doSelect(value: SelectOption) {
  emitChange(value.value);
}

function emitChange(value: string | number) {
  emit("change", value);
}
</script>
<template>
  <div class="param-setup param-setup--enum">
    <span class="param-setup__label">
      {{ label }}
    </span>
    <UCSelect
      v-model="selected"
      :options="options"
      :position="isSmallScreen ? 'right' : 'center'"
      :dynamic-width="true"
      :dynamic-position="true"
      :disabled="disabled"
      @select="doSelect"
    />
  </div>
</template>
