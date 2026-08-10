<!-- Entity command parameter `type: enum` -->
<script setup lang="ts">
import { ref, watch, type PropType } from "vue";
import type { SelectOption } from "@/types/ui";

import UCSelect from "@/components/ui/UCSelect.vue";

const props = defineProps({
  paramName: {
    type: String,
    required: true,
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

function emitChange(item: SelectOption) {
  emit("change", {
    paramName: props.paramName,
    paramValue: item.value,
  });
}
</script>
<template>
  <div class="setup-item setup-item--enum">
    <div class="setup-item__body">
      <UCSelect
        v-model="selected"
        :options="options"
        :dynamic-position="true"
        :dynamic-width="true"
        :light="true"
        :disabled="disabled"
        @select="emitChange"
      />
    </div>
  </div>
</template>
