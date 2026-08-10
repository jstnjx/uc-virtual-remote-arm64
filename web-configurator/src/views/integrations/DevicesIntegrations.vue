<!--
  Modified by Justin Jäger for the Unfolded.Tools Remote Simulator.
  Modified build first published: 2026-08-03.
  Licensed as part of the modified Web Configurator under GNU GPL v3.0 only.
  See MODIFICATIONS.md for details.
-->
<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";

import sStorageWrapper from "@/api/local";
import type { IntegrationDriver } from "@/types/integrationInstance";
import type { TabItem } from "@/types/ui";

import { focusInput } from "@/composables/device";
import { useWindowDimension } from "@/composables/windowDimension";

import AddDock from "@/components/dock/AddDock.vue";
import DockList from "@/components/dock/DockList.vue";
import AddDevice from "@/components/elements/entity/AddDevice.vue";
import AddIntegration from "@/components/integration/AddIntegration.vue";
import IntegrationList from "@/components/integration/IntegrationList.vue";
import TabMenu from "@/components/ui/TabMenu.vue";
import UCSearch from "@/components/ui/UCSearch.vue";

type IntegrationsFilter = {
  activeTab?: TabItem;
  searchText?: string;
};

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const { isSmallScreen } = useWindowDimension();

const FILTER_STORE_KEY = "integrations";
const integrationTab = computed<TabItem>(() => ({
  label: t("integration.integrations"),
  value: "integration",
}));
const dockTab = computed<TabItem>(() => ({
  label: t("device.add_device.menu_list.dock.title"),
  value: "dock",
}));
const tabItems = computed(() => [integrationTab.value, dockTab.value]);

const activeTab = ref<TabItem>({ value: "integration" });
const searchText = ref("");
const modeAdvanced = ref(false);
const storedFilters = ref<Record<string, any>>({});
const init = ref(true);

const elPageDevicesTools = useTemplateRef<HTMLDivElement>(
  "elPageDevicesTools",
);
const elAddDevice =
  useTemplateRef<InstanceType<typeof AddDevice>>("elAddDevice");
const elAddDock = useTemplateRef<InstanceType<typeof AddDock>>("elAddDock");
const elAddIntegration =
  useTemplateRef<InstanceType<typeof AddIntegration>>("elAddIntegration");
const elIntegrationList =
  useTemplateRef<InstanceType<typeof IntegrationList>>("elIntegrationList");

const isDockTab = computed(() => activeTab.value.value === "dock");

watch(activeTab, () => {
  if (init.value) {
    return;
  }

  if (elPageDevicesTools.value) {
    focusInput(elPageDevicesTools.value);
  }
  saveToStorage();
});
watch(searchText, saveToStorage);

function goTo(item: TabItem) {
  activeTab.value = item;
  void router.replace({
    path: route.path,
    query: {
      ...route.query,
      category: String(item.value || "integration").toLowerCase(),
    },
  });
}

function startDirectAdd() {
  if (isDockTab.value) {
    elAddDock.value?.open();
  } else {
    elAddDevice.value?.open();
  }
}

function startDriverSetup(driver: IntegrationDriver) {
  elAddIntegration.value?.startSetup(driver);
}

function startDriverRegister(driver: IntegrationDriver) {
  elAddIntegration.value?.doStartRegisterExternal(driver);
}

function saveToStorage() {
  if (init.value) {
    return;
  }

  storedFilters.value[FILTER_STORE_KEY] = {
    activeTab: activeTab.value,
    searchText: searchText.value,
  } satisfies IntegrationsFilter;
  sStorageWrapper.setValue("filters", storedFilters.value);
}

onMounted(() => {
  storedFilters.value =
    (sStorageWrapper.getValue("filters") as Record<string, any>) ?? {};
  const stored = storedFilters.value[FILTER_STORE_KEY] as
    | IntegrationsFilter
    | undefined;

  searchText.value = stored?.searchText || "";

  const requestedCategory = String(route.query.category || "").toLowerCase();
  const storedCategory = String(stored?.activeTab?.value || "").toLowerCase();
  const initialTab =
    requestedCategory === "dock" ||
    (!requestedCategory && storedCategory === "dock")
      ? dockTab.value
      : integrationTab.value;

  goTo(initialTab);
  init.value = false;
});
</script>

<template>
  <div class="page-devices">
    <div ref="elPageDevicesTools" class="page-devices__tools">
      <TabMenu
        :list-data="tabItems"
        :active-tab="activeTab"
        :compact="true"
        @item-click="goTo"
      />
      <div class="page-devices__tools__filter">
        <div class="page-devices__tools__filter__search">
          <UCSearch
            v-model="searchText"
            :debouncing="true"
            :small="true"
          />
        </div>
      </div>
      <div class="page-devices__tools__filter__options">
        <button
          class="button button--primary"
          :class="{
            'button--hybrid': !isSmallScreen,
            'button--secondary button--icon': isSmallScreen,
          }"
          @click="startDirectAdd"
        >
          <i class="fa-light fa-plus"></i>
          <span v-if="!isSmallScreen">
            {{
              isDockTab
                ? $t("dock.add.title")
                : $t("integration.add.title")
            }}
          </span>
        </button>
      </div>
    </div>

    <div class="page-devices__body">
      <div class="page-devices__body__inner">
        <DockList v-if="isDockTab" :search-text="searchText" />
        <IntegrationList
          v-else
          ref="elIntegrationList"
          :search-text="searchText"
          @start-not-configured="startDriverSetup"
        />
      </div>
    </div>
  </div>

  <AddDevice
    ref="elAddDevice"
    :only-integrations="true"
    @start-driver-setup="startDriverSetup"
    @start-driver-register="startDriverRegister"
    @change-mode-advanced="
      (mode: boolean) => {
        modeAdvanced = mode;
      }
    "
  />
  <AddDock ref="elAddDock" />
  <AddIntegration
    ref="elAddIntegration"
    :mode-advanced="modeAdvanced"
    @close="elIntegrationList?.loadData()"
  />
</template>
