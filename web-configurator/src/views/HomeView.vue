<script setup lang="ts">
import { computed, defineAsyncComponent, useTemplateRef, watch } from "vue";
import { useRouter } from "vue-router";

import SectionHome from "@/components/home/SectionHome.vue";
import SectionCustomiseRemote from "@/components/customise-remote/SectionCustomiseRemote.vue";
// Async so vue3-carousel (pulled in by QuickTips) is not part of the eager entry
// chunk; it loads on demand with the quick tips.
const QuickTips = defineAsyncComponent(
  () => import("@/components/home/QuickTips.vue"),
);

// App.vue's <KeepAlive include="HomeView"> matches by component name; pin it
// explicitly so the cache key survives a future file rename.
defineOptions({ name: "HomeView" });

const router = useRouter();

const pageHome = useTemplateRef<HTMLDivElement>("pageHome");

const isCustomise = computed(() => {
  return (
    router.currentRoute.value &&
    router.currentRoute.value.meta &&
    router.currentRoute.value.meta.customiseRemote == true
  );
});

watch(isCustomise, (val) => {
  if (val) {
    pageHome.value && pageHome.value.scrollTo({ top: 0, left: 0 });
  }
});
</script>
<template>
  <Suspense>
    <div
      ref="pageHome"
      class="page-home"
      :class="{ 'page-home--customise': isCustomise }"
    >
      <SectionHome :active="isCustomise == false" />
      <SectionCustomiseRemote :folded="isCustomise == false" />
      <QuickTips
        class="quick-tips--tablet"
        :class="{ 'quick-tips--inactive': isCustomise == true }"
      />
    </div>
  </Suspense>
</template>
