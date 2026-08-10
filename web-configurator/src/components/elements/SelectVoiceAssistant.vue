<script setup lang="ts">
import { ref } from "vue";

import type { VoiceAssistant } from "@/types/config";

import { useDataHelper } from "@/composables/dataHelper";
import translatedProperty from "@/composables/translatedProperty";

import ModalSecondary from "@/components/elements/ModalSecondary.vue";
import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";

const { isNonEmptyObject } = useDataHelper();

defineProps({
  value: {
    type: Object as () => VoiceAssistant | null,
    default: null,
  },
  options: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["save"]);

const showModal = ref(false);

function selectItem(item: VoiceAssistant | null) {
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
    <div
      v-if="value && value != null && isNonEmptyObject(value)"
      class="select-voice-assistant__active-item"
    >
      <span>{{ translatedProperty(value.name) }}</span>
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
        :width="'26.25rem'"
        :name="'select-voice-assistant'"
        class="modal-select-voice-assistant"
        @close="closedModal"
      >
        <template #header>
          {{ $t("settings.voice_control.voice_assistant.select") }}
        </template>
        <hr />

        <div class="modal-select-voice-assistant__list">
          <div
            v-for="item in options as VoiceAssistant[]"
            :key="item.entity_id"
            class="voice-assistant-item"
            @click="selectItem(item)"
          >
            <span class="voice-assistant-item__main">{{
              translatedProperty(item.name)
            }}</span>
            <div v-if="item.icon" class="voice-assistant-item__features">
              <SelectedIcon
                class="voice-assistant-item__icon"
                :icon="item?.icon || 'uc:microphone'"
                :thin="true"
              />
            </div>
          </div>
        </div>
      </ModalSecondary>
    </Teleport>
  </div>
</template>
