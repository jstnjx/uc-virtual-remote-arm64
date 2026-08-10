<script setup lang="ts">
import { useTiming } from "@/composables/timing";

const { timeoutHelper } = useTiming();

const props = defineProps({
  formClass: {
    type: [String, Array],
    default: "",
  },
  itemsClass: {
    type: [String, Array],
    default: "",
  },
  skipItemsWrapper: {
    type: Boolean,
    default: false,
  },
  skipForm: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["moreItems"]);

function getFormClass() {
  let classNames: string[] = ["list-with-filter__form"];
  if (Array.isArray(props.formClass)) {
    classNames = [...classNames, ...(props.formClass as string[])];
  } else if (props.formClass) {
    classNames.push(props.formClass);
  }
  return classNames;
}

function getItemsClass() {
  let classNames: string[] = [];
  if (Array.isArray(props.itemsClass)) {
    classNames = [...classNames, ...(props.itemsClass as string[])];
  } else if (props.itemsClass) {
    classNames.push(props.itemsClass);
  }
  return classNames;
}

function handleScrollItemContainer(ev: Event) {
  if (!ev.target) {
    return false;
  }
  const target = ev.target as HTMLElement;
  const scrollableHeight = target.scrollHeight - target.clientHeight;

  if (target.scrollTop + 10 >= scrollableHeight) {
    timeoutHelper(() => {
      emit("moreItems");
    }, 200);
  }
}
</script>
<template>
  <div
    class="list-with-filter"
    :class="{ 'list-with-filter--pagination': $slots.pagination }"
  >
    <div v-if="skipForm === false" :class="getFormClass()">
      <slot name="form" />
    </div>
    <slot name="widget" />
    <template v-if="!skipItemsWrapper">
      <div
        :class="getItemsClass()"
        class="list-with-filter__items"
        @scroll="handleScrollItemContainer"
      >
        <slot name="items" />
      </div>
    </template>
    <template v-if="skipItemsWrapper">
      <slot name="items" />
    </template>
    <slot name="footer" />
    <slot name="pagination" />
  </div>
</template>
