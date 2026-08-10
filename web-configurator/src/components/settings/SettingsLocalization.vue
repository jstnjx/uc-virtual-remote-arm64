<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";

import { CfgGroups } from "@/types/enums";
import type { ChangeCallbackParams } from "@/types/config";
import type { SelectOption } from "@/types/ui";

import { configStore } from "@/stores/config";
import { addErrorBottom } from "@/stores/messages";
import { uiLanguages, applyLanguage } from "@/i18next";

import UCToggle from "@/components/ui/UCToggle.vue";
import SettingsOptionButton from "@/components/settings/SettingsOptionButton.vue";

const config = configStore();

const timeFormat = ref(false);
const settingsSection = useTemplateRef<HTMLDivElement>("settingsSection");

watch(
  () => config.config?.localization?.time_format_24h,
  (value) => {
    timeFormat.value = value ?? false;
  },
  { immediate: true },
);

const menuLanguageItems = computed(() => {
  if (!config.list.languages || config.list.languages.length < 1) {
    return [];
  }

  // Offer only the languages this build exposes (VITE_LANGUAGES allowlist, or all
  // shipped languages when unset). Every offered language is loaded on demand.
  return config.list.languages
    .filter((lang) => uiLanguages.includes(lang.code))
    .map((lang) => ({
      value: lang.code,
      label: lang.name,
    }));
});

const menuCountryItems = computed(() => {
  if (!config.list.countries || config.list.countries.length < 1) {
    return [];
  }

  return config.list.countries.map((country) => ({
    value: country.code,
    label: country.name_en,
  }));
});

const menuTimezoneItems = computed(() => {
  if (!config.list.tz || config.list.tz.length < 1) {
    return [];
  }

  return config.list.tz.map((timezone) => ({
    value: timezone,
    label: timezone,
  }));
});

const menuUnitSystemItems = computed(() => {
  if (
    !config.list.unitSystems ||
    Object.keys(config.list.unitSystems).length < 1
  ) {
    return [];
  }

  return Object.keys(config.list.unitSystems).map((unit) => ({
    value: unit,
    label: unit,
  }));
});

const activeLanguageOptionItem = computed(() => {
  return (
    menuLanguageItems.value.find(
      (item) => item.value === config.config?.localization?.language_code,
    ) || { label: "", value: "" }
  );
});

const activeCountryOptionItem = computed(() => {
  return (
    menuCountryItems.value.find(
      (item) => item.value === config.config?.localization?.country_code,
    ) || { label: "", value: "" }
  );
});

const activeTimezoneOptionItem = computed(() => {
  return (
    menuTimezoneItems.value.find(
      (item) => item.value === config.config?.localization?.time_zone,
    ) || { label: "", value: "" }
  );
});

const activeUnitSystemOptionItem = computed(() => {
  return (
    menuUnitSystemItems.value.find(
      (item) => item.value === config.config?.localization?.measurement_unit,
    ) || { label: "", value: "" }
  );
});

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

async function languageChanged(item: SelectOption<string>) {
  // Apply the UI language immediately for instant feedback, rather than waiting
  // for the REST → WebSocket round-trip that reaches the config $subscribe in
  // main.ts (which also switches the language, but only after the echo lands).
  void applyLanguage(item.value);
  const params: ChangeCallbackParams = {
    group: CfgGroups.localization,
    name: "language_code",
    value: item.value,
  };
  onItemChange(params);
}

async function countryChanged(item: SelectOption<string>) {
  const params: ChangeCallbackParams = {
    group: CfgGroups.localization,
    name: "country_code",
    value: item.value,
  };
  onItemChange(params);
}
async function timeFormatChanged() {
  const params: ChangeCallbackParams = {
    group: CfgGroups.localization,
    name: "time_format_24h",
    value: timeFormat.value,
  };
  onItemChange(params);
}

async function timezoneChanged(item: SelectOption<string>) {
  const params: ChangeCallbackParams = {
    group: CfgGroups.localization,
    name: "time_zone",
    value: item.value,
  };
  onItemChange(params);
}

async function unitSystemChanged(item: SelectOption<string>) {
  const params: ChangeCallbackParams = {
    group: CfgGroups.localization,
    name: "measurement_unit",
    value: item.value,
  };
  onItemChange(params);
}
</script>
<template>
  <div
    ref="settingsSection"
    class="page-settings-section page-settings-section--localization"
  >
    <h1 class="page-settings-section__title">
      {{ $t("page.localization") }}
    </h1>
    <div class="page-settings-section__main">
      <SettingsOptionButton
        :select="true"
        :select-update="languageChanged"
        :active-option-item="activeLanguageOptionItem"
        :select-items="menuLanguageItems"
        :label="$t('settings.localization.language')"
        :select-searchable="true"
        :select-small-screen-position="'right'"
      />
      <SettingsOptionButton
        :select="true"
        :select-update="countryChanged"
        :active-option-item="activeCountryOptionItem"
        :select-items="menuCountryItems"
        :label="$t('settings.localization.country')"
        :select-searchable="true"
        :select-small-screen-position="'right'"
      />
      <SettingsOptionButton
        :select="true"
        :select-update="timezoneChanged"
        :active-option-item="activeTimezoneOptionItem"
        :select-items="menuTimezoneItems"
        :label="$t('settings.localization.timezone')"
        :select-searchable="true"
        :select-small-screen-position="'right'"
      />
      <UCToggle
        v-model="timeFormat"
        :label="$t('settings.localization.time_format')"
        :full-w="true"
        :settings="true"
        @change="timeFormatChanged"
      />
      <SettingsOptionButton
        :select="true"
        :select-update="unitSystemChanged"
        :active-option-item="activeUnitSystemOptionItem"
        :select-items="menuUnitSystemItems"
        :label="$t('settings.localization.unit_system')"
        :select-small-screen-position="'right'"
      />
    </div>
  </div>
</template>
