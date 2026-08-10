<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from "vue";
import { useTranslation } from "i18next-vue";
import { useRoute, useRouter } from "vue-router";

import type { DropdownItem, SelectOption } from "@/types/ui";
import type { MenuItems } from "@/types/menu";
import type { DockConfiguration } from "@/types/dock";

import type { Activity } from "@/types/activity";

import { appStateStore } from "@/stores/appState";
import { activitiesStore } from "@/stores/activities";
import { macrosStore } from "@/stores/macros";
import { activityGroupsStore } from "@/stores/activityGroups";
import { integrationsStore } from "@/stores/integrations";
import { docksStore } from "@/stores/docks";

import { useMenuItems } from "@/composables/menuItems";
import { useWindowDimension } from "@/composables/windowDimension";
import translatedProperty from "@/composables/translatedProperty";
import { useDataHelper } from "@/composables/dataHelper";

import UCSelect from "@/components/ui/UCSelect.vue";
import DropdownMenu from "@/components/ui/DropdownMenu.vue";
import MenuMainDesktop from "@/components/elements/MenuMainDesktop.vue";
import MenuMainMobile from "@/components/elements/MenuMainMobile.vue";
import NotificationBase from "@/components/elements/NotificationBase.vue";
import RemoteStatus from "@/components/elements/RemoteStatus.vue";
import MenuProfile from "@/components/profile/MenuProfile.vue";
import LogoutDialog from "@/components/elements/LogoutDialog.vue";

const props = defineProps({
  routeName: {
    type: String,
    default: "",
  },
});

const { t } = useTranslation();
const { isMediumScreen, isSmallScreen } = useWindowDimension();
const { getMenuItems, getSettingsItems } = useMenuItems();
const { isNonEmptyObject } = useDataHelper();
const appState = appStateStore();
const route = useRoute();
const router = useRouter();
const activitiesStorage = activitiesStore();
const macrosStorage = macrosStore();
const activityGroupsStorage = activityGroupsStore();
const integrationsStorage = integrationsStore();
const docksStorage = docksStore();

const emit = defineEmits(["back"]);

const menuItems = (getMenuItems() as MenuItems) || [];
const settingsMenuItems = ref<SelectOption<string>[]>([]);
const notificationWrapper = useTemplateRef<HTMLDivElement>(
  "notificationWrapper",
);
const mobileMenuOpen = ref(false);
const notificationWidth = ref(0);

const selectedSettingsMenuItem = ref("");
const activeOptionSettingsItem = ref({ label: "", value: "" });

const navRouteName = ref("");
const routeNameLoading = ref(true);
const elLogout = useTemplateRef<InstanceType<typeof LogoutDialog>>("elLogout");

const baseSubpages = ref([
  "/settings",
  "/activities-macros",
  "/entities",
  "/integrations",
  "/remote-simulator",
]);

watch(props, async () => {
  if (props.routeName.length > 0) {
    try {
      await setRouteName();
    } catch (e) {
      console.error(e);
    }
  }
});

watch(router.currentRoute, async (to) => {
  if (inSettings.value) {
    if (settingsMenuItems.value.length < 1) {
      await initSetingsMenu();
    }

    if (settingsMenuItems.value && settingsMenuItems.value.length > 0) {
      const settingsMenuItem = settingsMenuItems.value.find(
        (item) => item.value === to.name,
      );
      setMenuItem(settingsMenuItem);
    }
  }
});

const menuDropdownItems = computed((): DropdownItem[] => {
  const items: DropdownItem[] = [];
  const itemKeys = Object.keys(menuItems);
  for (let index = 0; index < itemKeys.length; index++) {
    const itemKey = itemKeys[index];
    const itemTo = menuItems[itemKey].to;
    const itemTitle = menuItems[itemKey].title;
    items.push({
      value: itemTo.name,
      label: itemTitle,
    });
  }
  items.push({
    value: "logout",
    label: "ui.logout",
  });
  return items;
});

const inSettings = computed(() => {
  return router.currentRoute.value.fullPath.includes("/settings");
});

const onSubPage = computed(() => {
  if (
    baseSubpages.value.some((path: string) =>
      router.currentRoute.value.fullPath.includes(path),
    )
  ) {
    return false;
  }

  return !router.currentRoute?.value?.name?.toString().includes("home");
});

const onBaseSubPage = computed(() => {
  return baseSubpages.value.some((path: string) =>
    router.currentRoute.value.fullPath.includes(path),
  );
});

const baseTitle = computed(() => {
  return t(`page.${props.routeName.replace(/-/g, "_")}`, "");
});

const showPageName = computed(() => {
  return (
    !routeNameLoading.value &&
    ((isMediumScreen.value && onBaseSubPage.value) || onSubPage.value) &&
    !mobileMenuOpen.value
  );
});

const hasActiveSettingsItem = computed(() => {
  return selectedSettingsMenuItem.value.length > 0;
});

function setNotificationWidth() {
  notificationWidth.value = notificationWrapper.value?.offsetWidth ?? 0;
}

async function setRouteName() {
  if (onBaseSubPage.value && router.currentRoute.value.name) {
    navRouteName.value = baseTitle.value;
  } else if (
    props.routeName == "activity" &&
    router.currentRoute?.value.params.activity_id
  ) {
    const activityId = router.currentRoute?.value.params.activity_id as string;
    const activeActivity = await activitiesStorage.getActivity(activityId);
    if (activeActivity && isNonEmptyObject(activeActivity)) {
      navRouteName.value = translatedProperty(
        (activeActivity as Activity).name,
      );
    }
  } else if (
    props.routeName == "macro" &&
    router.currentRoute?.value.params.macro_id
  ) {
    const macroId = router.currentRoute?.value.params.macro_id as string;
    const activeMacro = await macrosStorage.getMacro(macroId);
    navRouteName.value = translatedProperty(activeMacro.name);
  } else if (
    props.routeName == "activity-group" &&
    router.currentRoute?.value.params.group_id
  ) {
    const activityGroupId = router.currentRoute?.value.params
      .group_id as string;
    const activeAg =
      await activityGroupsStorage.getActivityGroup(activityGroupId);
    navRouteName.value = translatedProperty(activeAg.name);
  } else if (
    (props.routeName == "entity" &&
      router.currentRoute?.value.params.entity_id) ||
    (props.routeName == "remote" && router.currentRoute?.value.params.remote_id)
  ) {
    const entityId =
      (router.currentRoute?.value.params.entity_id as string) ||
      (router.currentRoute?.value.params.remote_id as string);
    const activeEnt = await integrationsStorage.getConfiguredEntity(entityId);
    navRouteName.value = translatedProperty(activeEnt.name);
  } else if (
    props.routeName == "dock" &&
    router.currentRoute?.value.params.dock_id
  ) {
    const dockId = router.currentRoute?.value.params.dock_id as string;
    const docks = await docksStorage.getDockList();
    const activeDock = docks.find(
      (d: DockConfiguration) => d.dock_id == dockId,
    );
    navRouteName.value =
      activeDock && activeDock.name ? activeDock.name : baseTitle.value;
  } else if (
    props.routeName == "integration" &&
    router.currentRoute?.value.params.integration_id
  ) {
    const integrationId = router.currentRoute?.value.params
      .integration_id as string;
    const activeInt = await integrationsStorage.getIntegration(
      integrationId,
      true,
    );
    navRouteName.value =
      activeInt.inst && activeInt.inst.name
        ? translatedProperty(activeInt.inst.name)
        : baseTitle.value;
  } else {
    navRouteName.value = baseTitle.value;
  }

  routeNameLoading.value = false;
}

function setMenuItem(menuItem: SelectOption<string> | undefined) {
  if (menuItem) {
    selectedSettingsMenuItem.value = menuItem.value;
    activeOptionSettingsItem.value.label = menuItem.label;
    activeOptionSettingsItem.value.value = menuItem.value;
  } else {
    selectedSettingsMenuItem.value = "";
  }
}

function onSelectSettingsUpdate(selectedItem: SelectOption<string>) {
  router.push({ name: selectedItem.value });
  activeOptionSettingsItem.value.label = selectedItem.label;
  activeOptionSettingsItem.value.value = selectedItem.value;
}

function selectSettingsMenuItem(value: string, action = "") {
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
  selectedSettingsMenuItem.value = value;
}

function goTo(item: DropdownItem) {
  if (item.value === "logout") {
    if (elLogout.value) {
      elLogout.value.startLogout();
    }
  } else {
    router.push({ name: item.value });
  }
}

function goBack() {
  emit("back");
}

function settingsBack() {
  router.push({ name: "settings" });
  selectedSettingsMenuItem.value = "";
}

function setSettingsPagesData() {
  if (
    window.innerWidth > 992 &&
    router.currentRoute?.value?.name?.toString() == "settings"
  ) {
    selectSettingsMenuItem("general");
  }

  if (
    route.query &&
    route.query.action &&
    route.query.action == "software-update"
  ) {
    selectSettingsMenuItem("general", route.query.action);
  }

  if (settingsMenuItems.value) {
    const settingsMenuItem = settingsMenuItems.value.find(
      (item) => item.value === router.currentRoute.value.name,
    );
    setMenuItem(settingsMenuItem);
  }
}

async function initSetingsMenu() {
  const items = (await getSettingsItems()) || [];
  settingsMenuItems.value = items || [];
  setSettingsPagesData();
}

onMounted(async () => {
  if (props.routeName.length > 0) {
    try {
      await setRouteName();
    } catch (e) {
      console.error(e);
    }
  }

  if (inSettings.value) {
    await initSetingsMenu();
  }
  if (notificationWrapper.value) {
    new ResizeObserver(setNotificationWidth).observe(notificationWrapper.value);
  }
});
</script>
<template>
  <header
    class="navbar"
    :class="{
      'navbar--subpage': onBaseSubPage || onSubPage,
      'navbar--in-background': appState.activeDropdown,
    }"
  >
    <div class="navbar__col--left">
      <router-link :to="{ name: 'home' }">
        <img
          alt="Unfolded Circle logo"
          class="logo"
          src="/logo.svg"
          width="45"
          height="30"
        />
      </router-link>
    </div>
    <div class="navbar__col--center">
      <div ref="notificationWrapper" class="navbar__notification-wrapper">
        <NotificationBase />
      </div>
      <div
        v-if="isSmallScreen && hasActiveSettingsItem"
        class="navbar__settings-menu"
      >
        <button
          class="button button--secondary button--icon"
          @click="settingsBack"
        >
          <i class="fa-regular fa-arrow-left"></i>
        </button>
        <UCSelect
          v-if="settingsMenuItems"
          v-model="activeOptionSettingsItem"
          :options="settingsMenuItems"
          :position="'center'"
          :lang-keys="true"
          @select="onSelectSettingsUpdate"
        />
      </div>
      <template v-else-if="showPageName">
        <div class="navbar__page-name">
          <button
            v-if="!onBaseSubPage"
            class="button button--secondary button--icon"
            @click="goBack"
          >
            <i class="fa-regular fa-arrow-left"></i>
          </button>
          <span v-if="routeName" class="navbar__page-name__text">
            <span v-if="routeNameLoading == false">{{ navRouteName }}</span>
          </span>
        </div>
      </template>
      <template v-else>
        <MenuMainDesktop :notification-width="notificationWidth" />
      </template>
    </div>
    <div class="navbar__col--right">
      <Transition name="opacity">
        <RemoteStatus
          v-show="!isSmallScreen || !mobileMenuOpen"
          :minimal="onBaseSubPage || onSubPage"
        />
      </Transition>
      <MenuMainMobile
        v-if="isSmallScreen"
        :on-sub-page="onSubPage"
        @toggle="(open: boolean) => (mobileMenuOpen = open)"
      />
      <template v-if="isSmallScreen && onSubPage == true && !inSettings">
        <DropdownMenu
          class="navbar__col--right__desktop-dropdown"
          :list-data="menuDropdownItems"
          :on-right="true"
          @item-click="goTo"
        />
      </template>
      <template v-else>
        <MenuProfile />
      </template>
    </div>
    <LogoutDialog ref="elLogout" />
  </header>
</template>
