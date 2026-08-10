<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";

import type {
  IntegrationDriver,
  IntegrationDriverUpdate,
} from "@/types/integrationInstance";
import type { ErrorTexts } from "@/types/flashMessages";

import { integrationsStore } from "@/stores/integrations";

import { getErrorMessage } from "@/composables/error";

import UCInput from "@/components/ui/UCInput.vue";
import ModalSecondary from "@/components/elements/ModalSecondary.vue";
import ErrorBox from "@/components/ui/ErrorBox.vue";

const props = defineProps({
  driver: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(["close"]);

const store = integrationsStore();

const driverData = ref<IntegrationDriver>(props.driver as IntegrationDriver);
const showModal = ref(false);
const modalDriverSettings = useTemplateRef<InstanceType<typeof ModalSecondary>>(
  "modalDriverSettings",
);

const url = ref("");
const token = ref("");
const errorUpdate = ref<ErrorTexts | null>(null);

watch(props, () => {
  driverData.value = props.driver as IntegrationDriver;
});

watch(showModal, (val) => {
  if (val) {
    url.value = driverData.value.driver_url;
    errorUpdate.value = null;
  }
});

const tokenRequired = computed(() => {
  return driverData.value.pwd_protected || false;
});

const validForm = computed(() => {
  const tokenOk = tokenRequired.value
    ? token.value && token.value.trim().length > 0
    : true;
  return url.value.trim().length > 0 && tokenOk;
});

function closedModal() {
  showModal.value = false;
  url.value = "";
  token.value = "";
  emit("close");
}

async function saveConnection() {
  clearErrors();

  try {
    const modifications: IntegrationDriverUpdate = {
      driver_url: url.value,
      token: token.value || "",
    };

    driverData.value = await store.updateDriver(
      driverData.value.driver_id,
      modifications,
    );
    modalDriverSettings.value?.triggerClose();
  } catch (e) {
    errorUpdate.value = getErrorMessage(e, "integration.driver.update");
  }
}

function clearErrors() {
  errorUpdate.value = null;
}
</script>
<template>
  <button
    class="button button--secondary button--icon"
    @click="showModal = true"
  >
    <i class="fa-light fa-edit"></i>
  </button>

  <Teleport to="body">
    <ModalSecondary
      ref="modalDriverSettings"
      :show="showModal"
      :width="'24.25rem'"
      :button-close="false"
      :name="'driver-connection'"
      class="driver-connection-modal"
      @close="closedModal"
    >
      <template #header>
        {{ $t("integration.driver_connection.title") }}
      </template>
      <UCInput
        v-model="url"
        :full-w="true"
        :label="$t('integration.driver_connection.URL', 'URL')"
        @click="clearErrors"
      />
      <UCInput
        v-model="token"
        :full-w="true"
        :label="$t('integration.driver_connection.token')"
        :description="
          tokenRequired
            ? $t('integration.driver_connection.token_required')
            : ''
        "
        @click="clearErrors"
      />
      <ErrorBox v-if="errorUpdate" :message="errorUpdate" />
      <template #footer>
        <button
          class="button button--tertiary"
          @click="modalDriverSettings?.triggerClose()"
        >
          {{ $t("ui.cancel") }}
        </button>
        <button
          class="button button--secondary"
          :disabled="!validForm"
          @click="saveConnection"
        >
          {{ $t("ui.save") }}
        </button>
      </template>
    </ModalSecondary>
  </Teleport>
</template>
