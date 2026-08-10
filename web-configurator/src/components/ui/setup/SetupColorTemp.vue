<script setup lang="ts">
import { ref, watch, computed } from "vue";

import UCColorTemp from "@/components/ui/UCColorTemp.vue";

const props = defineProps({
  value: {
    type: Number,
    required: true,
  },
  params: {
    type: Object,
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});
const value = ref(props.value);

const emit = defineEmits(["change"]);

watch(props, () => {
  value.value = props.value;
});

const params = computed(() => {
  return {
    min: props.params.min,
    max: props.params.max,
    default: props.params.default,
    step: props.params.step || 1,
    decimals: props.params.decimals || 0,
    unit: props.params.unit,
  };
});

function emitChange() {
  let newValue = value.value;
  if (params.value.min !== undefined && params.value.min > newValue) {
    newValue = params.value.min;
  } else if (params.value.max !== undefined && params.value.max < newValue) {
    newValue = params.value.max;
  }

  value.value = newValue;

  const args = {
    paramValue: value.value,
    paramName: props.params.param,
  };
  // Handle empty input value
  if (args.paramValue.toString().length < 1) {
    args.paramValue = 0;
  }

  emit("change", args);
}
</script>
<template>
  <div class="setup-item setup-item--color-temperature">
    <UCColorTemp
      v-model="value"
      :min="params.min"
      :max="params.max"
      :disabled="disabled"
      @change="emitChange"
    />
  </div>
</template>
