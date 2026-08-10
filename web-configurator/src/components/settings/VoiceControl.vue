<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from "vue";

import { CfgGroups } from "@/types/enums";
import type {
  ChangeCallbackParams,
  VoiceAssistant,
  VoiceAssistantProfile,
} from "@/types/config";

import { useDataHelper } from "@/composables/dataHelper";

import { configStore } from "@/stores/config";
import { addErrorBottom } from "@/stores/messages";

import UCToggle from "@/components/ui/UCToggle.vue";
import SettingsOptionButton from "@/components/settings/SettingsOptionButton.vue";
import SelectVoiceAssistant from "@/components/elements/SelectVoiceAssistant.vue";
import SelectVoiceAssistantProfile from "@/components/elements/SelectVoiceAssistantProfile.vue";

const config = configStore();

const { isNonEmptyObject } = useDataHelper();

const microphone = ref(false);
// const voiceControl = ref(false);
// const activeSpeechResponse = ref(false);

const settingsSection = useTemplateRef<HTMLDivElement>("settingsSection");

watch(
  () => config.config?.voice?.microphone,
  (value) => {
    microphone.value = value ?? false;
  },
  { immediate: true },
);

const voiceAssistants = computed<VoiceAssistant[]>(
  () => config.list?.voiceAssistants ?? [],
);

const activeVoiceAssistant = computed<VoiceAssistant | null>(
  () => config.config?.voice?.voice_assistant?.active ?? null,
);

const activeVoiceAssistantProfileId = computed<string | null>(
  () => config.config?.voice?.voice_assistant?.profile_id ?? null,
);

const voiceAssistantProfiles = computed(() => {
  return activeVoiceAssistant.value?.profiles ?? [];
});

// async function voiceControlChanged() {
//   const params: ChangeCallbackParams = {
//     group: CfgGroups.voice_control,
//     name: "enabled",
//     value: voiceControl.value
//   }
//   onItemChange(params);
// }

async function microphoneChanged() {
  const params: ChangeCallbackParams = {
    group: CfgGroups.voice_control,
    name: "microphone",
    value: microphone.value,
  };
  onItemChange(params);
}

async function voiceAssistantChanged(item: VoiceAssistant | null) {
  const message = {
    entity_id: item != null ? item.entity_id : "",
    // speech_response: activeSpeechResponse.value
  };

  const params: ChangeCallbackParams = {
    group: CfgGroups.voice_control,
    name: "voice_assistant",
    value: message,
  };

  onItemChange(params);
}

async function voiceAssistantProfileChanged(
  item: VoiceAssistantProfile | null,
) {
  if (item != null) {
    const message = {
      profile_id: item.id,
      entity_id: activeVoiceAssistant.value?.entity_id || "",
      // speech_response: activeSpeechResponse.value
    };

    const params: ChangeCallbackParams = {
      group: CfgGroups.voice_control,
      name: "voice_assistant",
      value: message,
    };

    onItemChange(params);
  } else {
    const message = {
      voice_assistant: {
        entity_id: activeVoiceAssistant.value?.entity_id || "",
        // speech_response: activeSpeechResponse.value
      },
    };

    try {
      await config.baseUpdate(CfgGroups.voice_control, message);
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

async function getVoiceAssistants() {
  try {
    await config.getVoiceAssistants(true);
  } catch (e) {
    addErrorBottom(e, null, settingsSection.value ?? undefined);
  }
}

onMounted(async () => {
  await getVoiceAssistants();
});
</script>
<template>
  <div ref="settingsSection" class="page-settings-section">
    <h1 class="page-settings-section__title">
      {{ $t("page.voice_control") }}
    </h1>
    <div class="page-settings-section__main">
      <UCToggle
        v-model="microphone"
        :label="$t('settings.voice_control.microphone')"
        :full-w="true"
        :settings="true"
        :description="$t('settings.voice_control.microphone_description')"
        @change="microphoneChanged"
      />
      <!-- Deleted from API /cfg/voice_control -->
      <!-- <UCToggle
        v-model="voiceControl"
        @change="voiceControlChanged"
        :label="$t('settings.voice_control.voice_control')"
        :full-w="true"
        :settings="true"
        :description="$t('settings.voice_control.voice_control_description')"
      /> -->
      <SettingsOptionButton
        v-if="microphone"
        :label="$t('settings.voice_control.voice_assistant.title')"
        :description="
          (!voiceAssistants || voiceAssistants.length < 1) &&
          (!activeVoiceAssistant || !isNonEmptyObject(activeVoiceAssistant))
            ? $t('settings.voice_control.voice_assistant.description.no_items')
            : $t('settings.voice_control.voice_assistant.description.base')
        "
        :type="'voice-assistant'"
      >
        <template #customFields>
          <SelectVoiceAssistant
            :value="activeVoiceAssistant"
            :options="voiceAssistants"
            @save="voiceAssistantChanged"
          />
        </template>
      </SettingsOptionButton>
      <a
        v-if="microphone"
        href="https://support.unfoldedcircle.com/hc/en-us/articles/24061019101596"
        target="_blank"
        class="voice-assistant-support-link"
      >
        <i class="fa-light fa-circle-info"></i>
        <span>{{
          $t("settings.voice_control.voice_assistant.support_link")
        }}</span>
      </a>
      <SettingsOptionButton
        v-if="
          microphone &&
          activeVoiceAssistant &&
          isNonEmptyObject(activeVoiceAssistant) &&
          voiceAssistants &&
          voiceAssistants.length > 0
        "
        :label="$t('settings.voice_control.voice_assistant.profile.title')"
        :type="'voice-assistant-profile'"
      >
        <template #customFields>
          <span
            v-if="!voiceAssistantProfiles || voiceAssistantProfiles.length < 1"
            >{{ $t("ui.none") }}</span
          >
          <SelectVoiceAssistantProfile
            v-else
            :active-id="activeVoiceAssistantProfileId ?? ''"
            :options="voiceAssistantProfiles"
            :preferred-profile-id="
              activeVoiceAssistant?.preferred_profile ?? ''
            "
            @save="voiceAssistantProfileChanged"
          />
        </template>
      </SettingsOptionButton>
    </div>
  </div>
</template>
