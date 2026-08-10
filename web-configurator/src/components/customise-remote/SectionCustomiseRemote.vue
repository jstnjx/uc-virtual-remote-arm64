<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from "vue";
import { asyncComputed } from "@vueuse/core";
import { useTranslation } from "i18next-vue";

import type { TabItem } from "@/types/ui";

import { getIconName } from "@/composables/icon";
import { focusInput } from "@/composables/device";

import TabMenu from "@/components/ui/TabMenu.vue";
import CustomiseRemotePages from "@/components/customise-remote/CustomiseRemotePages.vue";
import ResourceList from "@/components/elements/resources/ResourceList.vue";
import IconList from "@/components/elements/resources/IconList.vue";

const { t } = useTranslation();

const props = defineProps({
  folded: {
    type: Boolean,
    default: false,
  },
});

const defaultTabItem = { icon: "fa-light fa-file", value: "pages" };

// Resolved on mount, then read reactively below: inside an asyncComputed every
// t() call sits behind the await and is never tracked, so the labels would keep
// the language they were first built in.
const iconPage = ref("");

onMounted(async () => {
  iconPage.value = await getIconName("fa-file");
});

const tabItems = computed(() => {
  return [
    {
      icon: `fa-light ${iconPage.value}`,
      label: t("customise_remote.tab.pages"),
      value: "pages",
    },
    {
      icon: "fa-light fa-heart",
      label: t("customise_remote.tab.icons"),
      value: "icons",
    },
    {
      icon: "fa-light fa-tv",
      label: t("customise_remote.tab.tv_channels"),
      value: "tv-channels",
    },
    {
      icon: "fa-light fa-image",
      label: t("customise_remote.tab.backgrounds"),
      value: "backgrounds",
    },
  ];
});

const animationClass = ref("");
const activeTab = ref<TabItem>(defaultTabItem);
const slideRight = ref(false);
const editView = ref(false);

const resourceList =
  useTemplateRef<InstanceType<typeof ResourceList>>("resourceList");
const elRemoteTabs = useTemplateRef<HTMLDivElement>("elRemoteTabs");

watch(props, (val) => {
  if (val.folded == true && activeTab.value.value != "pages") {
    activeTab.value = defaultTabItem;
  } else if (val.folded == true) {
    editView.value = false;
  }
});

watch(activeTab, (val) => {
  if (val.value == "backgrounds") {
    resourceList.value?.loadItems(true);
  }

  nextTick(() => {
    if (elRemoteTabs.value) {
      focusInput(elRemoteTabs.value, true);
    }
  });
});

const iconUnfold = asyncComputed(async () => {
  return await getIconName("fa-up-right-and-down-left-from-center");
});

const mainClasses = computed(() => {
  let classList = "";
  classList += props.folded == true ? "customise-remote__main--folded " : "";
  classList +=
    editView.value == true ? "customise-remote__main--edit-page " : "";
  return classList;
});

const tabTransition = computed(() => {
  return slideRight.value == true ? "slide-tab-right" : "slide-tab-left";
});

// router.afterEach(async (to, from, next) => {
//   if (to.name == 'customise-remote' && from.name == 'home' && props.folded == false) {
//     animationClass.value = ' growing'
//     await sleep(1000);
//     animationClass.value = '';
//   } else if (to.name == 'home' && from.name == 'customise-remote' && props.folded == true) {
//     animationClass.value = ' shrinking'
//     await sleep(1000);
//     animationClass.value = '';
//     activeTab.value = 'pages';
//   }
// })

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

function editPage(id: string) {
  editView.value = id && id != null ? true : false;
}
</script>
<template>
  <div
    class="section-customise-remote"
    :class="{ 'section-customise-remote--folded': folded }"
  >
    <Transition name="opacity-fast">
      <div
        v-show="folded == false && editView == false"
        class="customise-remote__navbar"
      >
        <TabMenu
          v-if="tabItems"
          :list-data="tabItems"
          :active-tab="activeTab"
          @item-click="goTo"
        />
      </div>
    </Transition>
    <div class="customise-remote__main" :class="mainClasses + animationClass">
      <Transition name="opacity-fast">
        <div v-show="folded" class="customise-remote__header">
          <h2>{{ $t("home.customise") }}</h2>
          <router-link
            to="/customise-remote"
            class="button button--tertiary button--icon button--icon--large"
          >
            <i v-if="iconUnfold" class="fa-light" :class="iconUnfold"></i>
          </router-link>
        </div>
      </Transition>
      <div ref="elRemoteTabs" class="customise-remote__tabs">
        <Transition :name="tabTransition">
          <div
            v-show="activeTab.value == 'pages'"
            class="customise-remote__tab"
          >
            <CustomiseRemotePages :folded="folded" @edit-page="editPage" />
          </div>
        </Transition>
        <Transition :name="tabTransition">
          <div
            v-show="activeTab.value == 'icons'"
            class="customise-remote__tab customise-remote__tab--icons"
          >
            <IconList :active="activeTab.value == 'icons'" />
          </div>
        </Transition>
        <Transition :name="tabTransition">
          <div
            v-show="activeTab.value == 'tv-channels'"
            class="customise-remote__tab customise-remote__tab--icons"
          >
            <IconList
              :icon-type="'TvChannelIcon'"
              :active="activeTab.value == 'tv-channels'"
            />
          </div>
        </Transition>
        <Transition :name="tabTransition">
          <div
            v-show="activeTab.value == 'backgrounds'"
            class="customise-remote__tab customise-remote__tab--backgrounds"
          >
            <ResourceList
              v-if="folded == false"
              ref="resourceList"
              :title="t('ui.background_images')"
              :allowed-types="['BackgroundImage']"
              :search-full-width="true"
              :active="activeTab.value == 'backgrounds'"
              default-type="BackgroundImage"
            />
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>
