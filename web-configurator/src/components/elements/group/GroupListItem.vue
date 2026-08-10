<script setup lang="ts">
import { ref, computed, watch } from "vue";
import type { Group } from "@/types/group";

import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";

const props = defineProps({
  listItem: {
    type: Object,
    required: true,
  },
  className: {
    type: String,
    default: "",
  },
  inactive: {
    type: Boolean,
    default: false,
  },
  editButton: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["remove", "executeCommand", "clickMeta", "edit"]);
const item = ref<Group>(props.listItem as Group);

watch(props, () => {
  item.value = props.listItem as Group;
});

const entitiesNumber = computed(() => {
  if (item.value.entities && item.value.entities.length) {
    return item.value.entities.length;
  }

  return 0;
});

function clickMeta() {
  emit("clickMeta", props.listItem);
}

function clickEdit() {
  emit("edit", props.listItem);
}
</script>
<template>
  <slot name="checkbox" />
  <SelectedIcon
    :icon="item?.icon || 'uc:puzzle'"
    :thin="true"
    class="entity-item__icon"
  />

  <div class="entity-item__meta" @click="clickMeta">
    <span class="entity-item__title" :title="item.name">
      {{ item.name }}
    </span>
    <span class="entity-item__state">
      {{ entitiesNumber }} {{ $t(`entity.entities`) }}
    </span>
  </div>
  <div v-if="!!$slots.options">
    <slot name="options" />
  </div>
  <button
    v-else-if="editButton"
    class="button button--tertiary button--icon entity-item__edit"
    @click="clickEdit"
  >
    <i class="fa-light fa-edit"></i>
  </button>
</template>
