<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";
import { useTranslation } from "i18next-vue";

import { CfgGroups, SettingTypes } from "@/types/enums";
import type { ChangeCallbackParams } from "@/types/config";
import { configStore } from "@/stores/config";
import { addErrorBottom } from "@/stores/messages";

import UCToggle from "@/components/ui/UCToggle.vue";
import UCRange from "@/components/ui/UCRange.vue";

const { t } = useTranslation();

const soundEffects = ref(false);
const hapticFeedback = ref(false);
const soundEffectsVolume = ref(0);
const config = configStore();
const settingsSection = useTemplateRef<HTMLDivElement>("settingsSection");

watch(
  () => config.config?.sound?.enabled,
  (value) => {
    soundEffects.value = value ?? false;
  },
  { immediate: true },
);

watch(
  () => config.config?.haptic?.enabled,
  (value) => {
    hapticFeedback.value = value ?? false;
  },
  { immediate: true },
);

watch(
  () => config.config?.sound?.volume,
  (value) => {
    soundEffectsVolume.value = value ?? 0;
  },
  { immediate: true },
);

const soundEffectsVolumeSetting = computed(() => {
  return {
    name: "volume",
    value: soundEffectsVolume.value,
    label: t("settings.sound_haptic.sound_effects_volume"),
    type: SettingTypes.PERCENT,
    group: CfgGroups.sound,
    settings: {
      min: 0,
      max: 100,
      showValue: true,
      valueFormatter: null,
    },
  };
});

async function soundEffectsVolumeChanged(params: ChangeCallbackParams) {
  onItemChange(params);
}

async function soundEffectsChanged() {
  const params: ChangeCallbackParams = {
    group: CfgGroups.sound,
    name: "enabled",
    value: soundEffects.value,
  };

  onItemChange(params);
}

async function hapticFeedbackChanged() {
  const params: ChangeCallbackParams = {
    group: CfgGroups.haptic,
    name: "enabled",
    value: soundEffects.value,
  };

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
  <div
    ref="settingsSection"
    class="page-settings-section page-settings-section--sound-haptic"
  >
    <h1 class="page-settings-section__title">
      {{ $t("page.sound_haptic") }}
    </h1>
    <div class="page-settings-section__main">
      <UCToggle
        v-model="soundEffects"
        :label="$t('settings.sound_haptic.sound_effects')"
        :full-w="true"
        :settings="true"
        :description="$t('settings.sound_haptic.sound_effects_description')"
        @change="soundEffectsChanged"
      />
      <UCRange
        v-model="soundEffectsVolume"
        name="volume"
        :definition="soundEffectsVolumeSetting"
        :settings="true"
        @change="soundEffectsVolumeChanged"
      />
      <UCToggle
        v-model="hapticFeedback"
        :label="$t('settings.sound_haptic.haptic_feedback')"
        :full-w="true"
        :settings="true"
        :description="$t('settings.sound_haptic.haptic_feedback_description')"
        @change="hapticFeedbackChanged"
      />
    </div>
  </div>
</template>
