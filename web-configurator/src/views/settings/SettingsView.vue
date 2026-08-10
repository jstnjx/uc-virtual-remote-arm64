<!--
  Modified by Justin Jäger for the Unfolded.Tools Remote Simulator.
  Modified build first published: 2026-08-03.
  Licensed as part of the modified Web Configurator under GNU GPL v3.0 only.
  See MODIFICATIONS.md for details.
-->
<script setup lang="ts">
import { ref, onMounted, watch, computed } from "vue";
import { useRoute, useRouter } from "vue-router";

import { appStateStore } from "@/stores/appState";

import { useMenuItems } from "@/composables/menuItems";
import type { SelectOption } from "@/types/ui";

const router = useRouter();
const route = useRoute();
const appState = appStateStore();
const { getSettingsItems } = useMenuItems();

const menuItems = ref<SelectOption<string>[]>([]);

const selectedMenuItem = ref("");
const activeOptionItem = ref({ label: "", value: "" });

watch(router.currentRoute, (to, _from) => {
  if (menuItems.value) {
    const menuItem = menuItems.value.find((item) => item.value === to.name);
    setMenuItem(menuItem);
  }
});

const hasActiveItem = computed(() => {
  return selectedMenuItem.value.length > 0;
});

// Remember the selected sub-section so it is restored when navigating back
// (same behavior as the integrations / entities / activities views).
watch(selectedMenuItem, (value) => {
  if (value.length > 0) {
    appState.writeMemory("settings", { selected: value });
  }
});

function setMenuItem(menuItem: SelectOption<string> | undefined) {
  if (menuItem) {
    selectedMenuItem.value = menuItem.value;
    activeOptionItem.value.label = menuItem.label;
    activeOptionItem.value.value = menuItem.value;
  } else {
    selectedMenuItem.value = "";
  }
}

function selectMenuItem(value: string, action = "") {
  const item = menuItems.value.find((entry: any) => entry.value === value);
  if (item?.disabled) return;
  if (action.length > 0) {
    router.push({
      name: value,
      query: {
        action: action,
      },
    });
  } else {
    router.push({ name: value });
  }
  selectedMenuItem.value = value;
}

onMounted(async () => {
  menuItems.value = await getSettingsItems();

  if (
    window.innerWidth > 992 &&
    router.currentRoute?.value?.name?.toString() == "settings"
  ) {
    const mData = appState.readMemory("settings");
    selectMenuItem(mData?.selected || "general");
  }

  if (
    route.query &&
    route.query.action &&
    route.query.action == "software-update"
  ) {
    selectMenuItem("general", route.query.action);
  }

  if (menuItems.value) {
    const menuItem = menuItems.value.find(
      (item) => item.value === router.currentRoute.value.name,
    );
    setMenuItem(menuItem);
  }
});
</script>
<template>
  <div class="page-settings">
    <div
      :class="{ 'page-settings__menu--selected-item': hasActiveItem }"
      class="page-settings__menu"
    >
      <div
        v-for="(menuItem, index) in menuItems"
        :key="index"
        :class="{
          'page-settings__menu__item--active': selectedMenuItem === menuItem.value,
          'ucvr-simulator-disabled-setting': (menuItem as any).disabled,
        }"
        :aria-disabled="(menuItem as any).disabled ? 'true' : undefined"
        class="page-settings__menu__item"
        @click="selectMenuItem(menuItem.value)"
      >
        <i :class="menuItem.icon"></i>
        {{ $t(menuItem.label) }}
      </div>
    </div>
    <div class="page-settings__menu-content">
      <RouterView v-slot="{ Component }">
        <Transition name="opacity">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </div>
  </div>
</template>
