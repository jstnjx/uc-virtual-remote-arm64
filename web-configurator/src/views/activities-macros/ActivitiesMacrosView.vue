<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";

import type { PaginationMeta } from "@/types/rest";
import type { DropdownItem, TabItem } from "@/types/ui";
import type { Activity } from "@/types/activity";
import type { Macro } from "@/types/macro";
import type { TabType } from "@/types/app";

type ActivitiesFilter = {
  activeTab?: TabType;
  searchText?: string;
  pagination?: object;
};

import { appStateStore } from "@/stores/appState";
import { activitiesStore } from "@/stores/activities";

import { useWindowDimension } from "@/composables/windowDimension";
import { useTiming } from "@/composables/timing";
import { getPreviousRoute } from "@/composables/router";
import { focusInput } from "@/composables/device";
import {
  getPaginationLimit,
  hasPaginationLimit,
  savePaginationLimit,
} from "@/composables/listing";

import TabMenu from "@/components/ui/TabMenu.vue";
import DropdownMenu from "@/components/ui/DropdownMenu.vue";
import UCSearch from "@/components/ui/UCSearch.vue";
import AddActivity from "@/components/activity/AddActivity.vue";
import AddMacro from "@/components/macro/AddMacro.vue";
import AddActivityGroup from "@/components/activity-group/AddActivityGroup.vue";
import ActivityList from "@/components/activity/ActivityList.vue";
import MacroList from "@/components/macro/MacroList.vue";
import ActivityGroupList from "@/components/activity-group/ActivityGroupList.vue";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const { isSmallScreen } = useWindowDimension();
const { sleep } = useTiming();

const appState = appStateStore();
const activitiesStorage = activitiesStore();

const activityToClone = ref<Activity | null>(null);
const macroToClone = ref<Macro | null>(null);

const searchText = ref("");

const modalAddActivity =
  useTemplateRef<InstanceType<typeof AddActivity>>("modalAddActivity");
const modalAddMacro =
  useTemplateRef<InstanceType<typeof AddMacro>>("modalAddMacro");
const modalAddActivityGroup = useTemplateRef<
  InstanceType<typeof AddActivityGroup>
>("modalAddActivityGroup");

const listPagination = ref();
const elPageActivitiesMacrosTools = useTemplateRef<HTMLDivElement>(
  "elPageActivitiesMacrosTools",
);
const init = ref(true);

const defaultTabItem = { value: "activity" };

const activeTab = ref<TabItem>(defaultTabItem);

// computed, not a plain array: t() only re-runs on a language change when it is
// read inside a tracked scope.
const tabItems = computed(() => [
  {
    label: t("activity.activities"),
    value: "activity",
  },
  {
    label: t("macro.macros"),
    value: "macro",
  },
  {
    label: t("activity_group.activity_groups"),
    value: "activity-group",
  },
]);

watch(activeTab, () => {
  if (init.value) {
    return;
  }

  if (listPagination.value) {
    listPagination.value.page = 1;
  }

  if (elPageActivitiesMacrosTools.value) {
    focusInput(elPageActivitiesMacrosTools.value);
  }
});

const showSearch = computed(() => {
  return (
    activeTab.value.value == "activity" || activeTab.value.value == "macro"
  );
});

const apiDefinitionItems = computed(() => {
  const links = [
    {
      icon: "fa-light fa-clapperboard",
      label: "activity.activity",
      value: "activity",
    },
    {
      icon: "fa-light fa-list-alt",
      label: "macro.macro",
      value: "macro",
    },
    {
      icon: "fa-light fa-layer-group",
      label: "activity_group.activity_group",
      value: "activity-group",
    },
  ];

  return links as DropdownItem[];
});

function goTo(item: TabItem) {
  activeTab.value = item;
  router.push({
    path: route.path,
    query: {
      ...route.query,
      category: item.value?.toLowerCase(),
    },
  });
}

function goToAdd(item: DropdownItem) {
  activityToClone.value = null;
  macroToClone.value = null;

  if (item.value == "activity") {
    modalAddActivity.value?.open();
  }

  if (item.value == "macro") {
    modalAddMacro.value?.open();
  }

  if (item.value == "activity-group") {
    modalAddActivityGroup.value?.open();
  }
}

async function cloneActivity(activity: Activity) {
  const cloneActi = await activitiesStorage.getActivity(activity.entity_id);
  if (cloneActi && Object.keys(cloneActi)) {
    activityToClone.value = cloneActi as Activity;
  }
  modalAddActivity.value?.open();
}

function cloneMacro(macro: Macro) {
  macroToClone.value = macro;
  modalAddMacro.value?.open();
}

function saveToStorage(pagination: PaginationMeta) {
  listPagination.value = pagination;
  savePaginationLimit(pagination.limit);

  const message = {
    activeTab: activeTab.value,
    searchText: searchText.value,
    pagination: listPagination.value,
  } satisfies ActivitiesFilter;

  appState.writeMemory("activities-macros", message);
}

onMounted(async () => {
  init.value = true;
  const current = router.options?.history?.state?.current;
  const currentPagePath = typeof current === "string" ? current : "";
  const prevPagePath = getPreviousRoute();
  // Restore the view state whenever it was saved this session (same behavior
  // as the integrations view), not only when returning from a child page.
  const mData = appState.readMemory("activities-macros");

  if (mData != null) {
    goTo(mData.activeTab || defaultTabItem);
    await sleep(10);
    searchText.value = mData.searchText || "";
    listPagination.value = mData.pagination;

    if (hasPaginationLimit()) {
      const storagePagLimit = getPaginationLimit();

      if (storagePagLimit != listPagination.value.limit) {
        listPagination.value.limit = storagePagLimit;
        listPagination.value.page = 1;
      }
    }
  } else if (
    currentPagePath.includes("category=activity") ||
    prevPagePath.includes("/activity") ||
    prevPagePath.includes("category=activity")
  ) {
    goTo(tabItems.value[0]);
  } else if (
    currentPagePath.includes("category=macro") ||
    prevPagePath.includes("/macro") ||
    prevPagePath.includes("category=macro")
  ) {
    goTo(tabItems.value[1]);
  } else if (
    currentPagePath.includes("category=activity-group") ||
    prevPagePath.includes("/activity-group") ||
    prevPagePath.includes("category=activity-group")
  ) {
    goTo(tabItems.value[2]);
  }

  init.value = false;
});
</script>
<template>
  <div class="page-activities-macros">
    <div class="page-activities-macros__body">
      <div
        ref="elPageActivitiesMacrosTools"
        class="page-activities-macros__tools"
      >
        <div
          class="page-activities-macros__tools__col page-activities-macros__tools__col--filters"
        >
          <TabMenu
            :list-data="tabItems"
            :active-tab="activeTab"
            :compact="true"
            @item-click="goTo"
          />
          <Transition name="opacity-fast">
            <UCSearch
              v-show="showSearch"
              v-model="searchText"
              :debouncing="true"
              :small="true"
            />
          </Transition>
        </div>
        <div
          class="page-activities-macros__tools__col page-activities-macros__tools__col--menu"
        >
          <DropdownMenu
            :list-data="apiDefinitionItems"
            :on-right="true"
            @item-click="goToAdd"
          >
            <template #trigger>
              <button
                class="button button--primary"
                :class="{
                  'button--hybrid': !isSmallScreen,
                  'button--secondary button--icon': isSmallScreen,
                }"
              >
                <i class="fa-light fa-plus"></i>
                <span v-if="!isSmallScreen">{{ $t("ui.add_new") }}</span>
              </button>
            </template>
          </DropdownMenu>
        </div>
      </div>
      <div v-if="!init" class="page-activities-macros__lists">
        <ActivityList
          v-if="activeTab.value == 'activity'"
          :filter-text="searchText"
          :pagination="listPagination"
          @add="goToAdd({ value: 'activity' })"
          @clone="cloneActivity"
          @loaded="saveToStorage"
        />
        <MacroList
          v-if="activeTab.value == 'macro'"
          :filter-text="searchText"
          :pagination="listPagination"
          @add="goToAdd({ value: 'macro' })"
          @clone="cloneMacro"
          @loaded="saveToStorage"
        />
        <ActivityGroupList
          v-if="activeTab.value == 'activity-group'"
          :filter-text="searchText"
          :pagination="listPagination"
          @add="goToAdd({ value: 'activity-group' })"
          @loaded="saveToStorage"
        />
      </div>
    </div>
    <AddActivity ref="modalAddActivity" :clone="activityToClone" />
    <AddMacro ref="modalAddMacro" :clone="macroToClone" />
    <AddActivityGroup ref="modalAddActivityGroup" />
  </div>
</template>
