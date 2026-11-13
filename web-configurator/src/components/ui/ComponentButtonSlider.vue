<script setup lang="ts">
// Slider widget preview (UC Virtual Remote implementation).
import { computed, onMounted } from "vue";
import { storeToRefs } from "pinia";

import type { ActivityUserInterfaceItem } from "@/types/activity";

import { integrationsStore } from "@/stores/integrations";

import { getComponentClasses } from "@/composables/components";
import { sliderFeatureData, sliderValueText } from "@/composables/numberEntity";
import translatedProperty from "@/composables/translatedProperty";

import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";

const integrationsStorage = integrationsStore();
const { configuredSliderEntities } = storeToRefs(integrationsStorage);

const props = defineProps({
  settings: {
    type: Object,
    default: null,
  },
});

const config = computed(() => props.settings?.slider ?? {});

const entity = computed(() =>
  config.value.entity_id
    ? (integrationsStorage.findCachedEntity(config.value.entity_id) ??
      configuredSliderEntities.value.list.find(
        (e) => e.entity_id === config.value.entity_id,
      ))
    : undefined,
);

const data = computed(() =>
  sliderFeatureData(entity.value, config.value.feature),
);

const label = computed(() => {
  if (config.value.show_name && entity.value) {
    return translatedProperty(entity.value.name);
  }
  return props.settings?.text ?? "";
});

const range = computed(() => {
  if (!data.value) return null;
  const min = Number.isFinite(config.value.min)
    ? Math.max(data.value.min, config.value.min)
    : data.value.min;
  const max = Number.isFinite(config.value.max)
    ? Math.min(data.value.max, config.value.max)
    : data.value.max;
  const value = Math.max(min, Math.min(max, data.value.value));
  const ratio = max > min ? (value - min) / (max - min) : 0;
  return { min, max, value, ratio };
});

const style = computed(() =>
  ["bar", "buttons"].includes(config.value.style)
    ? config.value.style
    : "default",
);

// Fill: `center` starts at 0 when the range includes it, `cursor` has no fill.
const fillStyle = computed(() => {
  if (!range.value) return {};
  const { min, max, ratio } = range.value;
  const vertical = isVertical.value;
  if (config.value.fill === "center" && min < 0 && max > 0) {
    const zero = (0 - min) / (max - min);
    const start = Math.min(zero, ratio) * 100;
    const size = Math.abs(ratio - zero) * 100;
    return vertical
      ? { bottom: `${start}%`, height: `${size}%` }
      : { left: `${start}%`, width: `${size}%` };
  }
  return vertical
    ? { bottom: "0", height: `${ratio * 100}%` }
    : { left: "0", width: `${ratio * 100}%` };
});

const isVertical = computed(
  () =>
    Number(props.settings?.size?.height ?? 1) >
    Number(props.settings?.size?.width ?? 1),
);

const classes = computed(() => {
  const list = getComponentClasses(
    "slider",
    props.settings as ActivityUserInterfaceItem,
  );
  list.push(`ui-component--slider--${style.value}`);
  if (isVertical.value && style.value !== "buttons") {
    list.push("ui-component--slider--vertical");
  }
  if (config.value.color === "gradient") {
    list.push("ui-component--slider--gradient");
  }
  if (!data.value) list.push("ui-component--slider--empty");
  return list;
});

onMounted(async () => {
  if (
    configuredSliderEntities.value.list.length < 1 &&
    !configuredSliderEntities.value.fetching
  ) {
    try {
      await integrationsStorage.getConfiguredSliderEntities(false);
    } catch (e) {
      console.error(e);
    }
  }
});
</script>
<template>
  <div :class="classes" :title="label">
    <template v-if="data && range">
      <div
        v-if="label || config.show_value !== false"
        class="ui-component--slider__header"
      >
        <span class="ui-component--slider__label">{{ label }}</span>
        <span
          v-if="config.show_value !== false"
          class="ui-component--slider__value"
          >{{ sliderValueText(data, range.value) }}</span
        >
      </div>
      <div class="ui-component--slider__track">
        <i v-if="style === 'buttons'" class="fa-light fa-minus"></i>
        <SelectedIcon
          v-else-if="config.icon_min"
          :icon="config.icon_min"
          fallback-icon="uc:minus"
        />
        <div class="ui-component--slider__bar">
          <span
            v-if="config.fill !== 'cursor' && style !== 'buttons'"
            class="ui-component--slider__fill"
            :style="fillStyle"
          ></span>
          <span
            v-else-if="style !== 'buttons'"
            class="ui-component--slider__cursor"
            :style="
              isVertical
                ? { bottom: `${range.ratio * 100}%` }
                : { left: `${range.ratio * 100}%` }
            "
          ></span>
        </div>
        <i v-if="style === 'buttons'" class="fa-light fa-plus"></i>
        <SelectedIcon
          v-else-if="config.icon_max"
          :icon="config.icon_max"
          fallback-icon="uc:plus"
        />
      </div>
    </template>
    <template v-else>
      <i class="fa-light fa-sliders-simple"></i>
    </template>
  </div>
</template>
