<script setup lang="ts">
import { computed, onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useTranslation } from "i18next-vue";

import type { ActivityUserInterfaceItem } from "@/types/activity";
import { BinarySensorUnit } from "@/types/enums";

import { integrationsStore } from "@/stores/integrations";
import { configStore } from "@/stores/config";

import { getComponentClasses } from "@/composables/components";
import { getBinarySensorState } from "@/composables/activities";
import { getItemAttrValue } from "@/composables/entity";

const integrationsStorage = integrationsStore();
const configStorage = configStore();

const { configuredSensorEntities } = storeToRefs(integrationsStorage);
const { config } = storeToRefs(configStorage);

const { t } = useTranslation();

const props = defineProps({
  settings: {
    type: Object,
    default: null,
  },
});

const timeFormat24h = computed(() => {
  return config.value?.localization?.time_format_24h ?? true;
});

const entity = computed(() => {
  return configuredSensorEntities.value.list.find(
    (e) => e.entity_id === props.settings.sensor.sensor_id,
  );
});

const attributes = computed(() => entity.value?.attributes);
const options = computed(() => entity.value?.options);

const label = computed(() => {
  if (props.settings?.text) return props.settings.text;

  if (attributes.value?.custom_label) {
    return attributes.value.custom_label;
  }

  const deviceClass = entity.value?.device_class;
  if (deviceClass && deviceClass !== "custom" && deviceClass !== "binary") {
    return t(`entity.device_class.${deviceClass}`);
  }

  return "";
});

const hasValue = computed(() => {
  return attributes.value?.value !== undefined;
});

const isEmptyComponent = computed(() => {
  const hasLabel =
    ((props.settings?.text && props.settings?.text.length > 0) ||
      props.settings?.sensor?.show_label) &&
    label.value.length > 0;

  return !(hasLabel || hasValue.value || attributes.value?.unit);
});

function capitalizeFirst(value: unknown) {
  if (typeof value !== "string") return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

onMounted(async () => {
  if (
    configuredSensorEntities.value.list.length < 1 &&
    !configuredSensorEntities.value.fetching
  ) {
    try {
      await integrationsStorage.getConfiguredSensorEntities(false);
    } catch (e) {
      console.error(e);
    }
  }
});
</script>
<template>
  <div
    :class="
      getComponentClasses('sensor', settings as ActivityUserInterfaceItem)
    "
    :title="label"
  >
    <span
      v-if="
        ((props.settings?.text && props.settings?.text.length > 0) ||
          props.settings.sensor.show_label) &&
        label.length > 0
      "
      class="ui-component--sensor__label"
    >
      {{ label }}
    </span>
    <div v-if="entity" class="ui-component--sensor__data">
      <template v-if="entity.device_class === 'binary'">
        <template
          v-if="
            attributes?.unit !== undefined && attributes?.value !== undefined
          "
        >
          {{
            capitalizeFirst(
              $t(
                `entity.state.${getBinarySensorState(
                  attributes.unit as BinarySensorUnit,
                  attributes.value,
                )}`,
              ),
            )
          }}
        </template>
      </template>
      <template v-else>
        <template v-if="attributes?.value !== undefined">
          {{
            capitalizeFirst(
              getItemAttrValue(
                attributes.value,
                timeFormat24h,
                options?.decimals as number | undefined,
              ),
            )
          }}
        </template>
        <template
          v-if="
            (attributes?.unit !== undefined ||
              options?.custom_unit !== undefined) &&
            props.settings.sensor.show_unit
          "
          >&nbsp;{{ attributes?.unit ?? options?.custom_unit }}</template
        >
      </template>
    </div>
    <div
      v-if="entity && isEmptyComponent"
      class="ui-component--sensor__placeholder"
    >
      <i class="fa-light fa-gauge"></i>
    </div>
  </div>
</template>
