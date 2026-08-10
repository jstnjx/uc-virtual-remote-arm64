<script setup lang="ts">
defineProps({
  show: {
    type: Boolean,
    default: false,
  },
});
</script>
<template>
  <Transition name="list-loader">
    <div v-show="show" class="list-loader">
      <img
        src="/images/loading-indicator.png"
        alt="Loading"
        class="list-loader__img img-loading"
      />
      <span class="list-loader__text">{{ $t("ui.loading_more") }}</span>
    </div>
  </Transition>
</template>
