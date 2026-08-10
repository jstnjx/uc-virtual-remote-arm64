<script setup lang="ts">
import type { ActivityUserInterfaceItem } from "@/types/activity";

import { getComponentClasses } from "@/composables/components";

defineProps({
  settings: {
    type: Object,
    default: null,
  },
});
</script>
<template>
  <div
    :class="getComponentClasses('text', settings as ActivityUserInterfaceItem)"
    :title="settings?.text || $t('widget.type.text.default_text')"
  >
    <span class="ui-component--text__text">
      {{ settings?.text || $t("widget.type.text.default_text") }}
    </span>
  </div>
</template>
