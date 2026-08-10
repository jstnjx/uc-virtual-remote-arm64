<!-- Entity command parameter `type: enum` -->
<script setup lang="ts">
import { ref, watch } from "vue";

import translatedProperty from "@/composables/translatedProperty";

import UCColorTemp from "@/components/ui/UCColorTemp.vue";

const props = defineProps({
  value: {
    type: [Number, String],
    required: true,
  },
  meta: {
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

function emitChange(value: any) {
  emit("change", value);
}
</script>
<template>
  <div class="param-setup param-setup--color-temperature">
    <span class="param-setup__label">
      {{ translatedProperty(meta?.name) }}
    </span>
    <UCColorTemp
      v-model="value"
      :min="meta?.min"
      :max="meta?.max"
      :disabled="disabled"
      @change="emitChange"
    />
  </div>
</template>
