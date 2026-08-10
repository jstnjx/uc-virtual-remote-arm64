<script setup lang="ts">
import { ref, computed, watch, onMounted, useTemplateRef } from "vue";
import { asyncComputed } from "@vueuse/core";
import { useTranslation } from "i18next-vue";

import ApiConnection from "@/api";

import { SettingTypes, CfgGroups } from "@/types/enums";
import type { ChangeCallbackParams, DeviceMeta, CfgWiFi } from "@/types/config";
import type { SelectOption } from "@/types/ui";

import { appStateStore } from "@/stores/appState";
import { configStore } from "@/stores/config";
import { addErrorBottom, addErrorFull } from "@/stores/messages";
import { asError } from "@/composables/error";
import { systemBaseStore } from "@/stores/systemBase";

import UCInput from "@/components/ui/UCInput.vue";
import UCToggle from "@/components/ui/UCToggle.vue";
import UCRange from "@/components/ui/UCRange.vue";
import SettingsOptionButton from "@/components/settings/SettingsOptionButton.vue";
import AppDialog from "@/components/elements/AppDialog.vue";

const appState = appStateStore();
const config = configStore();
const systemBase = systemBaseStore();

const { t } = useTranslation();

const deviceMeta = ref<DeviceMeta | null>(null);

const bt = ref(false);
const peripheralConnections = ref(1);
const hciLogs = ref(false);
const wifi = ref(false);

const wifiScanning = ref(false);
const wifiScanningInterval = ref(0);
// Kept as the raw band values, with the labels derived below: a label built once
// and stored would keep the language it was built in ("auto" is translated).
const wifiBand = ref("");
const wifiBands = ref<string[]>([]);

const activeWifiBand = computed(() => ({
  label: getWifiBandLabel(wifiBand.value),
  value: wifiBand.value,
}));
const activeWifiBands = computed(() =>
  wifiBands.value.map((band) => ({
    label: getWifiBandLabel(band),
    value: band,
  })),
);

const dialogReboot =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogReboot");
const settingsSection = useTemplateRef<HTMLDivElement>("settingsSection");

const systemApi = ApiConnection.system;

const btAddress = computed(() => config.config?.network?.bt?.address ?? "");

watch(
  () => config.config?.network?.bt_enabled,
  (value) => {
    bt.value = value ?? false;
  },
  { immediate: true },
);

watch(
  () => config.config?.bt?.peripheral_connections,
  (value) => {
    peripheralConnections.value = value ?? 1;
  },
  { immediate: true },
);

watch(
  () => config.config?.bt?.enable_hci_log,
  (value) => {
    hciLogs.value = value ?? false;
  },
  { immediate: true },
);

watch(
  () => config.config?.network?.wifi_enabled,
  (value) => {
    wifi.value = value ?? false;
  },
  { immediate: true },
);

watch(
  () => config.wifiSettings,
  (settings) => {
    if (settings) {
      setWifiScanning(settings);

      if (!isSecondModel.value) {
        setWifiBand(settings);
      }
    }
  },
);

const wifiScanningIntervalSetting = computed(() => {
  return {
    name: "wifi_scanning_interval",
    value: wifiScanningInterval.value,
    type: SettingTypes.SECONDS,
    group: CfgGroups.network_wifi,
    settings: {
      min: 10,
      max: 60,
      step: 1,
      showLimits: true,
    },
  };
});

const isSecondModel = computed(() => {
  return deviceMeta.value?.model?.toLowerCase() === "ucr2";
});

const wifiAddress = asyncComputed(async () => {
  try {
    const status = await systemBase.getWifiStatus();
    return status?.address;
  } catch (error) {
    return asError(error).response?.data?.message;
  }
});

async function setWifiScanning(data?: CfgWiFi) {
  const settings = data ? data : await config.getWiFiSettings();
  const intervalSec = settings.scan_interval_sec;

  if (typeof intervalSec == "number") {
    wifiScanning.value = intervalSec > 0;
    wifiScanningInterval.value = intervalSec;
  }
}

async function setWifiBand(data?: CfgWiFi) {
  const settings = data ? data : await config.getWiFiSettings();

  if (settings.band) {
    wifiBand.value = settings.band;
  }

  if (settings.bands && settings.bands.length > 0) {
    wifiBands.value = ["auto", ...settings.bands];
  }
}

async function wifiChanged() {
  const params: ChangeCallbackParams = {
    group: CfgGroups.network,
    name: "wifi_enabled",
    value: wifi.value,
  };
  onItemChange(params);
}

async function wifiBandChanged(item: SelectOption<string>) {
  const params: ChangeCallbackParams = {
    group: CfgGroups.network_wifi,
    name: "band",
    value: item.value,
  };
  onItemChange(params);
}

function peripheralConnectionsChange() {
  if (peripheralConnections.value > 5) {
    peripheralConnections.value = 5;
  }

  if (peripheralConnections.value < 1) {
    peripheralConnections.value = 1;
  }

  onItemChangeByList([
    {
      name: "peripheral_connections",
      value: peripheralConnections.value,
    },
  ]).then(() => {
    dialogReboot.value?.open();
  });
}

function hciLogsChanged() {
  onItemChangeByList([
    {
      name: "enable_hci_log",
      value: hciLogs.value,
    },
  ]).then(() => {
    dialogReboot.value?.open();
  });
}

async function btChanged() {
  const params: ChangeCallbackParams = {
    group: CfgGroups.network,
    name: "bt_enabled",
    value: bt.value,
  };
  onItemChange(params);
}

async function wifiScanningChanged(val?: number) {
  let newValue = 0;

  if (val) {
    newValue = val;
  } else {
    newValue = wifiScanning.value ? 15 : 0;
    wifiScanningInterval.value = newValue;
  }

  const params: ChangeCallbackParams = {
    group: CfgGroups.network_wifi,
    name: "scan_interval_sec",
    value: newValue,
  };

  onItemChange(params);
}

function wifiScanningIntervalChanged(params: ChangeCallbackParams) {
  if (typeof params.value == "number") {
    wifiScanningChanged(params.value);
  }
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

async function onItemChangeByList(list: ChangeCallbackParams[]): Promise<void> {
  try {
    await config.updateByList(CfgGroups.bt as string, list);
  } catch (e) {
    addErrorBottom(e, null, settingsSection.value ?? undefined);
    throw e;
  }
}

function getWifiBandLabel(text: string): string {
  if (text === "auto") {
    return t("settings.wifi_bluetooth.wifi_band.option.auto");
  }
  const bandMap: Record<string, string> = {
    a: "5 Ghz",
    b: "2.4 Ghz",
  };
  return bandMap[text] || "";
}

async function reboot() {
  try {
    await systemApi.restartRemote();
    appState.setRestarting(true);
  } catch (e) {
    addErrorFull(e);
  }
}

onMounted(async () => {
  setWifiScanning();

  try {
    deviceMeta.value = await config.getDeviceMeta();
  } catch (e) {
    console.error(e);
  }

  if (!isSecondModel.value) {
    setWifiBand();
  }
});
</script>
<template>
  <div
    ref="settingsSection"
    class="page-settings-section page-settings-section--wifi-bluetooth"
  >
    <h1 class="page-settings-section__title">
      {{ $t("page.wifi_bluetooth") }}
    </h1>
    <div class="page-settings-section__main">
      <UCToggle
        v-model="bt"
        :label="$t('settings.wifi_bluetooth.bluetooth.label', 'Bluetooth')"
        :full-w="true"
        :settings="true"
        :description="btAddress"
        @change="btChanged"
      />
      <div
        v-if="config.config && config.config.bt && config.config.bt.version"
        class="page-settings-section__param"
      >
        <span class="page-settings-section__param__label">{{
          $t("settings.wifi_bluetooth.bluetooth.current_version")
        }}</span>
        <span class="page-settings-section__param__value">{{
          config.config.bt.version
        }}</span>
      </div>
      <div
        v-if="
          config.config &&
          config.config.bt &&
          config.config.bt.advertisement_name
        "
        class="page-settings-section__param page-settings-section__param"
      >
        <span class="page-settings-section__param__label">{{
          $t("settings.wifi_bluetooth.bluetooth.advertisement_name")
        }}</span>
        <span class="page-settings-section__param__value">{{
          config.config.bt.advertisement_name
        }}</span>
      </div>
      <div class="page-settings-section__divider"></div>

      <SettingsOptionButton
        :label="
          $t('settings.wifi_bluetooth.bluetooth.peripheral_connections.label')
        "
        :description="
          $t(
            'settings.wifi_bluetooth.bluetooth.peripheral_connections.description',
          )
        "
        :type="'peripheral-connections'"
      >
        <template #customFields>
          <UCInput
            v-model="peripheralConnections"
            :number-min="1"
            :number-max="5"
            :type="'number'"
            @change="peripheralConnectionsChange"
          />
        </template>
      </SettingsOptionButton>
      <div class="page-settings-section__divider"></div>
      <UCToggle
        v-model="hciLogs"
        :label="$t('settings.wifi_bluetooth.bluetooth.hci_logs.label')"
        :full-w="true"
        :settings="true"
        :description="
          $t('settings.wifi_bluetooth.bluetooth.hci_logs.description')
        "
        @change="hciLogsChanged"
      />
      <UCToggle
        v-model="wifi"
        :label="$t('settings.wifi_bluetooth.wifi')"
        :full-w="true"
        :settings="true"
        :description="wifiAddress"
        @change="wifiChanged"
      />
      <div
        class="page-settings-section__main__options page-settings-section__main__options-wifi-scanning"
      >
        <UCToggle
          v-model="wifiScanning"
          :label="$t('settings.wifi_bluetooth.wifi_scanning.label')"
          :full-w="true"
          :settings="true"
          :description="$t('settings.wifi_bluetooth.wifi_scanning.description')"
          @change="wifiScanningChanged()"
        />

        <UCRange
          v-if="wifiScanning"
          v-model="wifiScanningInterval"
          :definition="wifiScanningIntervalSetting"
          :name="wifiScanningIntervalSetting.name"
          :settings="true"
          @change="wifiScanningIntervalChanged"
        />
      </div>

      <div v-if="!isSecondModel" class="page-settings-section__divider"></div>
      <SettingsOptionButton
        v-if="!isSecondModel"
        :select="true"
        :select-update="wifiBandChanged"
        :active-option-item="activeWifiBand"
        :select-items="activeWifiBands"
        :label="$t('settings.wifi_bluetooth.wifi_band.label')"
        :select-small-screen-position="'right'"
        :select-dynamic-position="true"
      />
    </div>
    <AppDialog
      ref="dialogReboot"
      :title="$t('reboot.title')"
      :text="$t('reboot.description')"
      :submit-text="$t('ui.reboot')"
      :cancel-text="$t('ui.cancel')"
      @submit="reboot"
    />
  </div>
</template>
