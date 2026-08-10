<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import { useElementSize } from "@vueuse/core";
import type { ActivityUserInterfaceItem } from "@/types/activity";

import { getComponentClasses } from "@/composables/components";

const props = defineProps({
  settings: {
    type: Object,
    default: null,
  },
});

const uiComponentMediaPlayer = useTemplateRef<HTMLDivElement>(
  "uiComponentMediaPlayer",
);

const settings = ref<ActivityUserInterfaceItem>(
  props.settings as ActivityUserInterfaceItem,
);

/**
 * Observed rather than measured once.
 *
 * The widget is sized by the grid cell it sits in, and that cell changes shape
 * without this component being re-created: on a window resize, and when the page
 * grid gains or loses rows. A `getBoundingClientRect()` read inside the computed
 * below could not see either — nothing invalidates it — so the layout the class
 * picks was whatever the first measurement happened to be. Worse, the editor
 * panel lives behind a `v-show` tab, so a widget mounted while that tab is
 * closed measured 0x0 and stayed in the wrong layout once shown.
 *
 * The box is imposed from outside, so the class this drives cannot feed back
 * into it.
 */
const { width, height } = useElementSize(uiComponentMediaPlayer);

const mainClasses = computed(() => {
  let classList = "";

  // Wide and short: cover art beside the track info instead of above it.
  if (width.value > 0 && height.value / width.value < 0.6) {
    classList += "ui-component--media-player--compact ";
  }

  classList +=
    getComponentClasses("media-player", settings.value).join(" ") + " ";
  return classList;
});
</script>
<template>
  <div ref="uiComponentMediaPlayer" :class="mainClasses">
    <div class="ui-component--media-player__cover">
      <i class="fa-regular fa-image"></i>
    </div>
    <div class="ui-component--media-player__main">
      <h1 class="ui-component--media-player__title">
        {{ $t("widget.type.media.component.media_title") }}
      </h1>
      <p class="ui-component--media-player__source">
        {{ $t("widget.type.media.component.source") }}
      </p>
      <div class="ui-component--media-player__progress">
        <div class="ui-component--media-player__progress__line">
          <span></span>
        </div>
        <div class="ui-component--media-player__progress__time">
          <span class="ui-component--media-player__progress__time__value"
            >20:32</span
          >
          <span class="ui-component--media-player__progress__time__value"
            >-29:18</span
          >
        </div>
      </div>
    </div>
  </div>
</template>
