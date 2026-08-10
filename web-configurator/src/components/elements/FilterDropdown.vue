<script setup lang="ts">
import {
  computed,
  getCurrentInstance,
  nextTick,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { asyncComputed } from "@vueuse/core";

import translatedProperty from "@/composables/translatedProperty";
import { getIconName } from "@/composables/icon";
import { useWindowDimension } from "@/composables/windowDimension";
import { isTouchEnabled } from "@/composables/device";
import { useModalToggle } from "@/composables/modal";

import UCSearch from "@/components/ui/UCSearch.vue";
import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";

const filterEntityTypes = defineModel("filterEntityTypes", {
  type: Object,
  required: true,
});
const filterInstances = defineModel("filterInstances", {
  type: Object,
  required: false,
});

const { isMobileScreen } = useWindowDimension();

const openDropdown = ref(false);

useModalToggle(openDropdown, { lockScroll: false });

const isCollapsed = ref(false);
const isCollapsedInstances = ref(true);
const searchText = ref("");

const fromLeft = ref(false);
const fromBottom = ref(false);

const dropdownTrigger = useTemplateRef<HTMLButtonElement>("dropdownTrigger");
const dropdownContainer = useTemplateRef<HTMLDivElement>("dropdownContainer");

const instance = getCurrentInstance() || {
  uid: Math.floor(Math.random() * (999999 - 100000 + 1)) + 100000,
};

const hasActiveFilter = computed(() => {
  let hasTrueValue = false;
  for (const key in filterEntityTypes.value) {
    if (filterEntityTypes.value[key].selected) {
      hasTrueValue = true;
      break;
    }
  }
  for (const key in filterInstances.value) {
    if (filterInstances.value[key].selected) {
      hasTrueValue = true;
      break;
    }
  }
  return hasTrueValue;
});

const openButtonClasses = computed(() => {
  return hasActiveFilter.value == true
    ? "button--secondary"
    : "button--tertiary";
});

const containerTransition = computed(() => {
  if (fromLeft.value && fromBottom.value) {
    return "grow-from-left-bottom";
  } else if (fromLeft.value) {
    return "grow-from-left";
  } else if (fromBottom.value) {
    return "grow-from-bottom";
  } else {
    return "grow";
  }
});

watch(openDropdown, (val) => {
  if (val) {
    setDropdownPosition();

    nextTick(() => {
      const container = dropdownContainer.value as HTMLElement;
      if (!isTouchEnabled() && container) {
        const firstInput = container.querySelector("input") as HTMLElement;
        firstInput?.focus();
      }
    });
  } else {
    resetDropdownPosition();
  }
});

const iconFilter = asyncComputed(async () => {
  return await getIconName("fa-bars");
});

function setDropdownPosition() {
  if (!dropdownTrigger.value || !dropdownContainer.value) {
    return;
  }
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  const containerWidth = isMobileScreen.value ? 300 : 420;
  const containerHeight = isMobileScreen.value ? 0.8 * screenHeight : 560;

  if (
    screenHeight >
    dropdownTrigger.value.getBoundingClientRect().y + containerHeight
  ) {
    fromBottom.value = false;
    dropdownContainer.value.style.top =
      dropdownTrigger.value.getBoundingClientRect().top + "px";

    if (
      screenHeight <
      dropdownTrigger.value.getBoundingClientRect().y + containerHeight
    ) {
      const offset =
        containerHeight - dropdownTrigger.value.getBoundingClientRect().y + 10;
      dropdownContainer.value.style.top =
        parseInt(dropdownContainer.value.style.top, 10) - offset + "px";
    }
  } else {
    fromBottom.value = true;
    dropdownContainer.value.style.bottom =
      screenHeight -
      dropdownTrigger.value.getBoundingClientRect().bottom +
      "px";

    if (
      0 >
      dropdownTrigger.value.getBoundingClientRect().bottom - containerHeight
    ) {
      fromBottom.value = false;
      const offset =
        containerHeight -
        dropdownTrigger.value.getBoundingClientRect().bottom +
        10;
      dropdownContainer.value.style.bottom =
        parseInt(dropdownContainer.value.style.bottom, 10) - offset + "px";
    }
  }

  if (
    0 <
    dropdownTrigger.value.getBoundingClientRect().right - containerWidth
  ) {
    fromLeft.value = false;
    dropdownContainer.value.style.right =
      screenWidth - dropdownTrigger.value.getBoundingClientRect().right + "px";
    if (
      0 >
      dropdownTrigger.value.getBoundingClientRect().right - containerWidth
    ) {
      const offset =
        containerWidth -
        dropdownTrigger.value.getBoundingClientRect().right +
        10;
      dropdownContainer.value.style.right =
        parseInt(dropdownContainer.value.style.right, 10) - offset + "px";
    }
  } else {
    fromLeft.value = true;
    dropdownContainer.value.style.left =
      dropdownTrigger.value.getBoundingClientRect().x + "px";

    if (
      screenWidth <
      dropdownTrigger.value.getBoundingClientRect().x + containerWidth
    ) {
      fromLeft.value = false;
      const offset =
        dropdownTrigger.value.getBoundingClientRect().x +
        containerWidth -
        screenWidth +
        10;
      dropdownContainer.value.style.left =
        parseInt(dropdownContainer.value.style.left, 10) - offset + "px";
    }
  }
}

function resetDropdownPosition() {
  if (!dropdownContainer.value) {
    return;
  }
  dropdownContainer.value.style.removeProperty("top");
  dropdownContainer.value.style.removeProperty("bottom");
  dropdownContainer.value.style.removeProperty("left");
  dropdownContainer.value.style.removeProperty("right");
}

function showListItem(val: string) {
  return (
    searchText.value.length < 1 ||
    (val && val.toLowerCase().includes(searchText.value))
  );
}

function toggleEntityType(key: string) {
  filterEntityTypes.value = {
    ...filterEntityTypes.value,
    [key]: {
      ...filterEntityTypes.value[key],
      selected: !filterEntityTypes.value[key].selected,
    },
  };
}

function toggleInstance(key: string) {
  const instances = filterInstances.value;
  if (!instances) {
    return;
  }

  filterInstances.value = {
    ...instances,
    [key]: { ...instances[key], selected: !instances[key].selected },
  };
}

function clearSelection(collection: { [key: string]: any }) {
  const cleared: { [key: string]: any } = {};
  Object.keys(collection).forEach((key) => {
    cleared[key] = { ...collection[key], selected: false };
  });
  return cleared;
}

function clearAll() {
  searchText.value = "";

  // Clear filter data
  filterEntityTypes.value = clearSelection(filterEntityTypes.value);

  if (filterInstances.value) {
    filterInstances.value = clearSelection(filterInstances.value);
  }
}
</script>
<template>
  <div
    class="filter-dropdown"
    :class="{ 'filter-dropdown--open': openDropdown }"
  >
    <button
      ref="dropdownTrigger"
      :class="openButtonClasses"
      class="button filter-dropdown__trigger"
      @click="openDropdown = true"
    >
      <i v-if="iconFilter" class="fa-light" :class="iconFilter"></i>
    </button>
    <Teleport to="body">
      <Transition name="opacity">
        <div
          v-show="openDropdown"
          class="filter-dropdown__background"
          @click="openDropdown = false"
        ></div>
      </Transition>
      <Transition :name="containerTransition">
        <div
          v-show="openDropdown"
          ref="dropdownContainer"
          class="filter-dropdown__container"
        >
          <div class="filter-dropdown__container__header">
            <span>{{ $t("ui.filters") }}</span>
            <button
              class="button button--secondary button--small"
              @click="openDropdown = false"
            >
              <i class="fa-regular fa-xmark"></i>
            </button>
          </div>

          <div class="filter-dropdown__container__body">
            <div class="filter-dropdown__search">
              <UCSearch v-model="searchText" :gray="true" />
            </div>
            <div class="filter-dropdown__container__list">
              <div
                v-if="
                  filterInstances && Object.keys(filterInstances).length > 0
                "
                class="collapse-container"
                :class="{ collapsed: isCollapsedInstances }"
              >
                <div class="collapse-container__header">
                  <span>{{ $t("filter_dropdown.integrations") }}</span>
                  <span @click="isCollapsedInstances = !isCollapsedInstances">
                    <i class="fa-regular fa-chevron-up"></i>
                  </span>
                </div>
                <div v-if="filterInstances" class="collapse-container__body">
                  <ul>
                    <template
                      v-for="el in Object.keys(filterInstances)"
                      :key="el"
                    >
                      <li
                        v-if="
                          showListItem(
                            translatedProperty(filterInstances[el].name),
                          )
                        "
                      >
                        <label :for="`${instance.uid}-${el}`">
                          <SelectedIcon
                            v-if="filterInstances[el].icon"
                            :icon="filterInstances[el].icon"
                            class="icon"
                          />
                          <SelectedIcon
                            v-else
                            :icon="`uc:${el}`"
                            class="icon"
                          />
                          <span class="label-text">{{
                            translatedProperty(filterInstances[el].name)
                          }}</span>
                        </label>
                        <div class="form-item form-item--checkbox-tick">
                          <input
                            :id="`${instance.uid}-${el}`"
                            type="checkbox"
                            :checked="filterInstances[el].selected"
                            @change="toggleInstance(el)"
                          />
                          <label
                            class="toggle"
                            :for="`${instance.uid}-${el}`"
                          />
                        </div>
                      </li>
                    </template>
                  </ul>
                </div>
              </div>
              <div
                class="collapse-container"
                :class="{ collapsed: isCollapsed }"
              >
                <div class="collapse-container__header">
                  <span>{{ $t("filter_dropdown.entity_types") }}</span>
                  <span @click="isCollapsed = !isCollapsed">
                    <i class="fa-regular fa-chevron-up"></i>
                  </span>
                </div>
                <div v-if="filterEntityTypes" class="collapse-container__body">
                  <ul>
                    <template
                      v-for="el in Object.keys(filterEntityTypes)"
                      :key="el"
                    >
                      <li v-if="showListItem($t(`entity.entity_type.${el}`))">
                        <label :for="`${instance.uid}-${el}`">
                          <SelectedIcon :icon="`uc:${el}`" class="icon" />
                          <span class="label-text">{{
                            $t(`entity.entity_type.${el}`)
                          }}</span>
                        </label>
                        <div class="form-item form-item--checkbox-tick">
                          <input
                            :id="`${instance.uid}-${el}`"
                            type="checkbox"
                            :checked="filterEntityTypes[el].selected"
                            @change="toggleEntityType(el)"
                          />
                          <label
                            class="toggle"
                            :for="`${instance.uid}-${el}`"
                          />
                        </div>
                      </li>
                    </template>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div class="filter-dropdown__container__footer">
            <button
              class="button button--tertiary button--clear-all"
              @click="clearAll"
            >
              {{ $t("ui.clear_all") }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
