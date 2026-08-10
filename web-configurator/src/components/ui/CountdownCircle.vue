<script setup lang="ts">
import { computed } from "vue";

const props = defineProps({
  progress: { type: Number, default: 0 },
});

const radius = 48;
const circumference = 2 * Math.PI * radius;

const dashOffset = computed(() => props.progress * circumference);
</script>

<template>
  <div class="countdown-circle">
    <svg viewBox="0 0 100 100" class="countdown-circle__svg">
      <circle
        class="countdown-circle__circle"
        cx="50"
        cy="50"
        r="48"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
      />
    </svg>
    <span class="countdown-circle__icon">
      <i class="fa-regular fa-stopwatch"></i>
    </span>
  </div>
</template>
