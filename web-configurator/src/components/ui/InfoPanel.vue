<script setup lang="ts">
import { computed } from "vue";

const props = defineProps({
  text: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    default: "notice",
  },
  icon: {
    type: String,
    default: "",
  },
});

const iconClasses = computed(() => {
  if (props.icon.length > 0) {
    return props.icon;
  }
  if (props.type == "notice") {
    return "fa-circle-exclamation";
  }
  return "";
});
</script>
<template>
  <div class="info-panel" :class="`info-panel--${type}`">
    <i class="info-panel__icon fa-light" :class="iconClasses"></i>
    <span class="info-panel__text">{{ text }}</span>
  </div>
</template>
