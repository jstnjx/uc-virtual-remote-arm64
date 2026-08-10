<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";

import type { DockConfiguration } from "@/types/dock";

import { docksStore } from "@/stores/docks";
import { addErrorBottom } from "@/stores/messages";

import { useTiming } from "@/composables/timing";
import { isTouchEnabled } from "@/composables/device";
import { canChangeWifi, isDockActive } from "@/composables/dockValidation";

import UCInput from "@/components/ui/UCInput.vue";
import ModalSecondary from "@/components/elements/ModalSecondary.vue";

const { sleep } = useTiming();

const props = defineProps({
  dock: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(["close"]);

const modalWifiSettings =
  useTemplateRef<InstanceType<typeof ModalSecondary>>("modalWifiSettings");

const dockStorage = docksStore();

const dock = ref<DockConfiguration>(props.dock as DockConfiguration);
const showModal = ref(false);

const ssid = ref("");
const pass = ref("");

const isActive = computed(() => {
  return isDockActive(props.dock.state);
});

const validForSubmit = computed(() => {
  return canChangeWifi(props.dock.state, ssid.value, pass.value);
});

watch(showModal, async (val) => {
  if (val) {
    await sleep(100);
    const firstInput = document.querySelector(
      ".dock-wifi-settings-modal input",
    ) as HTMLElement | undefined;
    if (!isTouchEnabled() && firstInput) {
      firstInput?.focus();
    }
  }
});

function closedModal() {
  showModal.value = false;
  ssid.value = "";
  pass.value = "";
  emit("close");
}

async function saveWifi() {
  if (!validForSubmit.value) {
    return;
  }

  try {
    await dockStorage.changeWifi(dock.value.dock_id, ssid.value, pass.value);
    modalWifiSettings.value?.triggerClose();
  } catch (e) {
    addErrorBottom(e);
  }
}
</script>
<template>
  <button class="button button--tertiary" @click="showModal = true">
    {{ $t("dock.wifi_settings.trigger") }}
  </button>

  <Teleport to="body">
    <ModalSecondary
      ref="modalWifiSettings"
      :show="showModal"
      :width="'24.25rem'"
      :button-close="false"
      :name="'dock-wifi-settings'"
      class="dock-wifi-settings-modal"
      @close="closedModal"
    >
      <template #header>
        {{ $t("dock.wifi_settings.title") }}
      </template>
      <UCInput
        v-model="ssid"
        :full-w="true"
        :label="$t('dock.wifi_settings.SSID', 'SSID')"
      />
      <UCInput
        v-model="pass"
        :full-w="true"
        :label="$t('ui.password')"
        type="password"
      />
      <p
        v-if="!isActive"
        class="form-item__hint"
        style="
          margin-top: 0.5rem;
          color: var(--color-text-secondary);
          font-size: 0.875rem;
        "
      >
        {{ $t("dock.wifi_settings.disabled_hint") }}
      </p>
      <template #footer>
        <button
          class="button button--tertiary"
          @click="modalWifiSettings?.triggerClose()"
        >
          {{ $t("ui.cancel") }}
        </button>
        <button
          class="button button--secondary"
          :disabled="!validForSubmit"
          @click="saveWifi"
        >
          {{ $t("ui.save") }}
        </button>
      </template>
    </ModalSecondary>
  </Teleport>
</template>
