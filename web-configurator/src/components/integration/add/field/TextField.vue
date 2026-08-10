<script setup lang="ts">
import { onMounted, ref } from "vue";

import type { SettingTypeText } from "@/types/integrationInstance";
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

const field = ref(props.field as SettingTypeText);
const label = ref(props.label as LanguageText);
const value = ref(field.value.text.value || "");

function emitChange() {
  emit("change", props.id, value.value);
}
onMounted(() => {
  emitChange();
});
</script>
<template>
  <div class="add-integration__field add-integration__field--text">
    <UCInput
      v-model="value"
      :label="translatedProperty(label)"
      :type="'text'"
      :full-w="true"
      :error-message="error"
      @input="emitChange"
    />
  </div>
</template>
