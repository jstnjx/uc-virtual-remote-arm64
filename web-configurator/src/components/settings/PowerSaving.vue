<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";
import { asyncComputed } from "@vueuse/core";
import { useTranslation } from "i18next-vue";

import type { ChangeCallbackParams } from "@/types/config";
import { SettingTypes, CfgGroups } from "@/types/enums";

import { configStore } from "@/stores/config";
import { addErrorBottom } from "@/stores/messages";

import UCToggle from "@/components/ui/UCToggle.vue";
import UCRange from "@/components/ui/UCRange.vue";

const { t } = useTranslation();

const wakeupSensitivityValue = ref(0);
const displayTimeoutValue = ref(0);
const sleepTimeoutValue = ref(0);
const config = configStore();

const wakeOnWlan = ref<boolean>(false);

const settingsSection = useTemplateRef<HTMLDivElement>("settingsSection");

watch(
  () => config.config?.network?.wake_on_wlan?.enabled,
  (value) => {
    wakeOnWlan.value = value ?? false;
  },
  { immediate: true },
);

watch(
  () => config.config?.power_saving?.wakeup_sensitivity,
  (value) => {
    wakeupSensitivityValue.value = value ?? 0;
  },
  { immediate: true },
);

watch(
  () => config.config?.power_saving?.standby_sec,
  (value) => {
    sleepTimeoutValue.value = value ?? 0;
  },
  { immediate: true },
);

watch(
  () => config.config?.power_saving?.display_off_sec,
  (value) => {
    displayTimeoutValue.value = value ?? 0;
  },
  { immediate: true },
);

// computed, not a ref: t() only re-runs on a language change when it is read
// inside a tracked scope.
const wakeupSensitivityLevels = computed(() => [
  t("settings.power_saving.wakeup_sensitivity.level.off"),
  t("settings.power_saving.wakeup_sensitivity.level.low"),
  t("settings.power_saving.wakeup_sensitivity.level.medium"),
  t("settings.power_saving.wakeup_sensitivity.level.high"),
]);

const wowlanAvailable = asyncComputed(async () => {
  if (import.meta.env.VITE_WOWLAN === "true") {
    return true;
  }

  let model = "";
  try {
    model = await config.getDeviceModel();
  } catch (e) {
    addErrorBottom(e);
  }
  return model?.toLowerCase() == "ucr2";
});

const displayBrightnessSetting = computed(() => {
  return {
    name: "wakeup_sensitivity",
    value: wakeupSensitivityValue.value,
    label: t("settings.power_saving.wakeup_sensitivity.label"),
    type: "",
    group: CfgGroups.power_saving,
    settings: {
      min: 0,
      max: 3,
      step: 1,
      showLimits: true,
    },
  };
});

const displayTimeoutSetting = computed(() => {
  return {
    name: "display_off_sec",
    value: displayTimeoutValue.value,
    label: t("settings.power_saving.display_timeout.label"),
    type: SettingTypes.SECONDS,
    group: CfgGroups.power_saving,
    settings: {
      min: 10,
      max: 60,
      showValue: true,
      showLimits: true,
      valueFormatter: null,
    },
  };
});

const sleepTimeoutSetting = computed(() => {
  return {
    name: "standby_sec",
    value: sleepTimeoutValue.value,
    label: t("settings.power_saving.sleep_timeout.label"),
    type: SettingTypes.SECONDS,
    group: CfgGroups.power_saving,
    settings: {
      min: 10,
      max: 1800,
      showValue: true,
      showLimits: true,
      valueFormatter: null,
    },
  };
});

async function wakeOnWlanChanged() {
  const message = {
    wake_on_wlan: {
      enabled: wakeOnWlan.value,
    },
  };

  try {
    await config.baseUpdate(CfgGroups.network as string, message);
  } catch (e) {
    addErrorBottom(e, null, settingsSection.value ?? undefined);
  }
}

async function wakeupSensitivityChanged(params: ChangeCallbackParams) {
  onItemChange(params);
}

async function displayTimeoutChanged(params: ChangeCallbackParams) {
  onItemChange(params);
}

async function sleepTimeoutChanged(params: ChangeCallbackParams) {
  onItemChange(params);
}

async function onItemChange(params: ChangeCallbackParams) {
  try {
    await config.update(
      params.group as string,
      params.name as string,
      params.value,
    );
  } catch (e) {
    addErrorBottom(e, null, settingsSection.value ?? undefined);
  }
}
</script>
<template>
  <div ref="settingsSection" class="page-settings-section">
    <h1 class="page-settings-section__title">
      {{ $t("page.power_saving") }}
    </h1>
    <div class="page-settings-section__main">
      <UCToggle
        v-if="wowlanAvailable"
        v-model="wakeOnWlan"
        :label="$t('settings.power_saving.wake_on_wlan.label')"
        :full-w="true"
        :settings="true"
        :description="$t('settings.power_saving.wake_on_wlan.description')"
        @change="wakeOnWlanChanged"
      />
      <UCRange
        v-model="wakeupSensitivityValue"
        :definition="displayBrightnessSetting"
        :name="displayBrightnessSetting.name"
        :points="[0, 1, 2, 3]"
        :points-label="wakeupSensitivityLevels"
        :label="$t('settings.power_saving.wakeup_sensitivity.label')"
        :description="
          $t('settings.power_saving.wakeup_sensitivity.description')
        "
        :settings="true"
        @change="wakeupSensitivityChanged"
      />
      <UCRange
        v-model="displayTimeoutValue"
        :definition="displayTimeoutSetting"
        :name="displayTimeoutSetting.name"
        :label="$t('settings.power_saving.display_timeout.label')"
        :description="$t('settings.power_saving.display_timeout.description')"
        :settings="true"
        @change="displayTimeoutChanged"
      />
      <UCRange
        v-model="sleepTimeoutValue"
        :definition="sleepTimeoutSetting"
        :name="sleepTimeoutSetting.name"
        :label="$t('settings.power_saving.sleep_timeout.label')"
        :description="$t('settings.power_saving.sleep_timeout.description')"
        :settings="true"
        @change="sleepTimeoutChanged"
      />
    </div>
  </div>
</template>
