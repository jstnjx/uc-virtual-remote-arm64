<script setup lang="ts">
import { ref, computed, watch, getCurrentInstance } from "vue";
const props = defineProps({
  value: {
    type: Number,
    default: 0,
    required: true,
  },
});

const emit = defineEmits(["change"]);

const value = ref(props.value);
const lastEmitted = ref(props.value);

watch(
  () => props.value,
  (v) => {
    if (v === lastEmitted.value) return;

    value.value = v;
    lastEmitted.value = v;
  },
);

const instanceId = getCurrentInstance()!.uid;

const inputStyle = computed(() => {
  return `max-width: ${value.value.toString().length * 0.35 + 1.5}rem`;
});

function emitChange() {
  const newValue = Math.max(0, Math.min(Number(value.value) || 0, 100000));
  value.value = newValue;

  if (newValue === lastEmitted.value) return;
  lastEmitted.value = newValue;

  emit("change", { paramValue: newValue });
}
</script>
<template>
  <div class="setup-item setup-item--ms">
    <div class="setup-item__body">
      <input
        :id="`setup-ms-${instanceId}`"
        v-model="value"
        :style="inputStyle"
        type="number"
        @keyup.enter="emitChange"
        @blur="emitChange"
      />
      <label :for="`setup-ms-${instanceId}`" class="setup-item__label"></label>
      <span class="setup-item__unit">ms</span>
    </div>
  </div>
</template>
