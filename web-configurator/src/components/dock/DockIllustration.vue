<script setup lang="ts">
import { computed } from "vue";

import { useTextHelper } from "@/composables/textHelper.ts";

const { isLetter } = useTextHelper();

const props = defineProps({
  dock: {
    type: Object,
    default: () => ({ model: "UCD3" }),
  },
});

const isDockTwo = computed(() => {
  return props.dock.model.includes("UCD2") || false;
});

const dockVersion = computed(() => {
  const serial = props.dock.serial || "";
  const type = serial.charAt(serial.length - 1)?.toLowerCase() || "";
  const color = serial.charAt(serial.length - 2)?.toLowerCase() || "";

  if (isDockTwo.value) {
    return "dock-2";
  } else if (isLetter(type) && isLetter(color)) {
    return `dock-${color}-${type}`;
  } else {
    return "dock-d-c";
  }
});

const dockImageUrl = computed(() => {
  return `${import.meta.env.BASE_URL}images/dock/${dockVersion.value}.webp`;
});
</script>
<template>
  <img :src="dockImageUrl" alt="Dock" />
</template>
