<!--
  Modified by Justin Jäger for the Unfolded.Tools Remote Simulator.
  Modified build first published: 2026-08-03.
  Licensed as part of the modified Web Configurator under GNU GPL v3.0 only.
  See MODIFICATIONS.md for details.
-->
<script setup lang="ts">
import { ref, computed, onMounted, useTemplateRef } from "vue";
import { useTranslation } from "i18next-vue";

import type { DeviceMeta } from "@/types/config";
import type {
  SystemInfo,
  CustomWebConfiguratorStatus,
} from "@/types/systemBase";

import { useGitInfo } from "@/composables/gitInfo";
import { useRemoteProperties } from "@/composables/remote/properties";

import { systemBaseStore } from "@/stores/systemBase";
import { configStore } from "@/stores/config";

import SettingsLicenses from "@/components/settings/SettingsLicenses.vue";

const systemBase = systemBaseStore();
const config = configStore();

const { i18next } = useTranslation();
const { getLatestTag } = useGitInfo();
const { getDeviceColor, getRemotControllerClasses } = useRemoteProperties();

const props = defineProps({
  back: {
    type: Function,
    required: true,
  },
});

const deviceMeta = ref<DeviceMeta | null>(null);
const systemInfo = ref<SystemInfo | null>(null);
const customWebConfigStatus = ref<CustomWebConfiguratorStatus | null>(null);

const deviceColor = ref("d");
const wifiAddress = ref("");

const loading = ref(false);

const elLicenses =
  useTemplateRef<InstanceType<typeof SettingsLicenses>>("elLicenses");

const btAddress = computed(() => config.config?.network?.bt?.address ?? "");

const isSecondModel = computed(() => {
  return deviceMeta.value?.model?.toLowerCase() === "ucr2";
});

const webConfigVersion = computed(() => {
  if (
    customWebConfigStatus.value != null &&
    customWebConfigStatus.value.active &&
    customWebConfigStatus.value.release?.version
  ) {
    return customWebConfigStatus.value.release?.version;
  }

  return getLatestTag();
});

onMounted(async () => {
  loading.value = true;

  try {
    deviceMeta.value = await config.getDeviceMeta();
  } catch (e) {
    console.error(e);
  }
  try {
    systemInfo.value = await systemBase.getSystemInfo();

    if (systemInfo.value && systemInfo.value.serial_number) {
      deviceColor.value = getDeviceColor(systemInfo.value?.serial_number);
    }
  } catch (e) {
    console.error(e);
  }
  try {
    customWebConfigStatus.value = await systemBase.getCustomWebConfigStatus();
  } catch (e) {
    console.error(e);
  }
  try {
    const wifiStatus = await systemBase.getWifiStatus();
    if (wifiStatus && wifiStatus.address) {
      wifiAddress.value = wifiStatus.address;
    }
  } catch (e) {
    console.error(e);
  }
  loading.value = false;
});
</script>
<template>
  <div class="about-remote">
    <button
      class="button button--secondary button--icon button--icon--medium"
      @click="props.back()"
    >
      <i class="fas fa-arrow-left"></i>
    </button>
    <span class="page-settings-section__page-name">
      {{ $t("settings.general.about.label") }}
    </span>

    <div class="page-settings-section__main page-settings-section__main--cols">
      <div class="page-settings-section__main__col-50">
        <div class="card">
          <div
            v-if="!loading"
            class="remote-controller"
            :class="
              !loading && getRemotControllerClasses(isSecondModel, deviceColor)
            "
          >
            <div
              class="remote-controller__device remote-controller__device--min"
            ></div>
          </div>
          <div v-if="systemInfo" class="about-remote__data-fields">
            <div class="settings-data-field">
              <span class="settings-data-field__label">{{
                $t("remote.meta_label.model_name")
              }}</span>
              <span class="settings-data-field__value">{{
                systemInfo?.model_name
              }}</span>
            </div>
            <div class="settings-data-field">
              <span class="settings-data-field__label">{{
                $t("remote.meta_label.model_number")
              }}</span>
              <span class="settings-data-field__value">{{
                systemInfo?.model_number
              }}</span>
            </div>
            <div class="settings-data-field">
              <span class="settings-data-field__label">{{
                $t("remote.meta_label.serial_number")
              }}</span>
              <span class="settings-data-field__value">{{
                systemInfo?.serial_number
              }}</span>
            </div>
            <div class="settings-data-field">
              <span class="settings-data-field__label">{{
                $t("remote.meta_label.revision")
              }}</span>
              <span class="settings-data-field__value">{{
                systemInfo?.hw_revision
              }}</span>
            </div>
            <div
              v-if="
                !loading &&
                systemInfo &&
                !isSecondModel &&
                i18next.exists(`remote.color.${deviceColor}`)
              "
              class="settings-data-field"
            >
              <span class="settings-data-field__label">{{
                $t("remote.meta_label.color")
              }}</span>
              <span class="settings-data-field__value">{{
                $t(`remote.color.${deviceColor}`)
              }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="page-settings-section__main__col-50">
        <!-- Not gated on `deviceMeta`: every field below carries its own guard, and the
             Licenses row at the end reports nothing about the device, so the column has to
             render even when the backend answered nothing. -->
        <div class="about-remote__data-fields">
          <div v-if="deviceMeta?.os" class="settings-data-field">
            <span class="settings-data-field__icon"
              ><i class="fa-thin fa-computer"></i
            ></span>
            <span class="settings-data-field__label">{{
              $t("remote.meta_label.system_version")
            }}</span>
            <span class="settings-data-field__value">{{ deviceMeta.os }}</span>
          </div>
          <div class="about-remote__data-fields__row">
            <div v-if="deviceMeta?.core" class="settings-data-field">
              <span class="settings-data-field__icon"
                ><i class="fa-thin fa-microchip"></i
              ></span>
              <span class="settings-data-field__label">{{
                $t("remote.meta_label.core_version")
              }}</span>
              <span class="settings-data-field__value">{{
                deviceMeta.core
              }}</span>
            </div>
            <div v-if="deviceMeta?.ui" class="settings-data-field">
              <span class="settings-data-field__icon"
                ><i class="fa-thin fa-table-columns"></i
              ></span>
              <span class="settings-data-field__label">{{
                $t("remote.meta_label.ui_version")
              }}</span>
              <span class="settings-data-field__value">{{
                deviceMeta.ui
              }}</span>
            </div>
          </div>
          <div
            v-if="webConfigVersion"
            class="settings-data-field settings-data-field--webconfig"
          >
            <span class="settings-data-field__icon"
              ><i class="fa-thin fa-sliders"></i
            ></span>
            <span class="settings-data-field__label">
              <span>{{
                $t("remote.meta_label.web_configurator_version")
              }}</span>
              <span
                v-if="
                  customWebConfigStatus != null && customWebConfigStatus.active
                "
                class="badge"
                >{{ $t("ui.custom") }}</span
              >
            </span>
            <span class="settings-data-field__value">{{
              webConfigVersion
            }}</span>
          </div>
          <div v-if="wifiAddress" class="settings-data-field">
            <span class="settings-data-field__icon"
              ><i class="fa-thin fa-wifi"></i
            ></span>
            <span class="settings-data-field__label">{{
              $t("remote.meta_label.wiFi_address")
            }}</span>
            <span class="settings-data-field__value">{{ wifiAddress }}</span>
          </div>
          <div v-if="btAddress" class="settings-data-field">
            <span class="settings-data-field__icon"
              ><i class="fa-thin fa-bluetooth"></i
            ></span>
            <span class="settings-data-field__label">{{
              $t("remote.meta_label.bluetooth_address")
            }}</span>
            <span class="settings-data-field__value">{{ btAddress }}</span>
          </div>

          <div class="settings-data-field ucvr-about-build-status">
            <span class="settings-data-field__icon"><i class="fa-thin fa-circle-info"></i></span>
            <span class="settings-data-field__label">Build status</span>
            <span class="settings-data-field__value">Unofficial · unsupported</span>
          </div>

          <a class="settings-data-field settings-data-field--link ucvr-about-legal-field" href="/remote-simulator/licensing/licenses" target="_blank" rel="noopener noreferrer">
            <span class="settings-data-field__icon"><i class="fa-thin fa-scale-balanced"></i></span><span class="settings-data-field__label">Open-source licenses</span><span class="settings-data-field__value">View notices</span>
          </a>
          <a class="settings-data-field settings-data-field--link ucvr-about-legal-field" href="/remote-simulator/licensing/source/" target="_blank" rel="noopener noreferrer">
            <span class="settings-data-field__icon"><i class="fa-thin fa-code"></i></span><span class="settings-data-field__label">Published source code</span><span class="settings-data-field__value">Browse source</span>
          </a>
          <a class="settings-data-field settings-data-field--link ucvr-about-legal-field" href="/remote-simulator/licensing/modifications" target="_blank" rel="noopener noreferrer">
            <span class="settings-data-field__icon"><i class="fa-thin fa-code-compare"></i></span><span class="settings-data-field__label">Modifications</span><span class="settings-data-field__value">View changes</span>
          </a>
          <a class="settings-data-field settings-data-field--link ucvr-about-legal-field" href="/remote-simulator/licensing/diff" target="_blank" rel="noopener noreferrer">
            <span class="settings-data-field__icon"><i class="fa-thin fa-code-compare"></i></span><span class="settings-data-field__label">Deployed build diff</span><span class="settings-data-field__value">Compare builds</span>
          </a>
          <button
            class="settings-data-field settings-data-field--link"
            @click="elLicenses?.open()"
          >
            <span class="settings-data-field__icon"
              ><i class="fa-thin fa-scale-balanced"></i
            ></span>
            <span class="settings-data-field__label">{{
              $t("settings.general.about.licenses.label", "License information")
            }}</span>
            <span class="settings-data-field__nav-icon"
              ><i class="fa-light fa-chevron-right"></i
            ></span>
          </button>
        </div>
      </div>
    </div>
    <SettingsLicenses ref="elLicenses" />
  </div>
</template>
