<!-- Entity command parameter `type: selection` -->
<script setup lang="ts">
import { ref, watch, type PropType } from "vue";
import translatedProperty from "@/composables/translatedProperty";

import UCInput from "@/components/ui/UCInput.vue";
import SetupSelection from "@/components/ui/setup/SetupSelection.vue";

const props = defineProps({
  value: {
    type: String,
    required: true,
  },
  meta: {
    type: Object,
    required: true,
  },
  options: {
    type: Array as PropType<string[]>,
    default: () => [],
  },
  compact: {
    type: Boolean,
    default: false,
  },
  allowFreeText: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});
const emit = defineEmits(["change"]);

const value = ref(props.value);
const selected = ref(props.value);
const lastEmitted = ref(props.value);

watch(
  () => props.value,
  (v) => {
    value.value = v;
    selected.value = v;
    lastEmitted.value = v;
  },
);

function updateTextValue(v: unknown) {
  if (v === lastEmitted.value) return;

  lastEmitted.value = v as string;
  value.value = v as string;

  emit("change", v);
}

function updateInputTextValue(event: Event) {
  const target = event.target;

  if (target instanceof HTMLInputElement) {
    updateTextValue(target.value);
  }
}

function emitChange(val: any) {
  if (val?.paramValue === undefined) return;

  if (val.paramValue === lastEmitted.value) return;

  lastEmitted.value = val.paramValue;
  selected.value = val.paramValue;

  emit("change", val.paramValue);
}
</script>
<template>
  <div
    v-if="meta.param && options && options.length > 0"
    class="param-setup param-setup--selection"
  >
    <span class="param-setup__label">
      {{ translatedProperty(meta?.name) }}
    </span>
    <SetupSelection
      class="param-setup__selection"
      :value="selected"
      :params="meta"
      :options="options"
      :allow-free-text="allowFreeText"
      :disabled="disabled"
      @change="emitChange"
    />
  </div>
  <div v-else-if="meta.param && value != null && compact">
    <label :for="`input-${meta.param}`" class="edit-label">{{
      $t("ui.label")
    }}</label>
    <input
      :id="`input-${meta.param}`"
      :value="value"
      :disabled="disabled"
      class="text-input"
      type="text"
      @keyup.enter="updateInputTextValue"
      @blur="updateInputTextValue"
    />
  </div>
  <UCInput
    v-else-if="meta.param && value != null"
    v-model="value"
    :label="translatedProperty(meta?.name)"
    :full-w="true"
    :disabled="disabled"
    @submit="updateTextValue"
  />
</template>
