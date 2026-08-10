<script setup lang="ts">
import { computed } from "vue";

import ApiConnection from "@/api";
import { useImageLoader } from "@/composables/imageLoader";

const props = defineProps({
  iconId: {
    type: String,
    default: null,
  },
  fallbackIcon: {
    type: String,
    default: "",
  },
});

const url = computed(() => {
  const patternCtv = /^ctv:/;
  const baseIconId = props.iconId?.replace("custom:", "").replace("ctv:", "");

  if (baseIconId && patternCtv.test(props.iconId)) {
    return ApiConnection.rest().resourceUrl("TvChannelIcon", baseIconId);
  } else if (baseIconId) {
    return ApiConnection.rest().resourceUrl("Icon", baseIconId);
  } else {
    return "";
  }
});

const { status } = useImageLoader(url);

function fallbackIconClasses() {
  return ["icon", props.fallbackIcon];
}
</script>
<template>
  <div class="vue-load-image">
    <template v-if="props.iconId">
      <img v-if="status === 'loaded'" :src="url" role="presentation" alt="" />
      <i v-else-if="status === 'failed'" :class="fallbackIconClasses()" />
    </template>
    <i v-else :class="fallbackIconClasses()" />
  </div>
</template>
