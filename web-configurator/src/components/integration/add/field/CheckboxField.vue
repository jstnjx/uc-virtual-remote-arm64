<script setup lang="ts">
import { onMounted, ref } from "vue";

import type { LanguageText } from "@/types/config";
import type { SettingTypeCheckbox } from "@/types/integrationInstance";

import translatedProperty from "@/composables/translatedProperty";

import UCToggle from "@/components/ui/UCToggle.vue";

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

const field = ref(props.field as SettingTypeCheckbox);
const label = ref(props.label as LanguageText);
const value = ref<boolean>(field.value.checkbox.value || false);

function emitChange() {
  emit("change", props.id, value.value);
}
onMounted(() => {
  emitChange();
});
</script>
<template>
  <div class="add-integration__field add-integration__field--checkbox">
    <UCToggle
      v-model="value"
      :label="translatedProperty(label)"
      :full-w="true"
      :error-message="error"
      @change="emitChange"
    />
  </div>
</template>
