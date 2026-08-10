<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useTranslation } from "i18next-vue";
import { storeToRefs } from "pinia";

import type { TabItem } from "@/types/ui";

import { getIconName } from "@/composables/icon";

import { remotesStore } from "@/stores/remotes";

import TabMenu from "@/components/ui/TabMenu.vue";
import EditRemoteSettings from "@/components/remote-controller/EditRemoteSettings.vue";
import EditRemoteInterfaces from "@/components/remote-controller/EditRemoteInterfaces.vue";

const { t } = useTranslation();
const remotesStorage = remotesStore();

const props = defineProps({
  remote_id: {
    type: String,
    required: true,
  },
});

const defaultTabItem = { icon: "fa-light fa-gear", value: "settings" };

const { remote } = storeToRefs(remotesStorage);
const iconGrid = ref("");

const activeTab = ref<TabItem>(defaultTabItem);
const slideRight = ref(false);

const tabTransition = computed(() => {
  return slideRight.value == true ? "slide-tab-right" : "slide-tab-left";
});

const nonEditable = computed(() => {
  if (remote.value && remote.value.entity_id === props.remote_id) {
    return remote.value.options?.editable === false;
  }

  return false;
});

const tabItems = computed(() => {
  return [
    {
      icon: "fa-light fa-gear",
      label: t("tab.settings"),
      value: "settings",
    },
    {
      icon: "fa-light fa-icons",
      label: t("tab.user_interface"),
      value: "user-interface",
      ...(nonEditable.value && { disabled: true }),
    },
    {
      icon: `fa-light ${iconGrid.value}`,
      label: t("tab.button_mapping"),
      value: "button-mapping",
      ...(nonEditable.value && { disabled: true }),
    },
  ];
});

function goTo(item: TabItem) {
  const activeTabIndex = tabItems.value.findIndex(
    (i) => i.value == activeTab.value.value,
  );
  const newTabIndex = tabItems.value.findIndex((i) => i.value == item.value);
  slideRight.value = newTabIndex < activeTabIndex ? true : false;
  activeTab.value = item;
}

onMounted(async () => {
  iconGrid.value = await getIconName("fa-border-all");
});
</script>
<template>
  <Suspense>
    <div class="page-edit-remote">
      <div class="page-edit-remote__navbar">
        <TabMenu
          v-if="tabItems"
          :list-data="tabItems"
          :active-tab="activeTab"
          @item-click="goTo"
        />
      </div>
      <div class="page-edit-remote__main">
        <div class="page-edit-remote__tabs">
          <Transition :name="tabTransition">
            <div
              v-show="activeTab.value == 'settings'"
              class="page-edit-remote__tab"
            >
              <EditRemoteSettings :remote-id="remote_id" />
            </div>
          </Transition>
          <Transition :name="tabTransition">
            <div
              v-show="
                activeTab.value == 'user-interface' ||
                activeTab.value == 'button-mapping'
              "
              class="page-edit-remote__tab"
            >
              <EditRemoteInterfaces
                :remote-id="remote_id"
                :active-tab="activeTab.value"
              />
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </Suspense>
</template>
