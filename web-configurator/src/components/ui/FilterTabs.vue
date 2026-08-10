<script setup lang="ts">
import translatedProperty from "@/composables/translatedProperty";

import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";

defineProps({
  list: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(["removeElement"]);

function showFilterListItem(key: string, collection: { [key: string]: any }) {
  return (collection && collection[key].selected === true) || false;
}

function removeElement(el: any) {
  emit("removeElement", el);
}
</script>
<template>
  <template v-for="el in Object.keys(list)" :key="el">
    <div
      v-if="list && showFilterListItem(el, list)"
      class="filter-tab"
      @click="removeElement(el)"
    >
      <SelectedIcon v-if="list[el].icon" :icon="list[el].icon" class="icon" />
      <SelectedIcon v-else :icon="`uc:${el}`" class="icon" />
      <span v-if="list[el].name" class="filter-tab__name">{{
        translatedProperty(list[el].name)
      }}</span>
      <span v-else class="filter-tab__name">{{
        $t(`entity.entity_type.${el}`)
      }}</span>
      <i class="icon icon-close fa-thin fa-xmark"></i>
    </div>
  </template>
</template>
