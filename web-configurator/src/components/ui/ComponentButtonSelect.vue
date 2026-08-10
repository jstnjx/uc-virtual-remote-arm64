<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { storeToRefs } from "pinia";

import type { ActivityUserInterfaceItem } from "@/types/activity";

import { integrationsStore } from "@/stores/integrations";

import { getComponentClasses } from "@/composables/components";
import translatedProperty from "@/composables/translatedProperty";

const integrationsStorage = integrationsStore();

const { configuredSelectEntities } = storeToRefs(integrationsStorage);

const props = defineProps({
  settings: {
    type: Object,
    default: null,
  },
});

const elComponent = useTemplateRef<HTMLDivElement>("elComponent");
const componentWidth = ref(0);
const componentHeight = ref(0);
const initedComponentObserver = ref(false);

const elIcon = useTemplateRef<HTMLDivElement>("elIcon");
const iconWidth = ref(0);
const initedIconObserver = ref(false);

let componentObserver: ResizeObserver;
let iconObserver: ResizeObserver;

watch(
  elComponent,
  (el) => {
    if (!el || initedComponentObserver.value) return;
    initedComponentObserver.value = true;
    initComponentObserver();
  },
  {
    immediate: true,
    flush: "post",
  },
);

watch(
  elIcon,
  (el) => {
    if (!el || initedIconObserver.value) return;
    initedIconObserver.value = true;
    initIconObserver();
  },
  {
    immediate: true,
    flush: "post",
  },
);

const entity = computed(() => {
  return configuredSelectEntities.value.list.find(
    (e) => e.entity_id === props.settings.select.select_id,
  );
});

const attributes = computed(() => entity.value?.attributes);

const name = computed(() => {
  return translatedProperty(entity.value?.name);
});

const label = computed(() => {
  if (props.settings?.select?.show_name && name.value) {
    return name.value;
  }

  if (props.settings?.text) return props.settings.text;

  return "";
});

const smallComponentWidth = computed(() => componentWidth.value < 90);
const largeComponentHeight = computed(() => componentHeight.value > 100);
const noIconSpace = computed(() => iconWidth.value < 24);

const hasCurrentOption = computed(() => {
  return (
    entity.value &&
    attributes.value?.current_option &&
    attributes.value?.current_option.length > 0
  );
});

const mainClasses = computed(() => {
  let classList = "";
  classList += `${getComponentClasses(
    "select",
    props.settings as ActivityUserInterfaceItem,
  ).join(" ")} `;
  classList += smallComponentWidth.value
    ? "ui-component--select--small-width "
    : "";
  classList += largeComponentHeight.value
    ? "ui-component--select--large-height "
    : "";

  return classList;
});

async function initComponentObserver() {
  if (!elComponent.value) return;

  componentWidth.value = elComponent.value.getBoundingClientRect().width;
  componentHeight.value = elComponent.value.getBoundingClientRect().height;

  componentObserver = new ResizeObserver((entries) => {
    componentWidth.value = entries[0].contentRect.width;
    componentHeight.value = entries[0].contentRect.height;
  });

  componentObserver.observe(elComponent.value);
}

async function initIconObserver() {
  if (!elIcon.value) return;

  iconWidth.value = elIcon.value.getBoundingClientRect().width;

  iconObserver = new ResizeObserver((entries) => {
    iconWidth.value = entries[0].contentRect.width;
  });

  iconObserver.observe(elIcon.value);
}

onMounted(async () => {
  if (
    configuredSelectEntities.value.list.length < 1 &&
    !configuredSelectEntities.value.fetching
  ) {
    try {
      await integrationsStorage.getConfiguredSelectEntities(false);
    } catch (e) {
      console.error(e);
    }
  }
});

onBeforeUnmount(() => {
  componentObserver?.disconnect();
  iconObserver?.disconnect();
});
</script>
<template>
  <div ref="elComponent" :class="mainClasses" :title="label">
    <div
      v-if="label.length > 0 || hasCurrentOption"
      class="ui-component--select__main"
    >
      <span v-if="label.length > 0" class="ui-component--select__label">
        {{ label }}
      </span>
      <div v-if="hasCurrentOption" class="ui-component--select__data">
        {{ attributes?.current_option }}
      </div>
    </div>
    <div
      ref="elIcon"
      class="ui-component--select__icon"
      :class="{ 'ui-component--select__icon--no-space': noIconSpace }"
    >
      <i class="fa-light fa-square-caret-down"></i>
    </div>
  </div>
</template>
