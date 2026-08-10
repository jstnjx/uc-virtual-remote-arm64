<script setup lang="ts">
import { useImageLoader } from "@/composables/imageLoader";

const props = defineProps({
  url: {
    type: String,
    required: true,
  },
});

const { status } = useImageLoader(() => props.url);
</script>
<template>
  <div>
    <div class="vue-load-image">
      <img
        v-if="status === 'loaded'"
        :src="props.url"
        role="presentation"
        alt=""
      />
    </div>
  </div>
</template>
