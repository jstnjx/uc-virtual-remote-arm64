<script setup lang="ts">
import { ref, useTemplateRef } from "vue";
import { useRouter } from "vue-router";

import type { ErrorTexts } from "@/types/flashMessages";

import ApiConnection from "@/api";

import { authStorage } from "@/stores/auth";
import { appStateStore } from "@/stores/appState";
import { systemBaseStore } from "@/stores/systemBase";

import { getErrorMessage } from "@/composables/error";
import { addErrorBottom } from "@/stores/messages";
import { useTiming } from "@/composables/timing";

import AppDialog from "@/components/elements/AppDialog.vue";
import ErrorBox from "@/components/ui/ErrorBox.vue";

const router = useRouter();
const auth = authStorage();
const appState = appStateStore();
const systemBaseStorage = systemBaseStore();

const { sleep } = useTiming();

const tokenValue = ref("");
const dialogFactoryReset =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogFactoryReset");
const errorReset = ref<ErrorTexts | null>(null);

let timer: number;

function confirmReset() {
  clearTimeout(timer);
  ApiConnection.getFactoryReset()
    .doReset(tokenValue.value)
    .then(async () => {
      await systemBaseStorage.removeStandbyInhibitor("web-configurator");
      // fire-and-forget is intended: the device is wiping itself, the REST
      // logout may never answer — local state is cleared synchronously
      void auth.logout();
      router.push({ name: "login" });
      await sleep(500);
      appState.setRestarting(true);
    })
    .catch((e: unknown) => {
      errorReset.value = getErrorMessage(e);
    });
}

function openDialog() {
  ApiConnection.getFactoryReset()
    .getToken()
    .then((token: string) => {
      tokenValue.value = token;
      if (dialogFactoryReset.value) {
        dialogFactoryReset.value?.open();
      }
      timer = window.setTimeout(closeDialog, 55 * 1000);
    })
    .catch((e: unknown) => {
      addErrorBottom(e);
    });
}

function closeDialog() {
  dialogFactoryReset.value?.close();
}

function dialogClosed() {
  tokenValue.value = "token";
  clearTimeout(timer);
}
</script>
<template>
  <div class="page-settings-section page-settings-section--factory-reset">
    <h1 class="page-settings-section__title">
      {{ $t("page.factory_reset") }}
    </h1>
    <div class="page-settings-section__main">
      <div
        class="page-settings-section__main__text page-settings-section__main__info--warning"
      >
        {{ $t("settings.factory_reset.description") }}
      </div>
      <button class="button button--danger button--min-w" @click="openDialog">
        {{ $t("settings.factory_reset.button") }}
      </button>
      <ErrorBox v-if="errorReset" :message="errorReset" :margin-top="true" />

      <AppDialog
        ref="dialogFactoryReset"
        icon="fa-thin fa-warning"
        :title="$t('settings.factory_reset.config.title')"
        :text="$t('settings.factory_reset.config.description')"
        :submit-text="$t('ui.confirm')"
        :cancel-text="$t('ui.cancel')"
        :warning="true"
        :text-center="true"
        @submit="confirmReset"
        @close="dialogClosed"
      />
    </div>
  </div>
</template>
