<script setup lang="ts">
import { ref } from "vue";
import type { ActivityUserInterfaceItem } from "@/types/activity";

import { getComponentClasses } from "@/composables/components";

import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";

const props = defineProps({
  settings: {
    type: Object,
    default: null,
  },
});
const settings = ref<ActivityUserInterfaceItem>(
  props.settings as ActivityUserInterfaceItem,
);
</script>
<template>
  <div :class="getComponentClasses('icon', settings)">
    <SelectedIcon :icon="settings?.icon || 'uc:tv'" :square="true" />
  </div>
</template>
