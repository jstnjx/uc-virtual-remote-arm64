<script setup lang="ts">
// Number widget preview (UC Virtual Remote implementation).
import { computed, onMounted } from "vue";
import { storeToRefs } from "pinia";

import type { ActivityUserInterfaceItem } from "@/types/activity";

import { integrationsStore } from "@/stores/integrations";

import { getComponentClasses } from "@/composables/components";
import {
  formatNumber,
  numberEntityData,
  numberRepresentation,
} from "@/composables/numberEntity";
import translatedProperty from "@/composables/translatedProperty";

const integrationsStorage = integrationsStore();
const { configuredNumberEntities } = storeToRefs(integrationsStorage);

const props = defineProps({
  settings: {
    type: Object,
    default: null,
  },
});

const config = computed(() => props.settings?.number ?? {});

const entity = computed(() =>
  config.value.number_id
    ? (integrationsStorage.findCachedEntity(config.value.number_id) ??
      configuredNumberEntities.value.list.find(
        (e) => e.entity_id === config.value.number_id,
      ))
    : undefined,
);

const data = computed(() => numberEntityData(entity.value));

const representation = computed(() =>
  numberRepresentation(entity.value, config.value.display_mode),
);

const label = computed(() => {
  if (config.value.show_name && entity.value) {
    return translatedProperty(entity.value.name);
  }
  return props.settings?.text ?? "";
});

const valueText = computed(() =>
  data.value.readable
    ? formatNumber(data.value.value, data.value.decimals, data.value.unit)
    : "—",
);

const ratio = computed(() => {
  const { min, max, value } = data.value;
  if (min === null || max === null || max <= min || value === null) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
});

onMounted(async () => {
  if (
    configuredNumberEntities.value.list.length < 1 &&
    !configuredNumberEntities.value.fetching
  ) {
    try {
      await integrationsStorage.getConfiguredNumberEntities(false);
    } catch (e) {
      console.error(e);
    }
  }
});
</script>
<template>
  <div
    :class="
      getComponentClasses('number', settings as ActivityUserInterfaceItem)
    "
    :title="label"
  >
    <template v-if="entity">
      <div
        v-if="representation === 'slider'"
        class="ui-component--slider__header"
      >
        <span class="ui-component--slider__label">{{ label }}</span>
        <span class="ui-component--slider__value">{{ valueText }}</span>
      </div>
      <span v-else-if="label" class="ui-component--number__label">{{
        label
      }}</span>
      <div
        v-if="representation === 'slider'"
        class="ui-component--slider__track"
      >
        <div class="ui-component--slider__bar">
          <span
            class="ui-component--slider__fill"
            :style="{ left: '0', width: `${ratio * 100}%` }"
          ></span>
        </div>
      </div>
      <div v-else class="ui-component--number__stepper">
        <span class="ui-component--number__button"
          ><i class="fa-light fa-minus"></i
        ></span>
        <span class="ui-component--number__value">{{ valueText }}</span>
        <span class="ui-component--number__button"
          ><i class="fa-light fa-plus"></i
        ></span>
      </div>
    </template>
    <template v-else>
      <i class="fa-light fa-input-numeric"></i>
    </template>
  </div>
</template>
