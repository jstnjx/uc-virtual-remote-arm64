<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";

import type { PaginationMeta } from "@/types/rest";
import { EntityType, RemoteKind } from "@/types/enums";
type FilterInstancesType = {
  [key: string]: { [key: string]: any; selected: boolean };
};

import type { TabItem } from "@/types/ui";
import type { IntegrationDriver } from "@/types/integrationInstance";
import type { TabType } from "@/types/app";

type EntitiesFilter = {
  activeTab?: TabType;
  searchText?: string;
  filterEntityTypes: object;
  filterInstances?: object;
  pagination?: object;
};

import { appStateStore } from "@/stores/appState";
import { configStore } from "@/stores/config";
import { remotesStore } from "@/stores/remotes";
import { addErrorBottom } from "@/stores/messages";

import { useWindowDimension } from "@/composables/windowDimension";
import { useTiming } from "@/composables/timing";
import {
  getPaginationLimit,
  hasPaginationLimit,
  savePaginationLimit,
} from "@/composables/listing";

import TabMenu from "@/components/ui/TabMenu.vue";
import UCSearch from "@/components/ui/UCSearch.vue";
import FilterTabs from "@/components/ui/FilterTabs.vue";
import FilterDropdown from "@/components/elements/FilterDropdown.vue";
import BaseEntityList from "@/components/elements/entity/BaseEntityList.vue";
import AddDevice from "@/components/elements/entity/AddDevice.vue";
import AddRemoteIr from "@/components/remote-controller/AddRemoteIr.vue";
import AddRemoteBt from "@/components/remote-controller/AddRemoteBt.vue";
import AddDock from "@/components/dock/AddDock.vue";
import AddIntegration from "@/components/integration/AddIntegration.vue";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const { isSmallScreen } = useWindowDimension();
const { sleep } = useTiming();

const appState = appStateStore();
const config = configStore();
const remotesStorage = remotesStore();

const defaultTabItem = { value: "all" };

const activeTab = ref<TabItem>(defaultTabItem);

const searchText = ref("");
const modeAdvanced = ref(false);

const elEntityList =
  useTemplateRef<InstanceType<typeof BaseEntityList>>("elEntityList");
const hasAssignedEntities = ref(false);
const elAddDevice =
  useTemplateRef<InstanceType<typeof AddDevice>>("elAddDevice");
const elAddRemoteIr =
  useTemplateRef<InstanceType<typeof AddRemoteIr>>("elAddRemoteIr");
const elAddRemoteBt =
  useTemplateRef<InstanceType<typeof AddRemoteBt>>("elAddRemoteBt");
const elAddDock = useTemplateRef<InstanceType<typeof AddDock>>("elAddDock");
const elAddIntegration =
  useTemplateRef<InstanceType<typeof AddIntegration>>("elAddIntegration");

const listPagination = ref();
const init = ref(true);
const btListLoaded = ref(false);

const filterInstances = ref<FilterInstancesType>({});
const filterEntityTypes = ref(
  getCustomizedEntityTypes(Object.keys(EntityType)).reduce(
    (obj: { [key: string]: any }, key: string) => {
      obj[key as keyof typeof EntityType] = { selected: false };
      return obj;
    },
    {},
  ),
);

// computed, not a plain array: t() only re-runs on a language change when it is
// read inside a tracked scope.
const tabItems = computed(() => [
  {
    label: t("ui.all"),
    value: "all",
  },
  {
    label: "Bluetooth",
    value: RemoteKind.BT,
  },
  {
    label: t("remote.infrared"),
    value: RemoteKind.IR,
  },
  {
    label: t("remote.external_remotes"),
    value: RemoteKind.EXTERNAL,
  },
]);

const paramEntityTypes = computed(() => {
  if (
    activeTab.value.value == RemoteKind.BT ||
    activeTab.value.value == RemoteKind.IR
  ) {
    return "remote";
  }

  const filter = Object.entries(filterEntityTypes.value)
    .filter(([_key, value]) => value.selected === true)
    .map(([key, _value]) => key)
    .join(",");

  if (filter.length < 1) {
    return getCustomizedEntityTypes(Object.keys(EntityType)).join(",");
  }

  return filter;
});

const paramInstances = computed(() => {
  return Object.entries(filterInstances.value)
    .filter(([_key, value]) => value.selected === true)
    .map(([key, _value]) => key)
    .join(",");
});

const isTabBt = computed(() => activeTab.value.value == RemoteKind.BT);

/** The device's Bluetooth pairing slot maximum; null while it is unknown. */
const btSlotsTotal = computed(() => {
  const max = config.config?.bt?.peripheral_connections;
  return typeof max === "number" ? max : null;
});

/**
 * Free Bluetooth slots, null while either input is unknown.
 *
 * Occupancy comes from the kind-scoped `remotesBt` list, not from the paged
 * list this view renders: that one is fetched with the search text, which the
 * view keeps when the tab changes, so its count is right for the list footer
 * and wrong for "slots occupied". Clamped at 0 because lowering the maximum in
 * settings can leave more remotes than slots.
 */
const btSlotsAvailable = computed(() => {
  if (btSlotsTotal.value === null || !btListLoaded.value) {
    return null;
  }
  return Math.max(0, btSlotsTotal.value - remotesStorage.remotesBt.length);
});

const showBtSlots = computed(
  () => isTabBt.value && btSlotsAvailable.value !== null,
);

const btSlotsFull = computed(
  () => isTabBt.value && btSlotsAvailable.value === 0,
);

// Unfiltered by search and by pagination, unlike the list's own fetch; kept
// current afterwards by the store's WS new/delete handlers (ADR 0013).
watch(
  isTabBt,
  async (isBt) => {
    if (!isBt) {
      return;
    }

    try {
      await remotesStorage.getAll(RemoteKind.BT);
      btListLoaded.value = true;
    } catch (e) {
      addErrorBottom(e);
    }
  },
  { immediate: true },
);

watch(activeTab, () => {
  if (init.value) {
    return;
  }

  if (elEntityList.value) {
    elEntityList.value.clearAssignedEntities();
  }
});

function disableEntityType(
  keyEntityType: string,
  collection: { [key: string]: any },
) {
  if (collection) {
    collection[keyEntityType].selected = false;
  }
}

function getCustomizedEntityTypes(types: string[]) {
  const typesToRemove = ["activity", "macro"];
  return types.filter((str) => !typesToRemove.includes(str));
}

function goTo(item: TabItem) {
  activeTab.value = item;

  router.push({
    path: route.path,
    query: {
      ...route.query,
      category: item.value?.toLowerCase() || "all",
    },
  });
}

function startAdd(type: string) {
  if (type == RemoteKind.IR) {
    elAddRemoteIr.value?.open();
  }

  if (type == RemoteKind.BT) {
    elAddRemoteBt.value?.open();
  }

  if (type == "dock") {
    elAddDock.value?.open();
  }
}

function startDirectAdd() {
  if (btSlotsFull.value) {
    return;
  }

  if (activeTab.value.value == RemoteKind.BT) {
    elAddRemoteBt.value?.open();
  } else if (activeTab.value.value == RemoteKind.IR) {
    elAddRemoteIr.value?.open();
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

function saveToStorage(pagination: PaginationMeta) {
  listPagination.value = pagination;
  savePaginationLimit(pagination.limit);

  const message = {
    activeTab: activeTab.value,
    searchText: searchText.value,
    filterEntityTypes: filterEntityTypes.value,
    filterInstances: filterInstances.value,
    pagination: listPagination.value,
  } satisfies EntitiesFilter;

  appState.writeMemory("entities", message);
}

onMounted(async () => {
  init.value = true;
  const current = router.options?.history?.state?.current;
  const currentPagePath = typeof current === "string" ? current : "";
  // Restore the view state whenever it was saved this session (same behavior
  // as the integrations view), not only when returning from a child page.
  const mData = appState.readMemory("entities");

  if (mData != null) {
    goTo(mData.activeTab || defaultTabItem);
    await sleep(10);
    searchText.value = mData.searchText || "";
    filterEntityTypes.value = mData.filterEntityTypes;
    filterInstances.value = mData.filterInstances as FilterInstancesType;
    listPagination.value = mData.pagination;

    if (hasPaginationLimit()) {
      const storagePagLimit = getPaginationLimit();

      if (storagePagLimit != listPagination.value.limit) {
        listPagination.value.limit = storagePagLimit;
        listPagination.value.page = 1;
      }
    }
  } else if (currentPagePath.includes("category=all")) {
    goTo(tabItems.value[0]);
  } else if (currentPagePath.includes("category=bt")) {
    goTo(tabItems.value[1]);
  } else if (currentPagePath.includes("category=ir")) {
    goTo(tabItems.value[2]);
  } else if (currentPagePath.includes("category=external")) {
    goTo(tabItems.value[3]);
  }

  init.value = false;
});
</script>
<template>
  <div class="page-devices">
    <div class="page-devices__tools">
      <TabMenu
        :list-data="tabItems"
        :active-tab="activeTab"
        :compact="true"
        @item-click="goTo"
      />
      <div class="page-devices__tools__filter">
        <div class="page-devices__tools__filter__search">
          <UCSearch
            v-if="activeTab.value === 'all'"
            v-model="searchText"
            :debouncing="true"
            :small="true"
            :has-sibling="activeTab.value === 'all'"
          />
          <FilterDropdown
            v-if="activeTab.value === 'all'"
            v-model:filter-entity-types="filterEntityTypes"
            v-model:filter-instances="filterInstances"
          />
        </div>
        <div
          v-if="
            activeTab.value == 'all' &&
            (paramEntityTypes.length > 0 || paramInstances.length > 0)
          "
          class="page-devices__tools__filter__tabs"
        >
          <FilterTabs
            :list="filterEntityTypes"
            @remove-element="(el) => disableEntityType(el, filterEntityTypes)"
          />
          <FilterTabs
            :list="filterInstances"
            @remove-element="(el) => disableEntityType(el, filterInstances)"
          />
        </div>
      </div>
      <div class="page-devices__tools__filter__options">
        <Transition name="opacity-fast">
          <button
            v-show="hasAssignedEntities"
            class="button button--secondary button--icon"
            @click="elEntityList?.startDelete()"
          >
            <i class="fa-light fa-trash"></i>
          </button>
        </Transition>
        <button
          class="button button--primary"
          :class="{
            'button--hybrid': !isSmallScreen,
            'button--secondary button--icon': isSmallScreen,
          }"
          :disabled="btSlotsFull"
          :aria-describedby="showBtSlots ? 'entities-bt-slots' : undefined"
          @click="startDirectAdd"
        >
          <i class="fa-light fa-plus"></i>
          <span v-if="!isSmallScreen">
            <template v-if="activeTab.value == RemoteKind.BT">{{
              $t("remote.add_device_bt.title_short")
            }}</template>
            <template v-else-if="activeTab.value == RemoteKind.IR">{{
              $t("remote.add_device_ir.title_short")
            }}</template>
            <template v-else>{{ $t("entities.add_new") }}</template>
          </span>
        </button>
      </div>
    </div>
    <p v-if="showBtSlots" id="entities-bt-slots" class="page-devices__slots">
      {{
        $t("remote.add_device_bt.slots_available", {
          count: btSlotsTotal,
          available: btSlotsAvailable,
        })
      }}
    </p>
    <div class="page-devices__body">
      <BaseEntityList
        v-if="!init"
        ref="elEntityList"
        :search-text="searchText"
        :filter-entity-types="paramEntityTypes"
        :filter-instances="paramInstances"
        :filter-remote-type="activeTab.value != 'all' ? activeTab.value : ''"
        :pagination="listPagination"
        @loaded="saveToStorage"
        @assigned-entities="(any: boolean) => (hasAssignedEntities = any)"
      />
    </div>
  </div>
  <AddDevice
    ref="elAddDevice"
    @start-add="startAdd"
    @start-driver-setup="startDriverSetup"
    @start-driver-register="startDriverRegister"
    @change-mode-advanced="
      (mode: boolean) => {
        modeAdvanced = mode;
      }
    "
  />
  <AddRemoteIr ref="elAddRemoteIr" />
  <AddRemoteBt ref="elAddRemoteBt" />
  <AddDock ref="elAddDock" />
  <AddIntegration ref="elAddIntegration" :mode-advanced="modeAdvanced" />
</template>
