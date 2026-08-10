<script setup lang="ts">
import {
  ref,
  watch,
  computed,
  onMounted,
  onUnmounted,
  useTemplateRef,
} from "vue";
import { RouterView, useRouter } from "vue-router";
import { storeToRefs } from "pinia";

import { LoginState } from "@/types/enums";

import { connectionMonitor } from "@/api/monitor";
import { authStorage } from "./stores/auth";
import { appStateStore } from "@/stores/appState";
import { configStore } from "@/stores/config";

import { errorOnChange } from "@/composables/error";
import { isTouchEnabled } from "@/composables/device";
import { getCookie } from "@/composables/cookieHandler";
import { useTiming } from "@/composables/timing";
import { useBodyScrollLock } from "@/composables/modal";

import NavBar from "@/components/elements/NavBar.vue";
import AppDialog from "@/components/elements/AppDialog.vue";

const auth = authStorage();
const config = configStore();
const appState = appStateStore();
const router = useRouter();
const { sleep } = useTiming();

// Sole owner of the body scroll lock, for the whole app (ADR 015).
useBodyScrollLock();

const dialogNewSystemVersion = useTemplateRef<InstanceType<typeof AppDialog>>(
  "dialogNewSystemVersion",
);

const systemVersion = ref("");

const { reAuthenticating } = storeToRefs(auth);
const { connected } = storeToRefs(appState);

watch(reAuthenticating, (val, oldVal) => {
  if (val == false && oldVal == true) {
    checkSystemVersion();
  }
});

watch(connected, (val, oldVal) => {
  if (
    val == true &&
    oldVal == false &&
    auth.authenticated != LoginState.AUTHORISED
  ) {
    checkSystemVersion();
  }
});

// Load the current configuration and localization lists over REST as soon as the
// user is authenticated — independent of the WebSocket session. The WebSocket
// carries configuration *changes* only; retrieving the current state must not
// wait on a session establishing (load-config-on-startup, ADR 0013). getAll() is
// single-flight, so this and the first session-established resync share one round.
watch(
  () => auth.isAuthenticated,
  (authenticated) => {
    if (authenticated) {
      void config.getAll();
    }
  },
);

const showMainNavbar = computed(() => {
  return router.currentRoute.value.name !== "login";
});

const currentRouteName = computed(() => {
  return router.currentRoute?.value?.name
    ? router.currentRoute.value.name.toString()
    : "";
});

function goBack() {
  if (
    router.currentRoute.value &&
    router.currentRoute.value.query &&
    router.currentRoute.value.query.parent
  ) {
    const parentName = router.currentRoute.value.query.parent.toString();
    router.push({ name: parentName });
  } else if (
    router.currentRoute.value &&
    router.currentRoute.value.meta &&
    typeof router.currentRoute.value.meta.parentPath === "string"
  ) {
    const parentPath = router.currentRoute.value.meta.parentPath;
    router.push(parentPath);
  }
}

function handleKeyUp(event: KeyboardEvent) {
  // On key escape remove last modal from modalPool
  if (event.key === "Escape") {
    appState.closeModal();
  }
}

function checkScreenType() {
  if (isTouchEnabled()) {
    if (document.body) {
      document.body.classList.add("touch-screen");
    }
  } else {
    if (document.body) {
      document.body.classList.remove("touch-screen");
    }
  }
}

async function checkSystemVersion() {
  try {
    await sleep(500);
    const versionFromCookie = getCookie("systemVersion");
    const devMeta = await config.getDeviceMeta(true);

    if (
      typeof versionFromCookie === "string" &&
      devMeta?.os &&
      versionFromCookie !== devMeta.os &&
      dialogNewSystemVersion.value &&
      dialogNewSystemVersion.value?.isActive() == false
    ) {
      systemVersion.value = devMeta.os;
      dialogNewSystemVersion.value?.open();
    }
  } catch (e) {
    errorOnChange(e);
  }
}

function reloadApp() {
  auth.logout();
  const url = new URL(window.location.href);
  url.searchParams.set("timestamp", new Date().getTime().toString());
  window.location.replace(url.toString());
}

onMounted(() => {
  auth.init();
  config.init();
  connectionMonitor.start();
  document.addEventListener("keyup", handleKeyUp);
  checkScreenType();
  window.addEventListener("resize", checkScreenType);
});

onUnmounted(() => {
  document.removeEventListener("keyup", handleKeyUp);
  window.removeEventListener("resize", checkScreenType);
});
</script>
<template>
  <NavBar
    v-show="showMainNavbar"
    :route-name="currentRouteName"
    @back="goBack"
  />
  <RouterView
    v-if="auth.authenticated !== LoginState.NOT_DEFINED"
    v-slot="{ Component }"
  >
    <KeepAlive include="HomeView">
      <component :is="Component"></component>
    </KeepAlive>
  </RouterView>
  <div
    id="ucvr-simulator-host-slot"
    v-show="currentRouteName === 'remote-simulator'"
    class="ucvr-simulator-host-slot"
    aria-label="Remote Simulator"
  ></div>
  <AppDialog
    ref="dialogNewSystemVersion"
    :title="$t('software_update.reload.title')"
    :text="$t('software_update.reload.description', { version: systemVersion })"
    :submit-text="$t('ui.reload')"
    :text-center="true"
    :icon="'fa-thin fa-circle-check'"
    :icon-type="'green'"
    :closeable="false"
    class="dialog--new-system-version"
    @submit="reloadApp"
  />
  <ul
    class="global-translations"
    style="position: fixed; top: -2000vh; left: -2000vw; opacity: 0"
  >
    <li class="global-translations_overflow-indicator">
      {{ $t("ui.scroll_for_more") }}
    </li>
  </ul>
</template>

<style lang="scss">
@use "@/assets/main.scss" as *;
</style>
