<script setup lang="ts">
import { ref, watch, computed } from "vue";

import type { SelectOption, TabItem } from "@/types/ui";

import UCSelect from "@/components/ui/UCSelect.vue";
import { appStateStore } from "@/stores/appState";

const props = defineProps({
  listData: {
    type: Array<TabItem>,
    default: () => [],
  },
  activeTab: {
    type: Object,
    default: () => ({}),
  },
  compact: {
    type: Boolean,
    default: false,
  },
  responsive: {
    type: Boolean,
    default: true,
  },
});

const appState = appStateStore();

const emit = defineEmits(["itemClick"]);

// TabItem.label is optional, SelectOption.label is not.
function toOption(item: TabItem): SelectOption {
  return { ...item, label: item.label ?? "" };
}

const selectOptions = computed(() => props.listData.map(toOption));

// Always take the label from listData rather than from activeTab: consumers hold
// activeTab as a snapshot of the item that was clicked, so its label still carries
// whatever language it was created in. listData is rebuilt on `languageChanged`.
function activeOption(): SelectOption {
  const active = toOption(props.activeTab as TabItem);
  return selectOptions.value.find((o) => o.value === active.value) ?? active;
}

const selectValue = ref(activeOption());
const selectOpened = ref(false);

watch(props, () => {
  const active = activeOption();
  if (
    active.value != selectValue.value.value ||
    active.label != selectValue.value.label
  ) {
    selectValue.value = active;
  }
});

watch(selectOpened, (val) => {
  appState.activeDropdown = val;
});

function itemClick(item: TabItem) {
  emit("itemClick", item);
  if (item) {
    selectValue.value = toOption(item);
  }
}

// UCSelect writes the model itself; map the option back to the tab it came
// from so consumers keep receiving a TabItem.
function onSelectUpdate(option: SelectOption) {
  const item = props.listData.find((tab) => tab.value === option.value);
  if (item) {
    emit("itemClick", item);
  }
}
</script>
<template>
  <div
    class="tab-menu"
    :class="{
      'tab-menu--compact': compact,
      'tab-menu--no-responsive': !responsive,
    }"
  >
    <ul class="tab-menu__list">
      <li
        v-for="item in listData"
        :key="item.value"
        :class="{
          active: activeTab.value == item.value,
          disabled: item.disabled === true,
        }"
        class="tab-menu__list__item"
        @click="itemClick(item)"
      >
        <i
          v-if="item.icon"
          class="tab-menu__list__item__icon"
          :class="item.icon"
        ></i>
        <span v-if="item.label" class="tab-menu__list__item__label">{{
          item.label
        }}</span>
      </li>
    </ul>
    <UCSelect
      v-model="selectValue"
      :options="selectOptions"
      position="center"
      class="tab-menu__select"
      @select="onSelectUpdate"
      @opened="selectOpened = $event"
    />
  </div>
</template>
