<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { storeToRefs } from "pinia";
import { asyncComputed } from "@vueuse/core";
import { useTranslation } from "i18next-vue";

import { BinarySensorUnit, EntityType } from "@/types/enums";
import type {
  AvailableEntity,
  ConfiguredEntity,
  IntegrationInstance,
} from "@/types/integrationInstance";

import { configStore } from "@/stores/config";

import { getDefaultEntityIcon, getItemAttrValue } from "@/composables/entity";
import translatedProperty from "@/composables/translatedProperty";
import { getIconName } from "@/composables/icon";
import { getBinarySensorState } from "@/composables/activities";
import { normalizeState } from "@/utils/state";

import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";

const triggeringTypes = [
  "button",
  "climate",
  "cover",
  "light",
  "media_player",
  "switch",
  "select",
];

const configStorage = configStore();

const { t, i18next } = useTranslation();

const props = defineProps({
  listItem: {
    type: Object,
    required: true,
  },
  instances: {
    type: Array,
    default: () => [],
  },
  editButton: {
    type: Boolean,
    default: false,
  },
  inactive: {
    type: Boolean,
    default: false,
  },
  dangling: {
    type: Boolean,
    default: false,
  },
  integrationInfo: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["clickMeta", "executeCommand", "edit"]);

const { config } = storeToRefs(configStorage);

const item = ref<AvailableEntity | ConfiguredEntity>(
  props.listItem as ConfiguredEntity,
);
const itemLastAttributes = ref(item.value.attributes || {});
const itemLastState = ref(normalizeState(item.value.attributes?.state) || "");

watch(props, () => {
  item.value = props.listItem as ConfiguredEntity;

  if (item.value.attributes) {
    itemLastAttributes.value = item.value.attributes;
  }

  if (item.value.attributes?.state) {
    itemLastState.value = normalizeState(item.value.attributes?.state);
  }
});

const timeFormat24h = computed(() => {
  return config.value?.localization?.time_format_24h ?? true;
});

const stateAttribute = computed(() => {
  const rawValue =
    item?.value?.attributes?.value ?? (itemLastAttributes.value as any)?.value;
  const unit =
    item?.value?.attributes?.unit ??
    (itemLastAttributes.value as any)?.unit ??
    getCustomUnitOfCustomDevice(item.value);

  if (
    Object.keys(itemLastAttributes.value).length < 1 &&
    itemLastState.value.length < 1 &&
    rawValue == null &&
    !unit &&
    item?.value?.device_class !== "custom"
  ) {
    return null;
  }

  // entity type: select - display current option
  if (
    item?.value?.entity_type === EntityType.select &&
    item?.value?.attributes?.current_option !== undefined
  ) {
    return item?.value?.attributes?.current_option;
  }

  // check if binary sensor entity: show specific state
  if (rawValue != null && unit && item?.value?.device_class === "binary") {
    const binaryState = getBinarySensorState(
      unit as BinarySensorUnit,
      rawValue,
    );

    if (!binaryState) {
      return null;
    }

    const binaryStateLangKey = `entity.state.${binaryState}`;
    return i18next.exists(binaryStateLangKey)
      ? t(binaryStateLangKey)
      : binaryState;
  }

  // check if sensor entity: show sensor value and optional unit
  if (rawValue != null || unit) {
    const formattedValue =
      rawValue != null
        ? getItemAttrValue(
            rawValue,
            timeFormat24h.value,
            item?.value?.options?.decimals as number | undefined,
          )
        : "";
    return [formattedValue, unit].filter(Boolean).join(" ");
  }

  const rawState = item?.value?.attributes?.state ?? itemLastState.value;

  const normalizedState = rawState?.toLowerCase()?.trim();

  if (!normalizedState) {
    return null;
  }

  const stateLangKey = `entity.state.${normalizedState}`;
  return i18next.exists(stateLangKey) ? t(stateLangKey) : normalizedState;
});

const isOff = computed(() => {
  const itemState = normalizeState(item.value.attributes?.state);
  return (
    itemState == "off" || itemState == "unknown" || itemState == "unavailable"
  );
});

const isUnavailable = computed(() => {
  const itemState = normalizeState(item.value.attributes?.state);
  return itemState == "unavailable";
});

const canTrigger = computed(() => {
  if (props.inactive) {
    return false;
  }
  const itemType = item.value.entity_type
    ? item.value.entity_type.toLowerCase()
    : "undefined";
  return triggeringTypes.includes(itemType);
});

const iconPuzzle = asyncComputed(async () => {
  return await getIconName("fa-puzzle-piece");
});

const integrationIcon = computed(() => {
  // const pattern = /^uc:/;

  const inst = (props.instances as IntegrationInstance[]).find((inst) => {
    return inst.integration_id === props.listItem.integration_id;
  });

  if (inst?.icon) {
    return inst?.icon;
  }

  if (!props.listItem.integration?.icon) {
    return "";
  }

  // if (!pattern.test(props.listItem.integration?.icon)) {
  //   return '' ;
  // }

  return props.listItem.integration?.icon;
});

const iconClasses = computed(() => {
  let classList = "";
  classList += isOff.value ? `entity-item__icon--inactive ` : "";
  classList += isUnavailable.value ? `entity-item__icon--unavailable ` : "";
  classList += canTrigger.value ? `entity-item__icon--trigger ` : "";
  return classList;
});

function getCustomUnitOfCustomDevice(itm: AvailableEntity | ConfiguredEntity) {
  if (
    itm.device_class &&
    itm.device_class === "custom" &&
    itm.options &&
    itm.options.custom_unit
  ) {
    return itm.options.custom_unit ?? null;
  }

  return null;
}

function clickMeta() {
  emit("clickMeta", props.listItem);
}

function clickEdit() {
  emit("edit", props.listItem);
}

function executeCommand() {
  if (!canTrigger.value || isUnavailable.value) {
    return false;
  }

  emit("executeCommand", props.listItem);
}
</script>
<template>
  <slot name="checkbox" />
  <div class="entity-item__icon" :class="iconClasses" @click="executeCommand">
    <i
      v-if="dangling"
      class="fa-thin fa-skull-crossbones entity-item__icon__status--dangling"
    ></i>
    <SelectedIcon
      v-else
      :icon="getDefaultEntityIcon(item)"
      :thin="true"
      fallback-icon="icon-integration"
    />
  </div>
  <div class="entity-item__meta" @click="clickMeta">
    <span
      class="entity-item__title"
      :class="{ 'entity-item__title--inactive': isOff }"
      :title="translatedProperty(item.name)"
    >
      {{ translatedProperty(item.name) }}
    </span>
    <span
      v-if="dangling || stateAttribute !== undefined"
      class="entity-item__state"
    >
      <template v-if="dangling">{{ $t("entity.non_existent") }}</template>
      <template v-else>{{ stateAttribute }}</template>
    </span>
  </div>
  <div v-if="!!$slots.options">
    <slot name="options" />
  </div>
  <button
    v-else-if="editButton && !dangling"
    class="button button--secondary button--icon entity-item__edit"
    @click="clickEdit"
  >
    <i class="fa-light fa-edit"></i>
  </button>
  <div v-if="integrationInfo" class="entity-item__integration">
    <SelectedIcon
      :icon="integrationIcon"
      :fallback-icon="`fa-thin ${iconPuzzle}`"
    />
  </div>
</template>
