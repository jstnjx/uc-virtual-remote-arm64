<script setup lang="ts">
import { ref } from "vue";
import type { DriverSetupConfirmationPage } from "@/types/integrationInstance";

import translatedProperty from "@/composables/translatedProperty";

import VueMarkdown from "vue-markdown-render";

const props = defineProps({
  confirmation: {
    type: Object,
    required: true,
  },
  className: {
    type: [String, Array, Object],
    default: "",
  },
});

const confirmation = ref<DriverSetupConfirmationPage>(
  props.confirmation as DriverSetupConfirmationPage,
);
</script>
<template>
  <div v-overflow-indicator :class="className">
    <h4 v-if="confirmation.title">
      {{ translatedProperty(confirmation.title) }}
    </h4>
    <div v-markdown-tools class="markdown-wrapper">
      <vue-markdown
        v-if="confirmation.message1"
        :source="translatedProperty(confirmation.message1)"
        class="vue-markdown"
      />
    </div>

    <img
      v-if="confirmation.image"
      role="presentation"
      alt=""
      :src="'data:image;base64, ' + confirmation.image"
    />

    <div v-markdown-tools class="markdown-wrapper">
      <vue-markdown
        v-if="confirmation.message2"
        :source="translatedProperty(confirmation.message2)"
        class="vue-markdown"
      />
    </div>
  </div>
</template>
