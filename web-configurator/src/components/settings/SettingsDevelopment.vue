<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import { asyncComputed } from "@vueuse/core";
import ApiConnection from "@/api";

import type { ChangeCallbackParams, CfgFeature } from "@/types/config";
import { CfgGroups } from "@/types/enums";

import { appStateStore } from "@/stores/appState";
import { configStore } from "@/stores/config";
import { addErrorBottom } from "@/stores/messages";

import translatedProperty from "@/composables/translatedProperty";
import { getIconName } from "@/composables/icon";

import SettingsOptionButton from "@/components/settings/SettingsOptionButton.vue";
import UCToggle from "@/components/ui/UCToggle.vue";
import SettingsLogs from "@/components/settings/SettingsLogs.vue";

const appState = appStateStore();
const config = configStore();
const systemApi = ApiConnection.system;

const currentPage = ref<string>("home");
const settingsSection = useTemplateRef<HTMLDivElement>("settingsSection");

const previewFeaturesList = computed<CfgFeature[]>(
  () => (config.config?.features as CfgFeature[]) ?? [],
);

const iconPreview = asyncComputed(async () => {
  return await getIconName("fa-eye");
});

const pageTransition = computed(() => {
  return currentPage.value == "home"
    ? "slide-settings-right"
    : "slide-settings-left";
});

function goToPage(page: string) {
  currentPage.value = page;
}

function featureChange(ev: Event, featureId: string) {
  const chbox = ev.target as HTMLInputElement;
  const params: ChangeCallbackParams = {
    group: CfgGroups.features,
    value: {
      id: featureId,
      enabled: chbox.checked,
    },
  };
  onFeaturesItemChange(params);
}

async function onRestart() {
  try {
    await systemApi.restartRemote();
    appState.setRestarting(true);
  } catch (e) {
    addErrorBottom(e, null, settingsSection.value ?? undefined);
  }
}

async function onFeaturesItemChange(params: ChangeCallbackParams) {
  try {
    await config.baseUpdate(params.group as string, params.value);
  } catch (e) {
    addErrorBottom(e, null, settingsSection.value ?? undefined);
  }
}
</script>
<template>
  <div class="page-settings-wrapper page-settings-wrapper--development">
    <Transition :name="pageTransition">
      <div v-if="currentPage === 'home'" class="page-settings-section">
        <h1 class="page-settings-section__title">
          {{ $t("page.development") }}
        </h1>
        <div class="page-settings-section__main">
          <div class="page-settings-section__main__options">
            <SettingsOptionButton
              icon="fa-thin fa-file-lines"
              button-icon="fa-light fa-chevron-right"
              :label="$t('settings.development.logs.label')"
              :description="$t('settings.development.logs.description')"
              :clickable="true"
              @click="goToPage('logs')"
            />
            <div class="page-settings-section__divider"></div>
            <SettingsOptionButton
              :icon="`fa-thin ${iconPreview}`"
              button-icon="fa-light fa-chevron-right"
              :label="$t('settings.development.preview_features.label')"
              :description="
                $t('settings.development.preview_features.description')
              "
              :clickable="true"
              @click="goToPage('preview')"
            />
          </div>
        </div>
      </div>
    </Transition>
    <Transition :name="pageTransition">
      <div v-if="currentPage === 'logs'" class="page-settings-section">
        <SettingsLogs @click-back="() => goToPage('home')" />
      </div>
    </Transition>

    <Transition :name="pageTransition">
      <div
        v-if="currentPage === 'preview'"
        ref="settingsSection"
        class="page-settings-section"
      >
        <button
          class="button button--secondary button--icon button--icon--medium"
          @click="goToPage('home')"
        >
          <i class="fas fa-arrow-left"></i>
        </button>
        <span class="page-settings-section__page-name">
          {{ $t("settings.development.preview_features.label") }}
        </span>
        <div class="page-settings-section__preview-features">
          <div class="page-settings-section__main">
            <template v-for="feature in previewFeaturesList" :key="feature.id">
              <SettingsOptionButton
                :label="translatedProperty(feature.title)"
                :description="translatedProperty(feature.description)"
              >
                <template #customFields>
                  <div class="settings-option-button__toggle">
                    <a
                      v-if="feature.help_url"
                      :href="feature.help_url"
                      target="_blank"
                      class="button button--blank button-read-more"
                    >
                      <i class="fa-light fa-book-open-reader"></i>
                      {{ $t("ui.read_more") }}
                    </a>
                    <UCToggle
                      v-model="feature.enabled"
                      @change="featureChange($event, feature.id)"
                    />
                  </div>
                </template>
              </SettingsOptionButton>
            </template>
            <p class="page-settings-section__preview-features__instruction">
              {{ $t("settings.development.restart_remote.description") }}
            </p>
            <button
              class="button button--secondary button--min-w"
              @click="onRestart"
            >
              {{ $t("settings.development.restart_remote.label") }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
