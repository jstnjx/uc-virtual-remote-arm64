<script setup lang="ts">
import { ref, computed } from "vue";
import type { VoiceAssistantProfile } from "@/types/config";

import ModalSecondary from "@/components/elements/ModalSecondary.vue";
import InfoPopup from "@/components/ui/InfoPopup.vue";

const props = defineProps({
  activeId: {
    type: String,
    default: "",
  },
  options: {
    type: Array as () => VoiceAssistantProfile[] | [],
    default: () => [],
  },
  preferredProfileId: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["save"]);

const showModal = ref(false);

const activeProfile = computed<VoiceAssistantProfile | undefined>(() => {
  return props.options.find(
    (o) => (o as VoiceAssistantProfile).id === props.activeId,
  );
});

function getFeatureIcon(feature: string) {
  switch (feature) {
    case "transcription":
      return "fa-closed-captioning";
    case "response_text":
      return "fa-comment-dots";
    case "response_speech":
      return "fa-volume-high";
    default:
      return "fa-closed-captioning";
  }
}

function selectItem(item: VoiceAssistantProfile | null) {
  emit("save", item);
  closedModal();
}

function clearValue() {
  selectItem(null);
}

function closedModal() {
  showModal.value = false;
}
</script>
<template>
  <div class="select-voice-assistant">
    <div v-if="activeProfile" class="select-voice-assistant__active-item">
      <span>{{ activeProfile.name }}</span>
      <InfoPopup>
        <div
          class="voice-assistant-item voice-assistant-item--profile voice-assistant-item--inversed voice-assistant-item--static"
        >
          <span class="voice-assistant-item__main">
            {{ activeProfile.name }}
            <span
              v-if="activeProfile.id === preferredProfileId"
              class="voice-assistant-item__badge"
            >
              <i class="fa-light fa-star"></i>
            </span>
          </span>
          <div class="voice-assistant-item__features">
            <span
              v-for="feature in activeProfile.features"
              :key="feature"
              class="voice-assistant-item__badge"
            >
              <i class="fa-light" :class="getFeatureIcon(feature)"></i>
            </span>
            <span class="voice-assistant-item__badge">{{
              activeProfile.language
            }}</span>
          </div>
        </div>
      </InfoPopup>
      <button
        class="button button--blank button--icon button--icon--small button-close"
        @click="clearValue"
      >
        <i class="fa-regular fa-close"></i>
      </button>
    </div>
    <button
      v-else
      :disabled="options.length < 1"
      class="button button--tertiary button-open"
      @click="showModal = true"
    >
      {{ $t("ui.none") }}
    </button>
    <Teleport to="body">
      <ModalSecondary
        ref="modalEditPort"
        :show="showModal"
        :width="'32.5rem'"
        :name="'select-voice-assistant'"
        class="modal-select-voice-assistant"
        @close="closedModal"
      >
        <template #header>
          {{ $t("settings.voice_control.voice_assistant.profile.select") }}
        </template>
        <hr />

        <div class="modal-select-voice-assistant__list">
          <div
            v-for="item in options as VoiceAssistantProfile[]"
            :key="item.id"
            class="voice-assistant-item voice-assistant-item--profile"
            @click="selectItem(item)"
          >
            <span class="voice-assistant-item__main">
              {{ item.name }}
              <span
                v-if="item.id === preferredProfileId"
                class="voice-assistant-item__badge"
              >
                <i class="fa-light fa-star"></i>
              </span>
            </span>
            <div class="voice-assistant-item__features">
              <span
                v-for="feature in item.features"
                :key="feature"
                class="voice-assistant-item__badge"
              >
                <i class="fa-light" :class="getFeatureIcon(feature)"></i>
              </span>
              <span class="voice-assistant-item__badge">{{
                item.language
              }}</span>
            </div>
          </div>
        </div>
      </ModalSecondary>
    </Teleport>
  </div>
</template>
