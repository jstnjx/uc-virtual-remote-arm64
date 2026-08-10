<script setup lang="ts">
import { ref, watch, computed, onBeforeMount, useTemplateRef } from "vue";
import { useTranslation } from "i18next-vue";

import { SettingTypes } from "@/types/enums";
import type { ChangeCallbackParams } from "@/types/config";
import type { ColorPickerValue } from "@/types/ui";
import { CfgGroups } from "@/types/enums";

import { configStore } from "@/stores/config";
import { addErrorBottom } from "@/stores/messages";

import SettingsOptionButton from "@/components/settings/SettingsOptionButton.vue";
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- ADR 0004: used by the commented-out deferred auto-brightness/backlight toggles below
import UCToggle from "@/components/ui/UCToggle.vue";
import UCRange from "@/components/ui/UCRange.vue";
import ColorPicker from "@/components/ui/ColorPicker.vue";
import AppDialog from "@/components/elements/AppDialog.vue";

const { t } = useTranslation();

const autoBrightness = ref(false);
const buttonBacklight = ref(false);
const displayBrightnessValue = ref(5);
const buttonBrightnessValue = ref(0);
const buttonBacklightColor = ref<number[]>([255, 255, 255]);
const config = configStore();
const settingsSection = useTemplateRef<HTMLDivElement>("settingsSection");
const dialogResetBacklightColor = useTemplateRef<
  InstanceType<typeof AppDialog>
>("dialogResetBacklightColor");

watch(
  () => config.config?.display?.brightness,
  (value) => {
    displayBrightnessValue.value = value ?? 5;
  },
  { immediate: true },
);

watch(
  () => config.config?.display?.auto_brightness,
  (value) => {
    autoBrightness.value = value ?? false;
  },
  { immediate: true },
);

watch(
  () => config.config?.button?.auto_brightness,
  (value) => {
    buttonBacklight.value = value ?? false;
  },
  { immediate: true },
);

watch(
  () => config.config?.button?.brightness,
  (value) => {
    buttonBrightnessValue.value = value ?? 0;
  },
  { immediate: true },
);

const displayBrightnessSetting = computed(() => {
  return {
    name: "display_brightness",
    value: displayBrightnessValue.value,
    label: t("settings.display.display_brightness"),
    type: SettingTypes.PERCENT,
    group: CfgGroups.display,
    settings: {
      min: 5,
    },
  };
});

const buttonBrightnessSetting = computed(() => {
  return {
    name: "button_brightness",
    value: buttonBrightnessValue.value,
    label: t("settings.display.button_brightness"),
    type: SettingTypes.PERCENT,
    group: CfgGroups.button,
  };
});

// undefined until the device model is known, to avoid flashing the
// backlight-color section on models that don't support it
const isModelSecond = ref<boolean>();

onBeforeMount(async () => {
  try {
    const model = await config.getDeviceModel();
    isModelSecond.value = model?.toLowerCase() == "ucr2";
  } catch (e) {
    addErrorBottom(e);
  }
});

watch(
  () => config.config?.button?.static_color?.rgb,
  (value) => {
    if (!isModelSecond.value && value) {
      buttonBacklightColor.value = value;
    }
  },
  { immediate: true },
);

async function displayBrightnessChanged(params: ChangeCallbackParams) {
  onItemChange(params);
}

async function buttonBrightnessChanged(params: ChangeCallbackParams) {
  onItemChange(params);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- ADR 0004: handler for the commented-out deferred auto-brightness toggle
async function autoBrightnessChanged() {
  const params: ChangeCallbackParams = {
    group: CfgGroups.display,
    name: "auto_brightness",
    value: autoBrightness.value,
  };
  onItemChange(params);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- ADR 0004: handler for the commented-out deferred button-backlight toggle
async function buttonBacklightChanged() {
  const params: ChangeCallbackParams = {
    group: CfgGroups.button,
    name: "auto_brightness",
    value: buttonBacklight.value,
  };
  onItemChange(params);
}

async function buttonBacklightColorChanged(message: ColorPickerValue) {
  buttonBacklightColor.value = message.rgb;
  const color = {
    rgb: buttonBacklightColor.value,
  };
  const params: ChangeCallbackParams = {
    group: CfgGroups.button,
    name: "static_color",
    value: color,
  };
  await onItemChange(params);

  if (
    !isModelSecond.value &&
    !config.$state.config?.button?.static_color?.rgb
  ) {
    try {
      await config.getAll();
    } catch (e) {
      addErrorBottom(e, null, settingsSection.value ?? undefined);
    }
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

function resetButtonBacklightColor() {
  buttonBacklightColorChanged({
    rgb: [255, 255, 255],
    hsl: [0, 0, 100],
  } as ColorPickerValue);
}

function startResetButtonBacklightColor() {
  dialogResetBacklightColor.value?.open();
}
</script>
<template>
  <div
    ref="settingsSection"
    class="page-settings-section page-settings-section--display"
  >
    <h1 class="page-settings-section__title">
      {{ $t("page.display") }}
    </h1>
    <div class="page-settings-section__main">
      <!-- <UCToggle
        v-model="autoBrightness"
        @change="autoBrightnessChanged"
        :label="$t('settings.display.auto_brightness')"
        :full-w="true"
        :settings="true"
        :inactiveLabel="true"
        :description="$t('settings.display.auto_brightness_description')"
      /> -->
      <UCRange
        v-model="displayBrightnessValue"
        name="brightness"
        :definition="displayBrightnessSetting"
        :settings="true"
        @change="displayBrightnessChanged"
      />
      <!-- <UCToggle
        :settings="true"
        v-model="buttonBacklight"
        @change="buttonBacklightChanged"
        :label="$t('settings.display.button_backlight')"
        :full-w="true"
        :description="$t('settings.display.button_backlight_description')"
        :inactiveLabel="true"
      /> -->
      <UCRange
        v-model="buttonBrightnessValue"
        name="brightness"
        :definition="buttonBrightnessSetting"
        :settings="true"
        @change="buttonBrightnessChanged"
      />
      <SettingsOptionButton
        v-if="isModelSecond === false"
        :label="$t('settings.display.button_backlight_color.label')"
        :type="'button-backlight-color'"
      >
        <template #customFields>
          <button
            class="button button--secondary button--icon"
            @click="startResetButtonBacklightColor"
          >
            <i class="fa-light fa-arrow-rotate-left"></i>
          </button>
          <ColorPicker
            :rgb="buttonBacklightColor"
            @change="buttonBacklightColorChanged"
          />
        </template>
      </SettingsOptionButton>
    </div>
    <AppDialog
      ref="dialogResetBacklightColor"
      :title="$t('settings.display.button_backlight_color.dialog.title')"
      :text="$t('settings.display.button_backlight_color.dialog.question')"
      :submit-text="$t('ui.reset')"
      :cancel-text="$t('ui.cancel')"
      @submit="resetButtonBacklightColor"
    />
  </div>
</template>
