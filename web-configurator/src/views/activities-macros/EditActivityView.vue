<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useTranslation } from "i18next-vue";

import type { TabItem } from "@/types/ui";

import { getIconName } from "@/composables/icon";

import TabMenu from "@/components/ui/TabMenu.vue";
import EditActivitySettings from "@/components/activity/EditActivitySettings.vue";
import EditActivitySequences from "@/components/activity/EditActivitySequences.vue";
import EditActivityInterfaces from "@/components/activity/EditActivityInterfaces.vue";

const { t } = useTranslation();

defineProps({
  activity_id: {
    type: String,
    required: true,
  },
});

const defaultTabItem = { icon: "fa-light fa-gear", value: "settings" };

// Resolved on mount, then read reactively below: inside an asyncComputed every
// t() call sits behind the await and is never tracked, so the labels would keep
// the language they were first built in.
const iconList = ref("");
const iconGrid = ref("");

onMounted(async () => {
  iconList.value = await getIconName("fa-list");
  iconGrid.value = await getIconName("fa-border-all");
});

const tabItems = computed(() => {
  return [
    {
      icon: "fa-light fa-gear",
      label: t("tab.settings"),
      value: "settings",
    },
    {
      icon: `fa-light ${iconList.value}`,
      label: t("tab.sequences"),
      value: "sequences",
    },
    {
      icon: "fa-light fa-icons",
      label: t("tab.user_interface"),
      value: "user-interface",
    },
    {
      icon: `fa-light ${iconGrid.value}`,
      label: t("tab.button_mapping"),
      value: "button-mapping",
    },
  ];
});

const activeTab = ref<TabItem>(defaultTabItem);
const slideRight = ref(false);

const tabTransition = computed(() => {
  return slideRight.value == true ? "slide-tab-right" : "slide-tab-left";
});

function goTo(item: TabItem) {
  if (!tabItems.value) {
    return;
  }
  const activeTabIndex = tabItems.value.findIndex(
    (i) => i.value == activeTab.value.value,
  );
  const newTabIndex = tabItems.value.findIndex((i) => i.value == item.value);
  slideRight.value = newTabIndex < activeTabIndex ? true : false;
  activeTab.value = item;
}
</script>
<template>
  <Suspense>
    <div class="page-edit-activity">
      <div class="page-edit-activity__navbar">
        <TabMenu
          v-if="tabItems"
          :list-data="tabItems"
          :active-tab="activeTab"
          @item-click="goTo"
        />
      </div>
      <div class="page-edit-activity__main">
        <div class="page-edit-activity__tabs">
          <Transition :name="tabTransition">
            <div
              v-show="activeTab.value == 'settings'"
              class="page-edit-activity__tab"
            >
              <EditActivitySettings
                :activity-id="activity_id"
                :active="activeTab.value == 'settings'"
              />
            </div>
          </Transition>
          <Transition :name="tabTransition">
            <div
              v-show="activeTab.value == 'sequences'"
              class="page-edit-activity__tab"
            >
              <EditActivitySequences
                :activity-id="activity_id"
                :active="activeTab.value == 'sequences'"
              />
            </div>
          </Transition>
          <Transition :name="tabTransition">
            <div
              v-show="
                activeTab.value == 'user-interface' ||
                activeTab.value == 'button-mapping'
              "
              class="page-edit-activity__tab"
            >
              <EditActivityInterfaces
                :activity-id="activity_id"
                :active-tab="activeTab.value"
              />
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </Suspense>
</template>
