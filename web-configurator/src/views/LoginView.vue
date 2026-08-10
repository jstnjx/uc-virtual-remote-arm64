<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { asyncComputed } from "@vueuse/core";

import type { DropdownItem } from "@/types/ui";

import { authStorage } from "@/stores/auth";
import { appStateStore } from "@/stores/appState";

import { configStore } from "@/stores/config";

import { toLoginErrorKey } from "@/composables/authHelpers";
import { setCookie } from "@/composables/cookieHandler";

import DropdownMenu from "@/components/ui/DropdownMenu.vue";
import UCInput from "@/components/ui/UCInput.vue";
import DeviceMeta from "@/components/elements/device/DeviceMeta.vue";
import VersionInfo from "@/components/elements/VersionInfo.vue";
import AppDialog from "@/components/elements/AppDialog.vue";

const router = useRouter();
const route = useRoute();
const auth = authStorage();
const appState = appStateStore();
const config = configStore();
const pin = ref("");
const inFlight = ref(false);
const errorMessage = ref("");
const unofficialDialog = ref<InstanceType<typeof AppDialog> | null>(null);

const loading = computed(() => {
  return (
    !config.deviceMeta ||
    !config.deviceMeta.model ||
    config.deviceMeta.model.length < 1
  );
});

const disable = computed(() => {
  return !appState.connected || inFlight.value;
});

// Auth state could not be resolved (device unreachable) but a PIN is stored:
// show "connecting" instead of a PIN prompt — the user is not logged out,
// their state is unknown (docs/specs/002-login-flow-hardening.md §3.4).
const connecting = computed(() => {
  return auth.initError && auth.hasPin;
});

const isModelSecond = asyncComputed(async () => {
  const model = await config.getDeviceModel();
  return model?.toLowerCase() == "ucr2";
});

// Retry initialization the moment the ConnectionMonitor's probe sees the
// device again — no user interaction needed after the remote wakes up.
watch(
  () => appState.deviceReachable,
  (reachable) => {
    if (reachable && auth.initError) {
      void auth.retryInitialization();
    }
  },
);

// Sole navigation path away from the login page: covers PIN submission,
// late initialization success, and re-auth completing in the background.
watch(
  () => auth.isAuthenticated,
  (authenticated) => {
    if (authenticated) {
      const redirect =
        typeof route.query.redirect === "string" ? route.query.redirect : "/";
      router.push(redirect);
    }
  },
  { immediate: true },
);

watch(
  () => auth.error,
  (err) => {
    errorMessage.value = err ? toLoginErrorKey(err) : "";
  },
);

async function doAuthenticate() {
  if (inFlight.value || pin.value.length < 1) {
    return;
  }
  inFlight.value = true;
  try {
    await auth.authenticate(pin.value);
    // navigation happens via the isAuthenticated watch above
  } finally {
    inFlight.value = false;
  }
}

function retryConnecting() {
  void auth.retryInitialization();
}

const apiDefinitionItems = [
  {
    label: "login.api_definitions.items.api_rest",
    value: "doc/core-rest/",
  },
  {
    label: "login.api_definitions.items.api_ws",
    value: "doc/core-ws/",
  },
  {
    label: "login.api_definitions.items.test_console",
    value: "ws.html",
  },
  {
    label: "login.api_definitions.items.integration_api_ws",
    value: "doc/integration/",
  },
] as DropdownItem[];

function goTo(item: DropdownItem) {
  if (window.location.hostname && item.value) {
    window.location.href = `//${window.location.host}/${item.value}`;
  }
}

function clearErrors() {
  if (errorMessage.value.length > 0) {
    errorMessage.value = "";
  }
}

async function saveDeviceVersion() {
  const devMeta = await config.getDeviceMeta();
  if (devMeta && devMeta.os) {
    setCookie("systemVersion", devMeta.os);
  }
}

onMounted(() => {
  saveDeviceVersion();
  unofficialDialog.value?.open();
});
</script>
<template>
  <Suspense>
    <div
      class="page-login"
      :class="{
        'page-login--v2': isModelSecond,
        'page-login--loading': loading,
      }"
    >
      <div class="page-login__body">
        <Suspense>
          <DeviceMeta />
        </Suspense>
        <template v-if="connecting">
          <h3>{{ $t("login.connecting.title") }}</h3>
          <p class="page-login__connecting-description">
            {{ $t("login.connecting.description") }}
          </p>
          <button class="button" @click="retryConnecting">
            {{ $t("login.connecting.retry") }}
          </button>
        </template>
        <template v-else>
          <h3>{{ $t("login.enter_pin") }}</h3>
          <UCInput
            v-model="pin"
            :type="'password'"
            :label="$t('login.pin', 'PIN')"
            :description="$t('login.pin_description')"
            :error-message="errorMessage ? $t(errorMessage) : ''"
            :disabled="disable"
            :disable-blur="true"
            :focus="true"
            @submit="doAuthenticate"
            @click="clearErrors"
          />
        </template>
        <div class="page-login__api-definitions">
          <DropdownMenu :list-data="apiDefinitionItems" @item-click="goTo">
            <template #trigger>
              {{ $t("login.api_definitions.label") }}
            </template>
          </DropdownMenu>
        </div>
      </div>

      <footer class="page-login__footer">
        <VersionInfo class="version-info--login" />
      </footer>
    </div>
  </Suspense>

  <AppDialog
    ref="unofficialDialog"
    title="Unofficial Web Configurator"
    text="This Web Configurator is an unofficial community build and is not affiliated with or endorsed by Unfolded Circle."
    submit-text="Dismiss"
  />
</template>
