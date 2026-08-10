<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import type { SettingTypeNumber } from "@/types/integrationInstance";
import type { LanguageText } from "@/types/config";

import translatedProperty from "@/composables/translatedProperty";

import UCInput from "@/components/ui/UCInput.vue";

const props = defineProps({
  id: {
    type: String,
    required: true,
  },
  fieldId: {
    type: String,
    required: true,
  },
  label: {
    type: Object,
    required: true,
  },
  field: {
    type: Object,
    required: true,
  },
  error: {
    type: String,
  },
});
const emit = defineEmits(["change"]);

const field = ref(props.field as SettingTypeNumber);
const label = ref(props.label as LanguageText);
const value = ref(props.field.number.value || 0);
const step = computed(() => {
  if (field.value.number.steps) {
    return field.value.number.steps;
  }
  if (field.value.number.decimals) {
    const zero = 0;
    const stepValue = zero
      .toLocaleString("en-US", {
        minimumFractionDigits: field.value.number.decimals,
      })
      .replace(/0$/, "1")
      .replace(/,/g, ".");
    if (stepValue !== "0") {
      return parseFloat(stepValue);
    }
  }
  return 1;
});
function emitChange() {
  emit("change", props.id, value.value);
}
onMounted(() => {
  emitChange();
});
</script>
<template>
  <div class="add-integration__field add-integration__field--number">
    <UCInput
      v-model="value"
      :label="translatedProperty(label)"
      :type="'number'"
      :full-w="true"
      :error-message="error"
      :number-min="field.number.min"
      :number-max="field.number.max"
      @input="emitChange"
    />
  </div>
</template>
