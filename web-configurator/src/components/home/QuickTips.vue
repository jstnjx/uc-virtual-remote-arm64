<script setup lang="ts">
import { computed } from "vue";
import { Carousel, Pagination, Slide } from "vue3-carousel";
// Carousel base styles (was eagerly imported in main.ts); the per-screen SCSS in
// src/assets/components overrides appearance on top of it.
import "vue3-carousel/carousel.css";

import { useQuickTips } from "@/composables/quickTips";

const { getQuickTips } = useQuickTips();

const quickTips = computed(() => getQuickTips() || []);
const autoplayTiming = computed(() => (quickTips.value.length > 1 ? 10000 : 0));
</script>
<template>
  <div class="quick-tips">
    <Carousel
      class="quick-tips__carousel"
      :autoplay="autoplayTiming"
      :transition="1000"
      :pause-autoplay-on-hover="true"
      :wrap-around="true"
    >
      <Slide v-for="quickTip in quickTips" :key="quickTip.headline">
        <div class="quick-tips__item">
          <div
            v-if="quickTip.img && quickTip.img.length > 0"
            class="quick-tips__item__image"
          >
            <img :alt="quickTip.headline" :src="quickTip.img" />
          </div>
          <div class="quick-tips__item__body">
            <h2>{{ quickTip.headline }}</h2>
            <p>{{ quickTip.body }}</p>
          </div>
        </div>
      </Slide>

      <template v-if="quickTips.length > 1" #addons>
        <Pagination />
      </template>
    </Carousel>
  </div>
</template>
