<script setup lang="ts">
import { ref } from "vue";

import type { SettingTypeLabel } from "@/types/integrationInstance";
import type { LanguageText } from "@/types/config";

import translatedProperty from "@/composables/translatedProperty";

import VueMarkdown from "vue-markdown-render";

const props = defineProps({
  id: {
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
const field = ref(props.field as SettingTypeLabel);
const label = ref(props.label as LanguageText);
</script>
<template>
  <div class="add-integration__field add-integration__field--label">
    <div class="add-integration__field--label__label">
      {{ translatedProperty(label) }}
    </div>
    <div v-markdown-tools class="markdown-wrapper">
      <vue-markdown
        :source="translatedProperty(field.label.value) || ''"
        class="vue-markdown"
      />
    </div>
  </div>
</template>
