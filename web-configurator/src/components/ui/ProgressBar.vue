<script setup lang="ts">
const props = defineProps({
  progress: {
    type: Number,
    default: 0,
  },
});
</script>
<template>
  <div class="progress-bar">
    <div
      class="progress-bar__progress"
      :style="`width:${props.progress}%`"
    ></div>
  </div>
</template>
