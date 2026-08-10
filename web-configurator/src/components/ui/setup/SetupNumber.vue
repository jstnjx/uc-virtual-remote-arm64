<script setup lang="ts">
import { ref, watch, computed, getCurrentInstance } from "vue";
const props = defineProps({
  value: {
    type: Number,
    required: true,
  },
  params: {
    type: Object,
    required: true,
  },
  hasStepper: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const value = ref(props.value);
const lastEmitted = ref(props.value);

const instanceId = getCurrentInstance()!.uid;

const emit = defineEmits(["change"]);

watch(
  () => props.value,
  (v) => {
    value.value = v;
    lastEmitted.value = v;
  },
);

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

const inputStyle = computed(() => {
  return `max-width: ${value.value.toString().length * 0.5 + 0.75}rem`;
});

function emitChange() {
  let newValue = Number(value.value) || 0;

  if (params.value.min !== undefined && newValue < params.value.min) {
    newValue = params.value.min;
  }

  if (params.value.max !== undefined && newValue > params.value.max) {
    newValue = params.value.max;
  }

  if (newValue === lastEmitted.value) return;

  value.value = newValue;
  lastEmitted.value = newValue;

  emit("change", {
    paramValue: newValue,
    paramName: props.params.param,
  });
}
</script>
<template>
  <div class="setup-item setup-item--number">
    <div class="setup-item__body">
      <input
        :id="`setup-number-${instanceId}`"
        v-model="value"
        :style="inputStyle"
        type="number"
        :min="params.min"
        :max="params.max"
        :step="params.step"
        :disabled="disabled"
        @keyup.enter="emitChange"
        @blur="emitChange"
      />
      <label
        :for="`setup-number-${instanceId}`"
        class="setup-item__label"
      ></label>
      <span class="setup-item__unit">{{ params.unit }}</span>
    </div>
  </div>
</template>
