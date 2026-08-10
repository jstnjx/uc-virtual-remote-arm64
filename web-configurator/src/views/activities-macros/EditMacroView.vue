<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useTranslation } from "i18next-vue";

import type { TabItem } from "@/types/ui";

import { getIconName } from "@/composables/icon";

import TabMenu from "@/components/ui/TabMenu.vue";
import EditMacroSettings from "@/components/macro/EditMacroSettings.vue";
import EditMacroSequence from "@/components/macro/EditMacroSequence.vue";

const { t } = useTranslation();

defineProps({
  macro_id: {
    type: String,
    required: true,
  },
});

const defaultTabItem = { icon: "fa-light fa-gear", value: "settings" };

// Resolved on mount, then read reactively below: inside an asyncComputed every
// t() call sits behind the await and is never tracked, so the labels would keep
// the language they were first built in.
const iconList = ref("");

onMounted(async () => {
  iconList.value = await getIconName("fa-list");
});

const tabItems = computed(() => {
  return [
    {
      icon: "fa-light fa-gear",
      label: t("macro.tab.settings"),
      value: "settings",
    },
    {
      icon: `fa-light ${iconList.value}`,
      label: t("macro.tab.sequence"),
      value: "sequence",
    },
  ];
});

const animationClass = ref("");
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
    <div class="page-edit-macro">
      <div class="page-edit-macro__navbar">
        <TabMenu
          v-if="tabItems"
          :list-data="tabItems"
          :active-tab="activeTab"
          @item-click="goTo"
        />
      </div>
      <div class="page-edit-macro__main" :class="animationClass">
        <div class="page-edit-macro__tabs">
          <Transition :name="tabTransition">
            <div
              v-show="activeTab.value == 'settings'"
              class="page-edit-macro__tab"
            >
              <EditMacroSettings :macro-id="macro_id" />
            </div>
          </Transition>
          <Transition :name="tabTransition">
            <div
              v-show="activeTab.value == 'sequence'"
              class="page-edit-macro__tab"
            >
              <EditMacroSequence
                :macro-id="macro_id"
                :active="activeTab.value == 'sequence'"
              />
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </Suspense>
</template>
