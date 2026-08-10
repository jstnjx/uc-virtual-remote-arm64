<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { asyncComputed } from "@vueuse/core";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";

import type {
  AvailableEntity,
  ConfiguredEntity,
  IntegrationInstance,
} from "@/types/integrationInstance";

import { getDefaultEntityIcon } from "@/composables/entity";
import translatedProperty from "@/composables/translatedProperty";
import { getIconName } from "@/composables/icon";

import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";

const { t } = useTranslation();

const route = useRoute();
const router = useRouter();

const props = defineProps({
  listItem: {
    type: Object,
    required: true,
  },
  instances: {
    type: Array,
    default: () => [],
  },
  integrationInfo: {
    type: Boolean,
    default: false,
  },
  compact: {
    type: Boolean,
    default: false,
  },
  inCategoryList: {
    type: Boolean,
    default: false,
  },
});

const item = ref<AvailableEntity | ConfiguredEntity>(
  props.listItem as ConfiguredEntity,
);

watch(props, () => {
  item.value = props.listItem as ConfiguredEntity;
});

const itemTypeText = computed(() => {
  if (!props.listItem.entity_type) {
    return "";
  }

  return t(`entity.entity_type.${props.listItem.entity_type}`);
});

const itemTypeIcon = asyncComputed(async () => {
  const iconPuzzle = await getIconName("fa-puzzle-piece");
  if (!props.listItem.entity_type) {
    return iconPuzzle;
  }

  if (props.listItem.entity_type == "dock") {
    return "fa-square";
  } else if (props.listItem.entity_type == "infrared") {
    return "fa-tower-broadcast";
  } else if (props.listItem.entity_type == "bluetooth") {
    return "fa-bluetooth";
  } else {
    return iconPuzzle;
  }
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

const integrationName = computed(() => {
  const instanceList = props.instances as IntegrationInstance[];
  const integr = instanceList.find((inst) => {
    return inst.integration_id === props.listItem.integration_id;
  });

  return (integr && translatedProperty(integr.name)) || "";
});

function goto() {
  const entType = props.listItem.entity_type;
  const entId = props.listItem.entity_id;
  const category = route.query.category;

  if (entType == "activity") {
    router.push({
      name: "activity",
      params: { activity_id: entId },
      query: { parent: "entities" },
    });
  } else if (entType == "macro") {
    router.push({
      name: "macro",
      params: { macro_id: entId },
      query: { parent: "entities" },
    });
  } else if (entType == "remote") {
    router.push({
      name: "remote",
      params: { remote_id: entId },
      ...(category && { query: { category: category } }),
    });
  } else {
    router.push({
      name: "entity",
      params: { entity_id: entId },
      ...(category && { query: { category: category } }),
    });
  }
}
</script>
<template>
  <div
    class="base-entity-item"
    :class="{ 'base-entity-item--compact': compact }"
    @click="goto"
  >
    <div class="base-entity-item__main">
      <slot name="checkbox" />
      <div class="base-entity-item__icon">
        <SelectedIcon
          :icon="getDefaultEntityIcon(item)"
          fallback-icon="icon-integration"
        />
      </div>
      <span
        class="base-entity-item__name"
        :title="translatedProperty(item.name)"
      >
        {{ translatedProperty(item.name) }}
      </span>
    </div>
    <div class="base-entity-item__meta">
      <SelectedIcon
        v-if="integrationIcon || itemTypeIcon"
        :icon="integrationIcon || itemTypeIcon"
      />
      <template v-if="!compact">
        <span v-if="integrationName && integrationName.length > 0">{{
          integrationName
        }}</span>
        <span v-else-if="itemTypeText && itemTypeText.length > 0">{{
          itemTypeText
        }}</span>
      </template>
    </div>
  </div>
</template>
