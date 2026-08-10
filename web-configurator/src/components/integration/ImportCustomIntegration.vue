<script setup lang="ts">
import { ref, useTemplateRef } from "vue";
import { useTranslation } from "i18next-vue";

import ApiConnection from "@/api";

import { FlashMessageInfoStatus } from "@/types/enums";
import type { ErrorTexts } from "@/types/flashMessages";

import { addInfoFull, hideMessage } from "@/stores/messages";
import { useTiming } from "@/composables/timing";
import { getErrorMessage } from "@/composables/error";

import ErrorBox from "@/components/ui/ErrorBox.vue";
import ModalSecondary from "@/components/elements/ModalSecondary.vue";

const integrationsApi = ApiConnection.integrations;

const { t } = useTranslation();
const { sleep } = useTiming();

const file = ref<File | null>(null);
const fileInput = useTemplateRef<HTMLInputElement>("fileInput");
const showModal = ref(false);
const uploading = ref(false);
const update_custom_intg = ref(false);
const errorUpload = ref<ErrorTexts | null>(null);
const modalImportCustom =
  useTemplateRef<InstanceType<typeof ModalSecondary>>("modalImportCustom");

defineExpose({
  open,
});

const emit = defineEmits(["imported"]);

function handleFileUpload(ev: Event) {
  errorUpload.value = null;
  const inp = ev.target as HTMLInputElement;
  const files = inp.files as FileList;
  file.value = files[0] || null;
}

async function submitFile() {
  uploading.value = true;
  addInfoFull(FlashMessageInfoStatus.SAVING, t("ui.uploading"));
  await sleep(2000);
  try {
    await integrationsApi.importCustomIntegration(
      file.value as File,
      update_custom_intg.value,
    );

    emit("imported");
    modalImportCustom.value?.triggerClose();
    addInfoFull(FlashMessageInfoStatus.SUCCESS);
  } catch (e) {
    errorUpload.value = getErrorMessage(e, "integration.install_custom");
    hideMessage();
  }
  uploading.value = false;
}

function open() {
  showModal.value = true;
}

function closedModal() {
  file.value = null;
  update_custom_intg.value = false;
  errorUpload.value = null;
  showModal.value = false;
}
</script>
<template>
  <Teleport to="body">
    <ModalSecondary
      ref="modalImportCustom"
      :show="showModal"
      :width="'24.25rem'"
      :height="'fit-content'"
      :button-close="false"
      :name="'modal-import-custom-integration'"
      :class="'import-custom-integration'"
      @close="closedModal"
    >
      <template #header>
        {{ $t("integration.install_custom.popup.title") }}
      </template>
      <div class="form-item--file">
        <label for="import-ir" class="form-item--file__label">
          <span class="form-item--file__label__main">
            {{ $t("integration.install_custom.popup.upload.label") }}
          </span>
          <span class="form-item--file__label__description">
            {{ $t("integration.install_custom.popup.upload.description") }}
          </span>
        </label>
        <span v-if="file" class="form-item--file__name">
          <span>{{ file.name }}</span>
        </span>

        <label for="import-integration" class="button button--secondary">
          {{ $t("ui.browse") }}
        </label>
        <input
          id="import-integration"
          ref="fileInput"
          type="file"
          :accept="'.tgz,.gz'"
          @change="handleFileUpload($event)"
        />
      </div>

      <div class="form-item form-item--checkbox-tick">
        <input
          id="update_custom_intg"
          v-model="update_custom_intg"
          type="checkbox"
        />
        <label class="toggle" for="update_custom_intg" />
        <label for="update_custom_intg">
          {{ $t("integration.install_custom.popup.update_installed") }}
        </label>
      </div>

      <ErrorBox v-if="errorUpload" :message="errorUpload" />

      <template #footer>
        <button
          class="button button--tertiary"
          @click="modalImportCustom?.triggerClose()"
        >
          {{ $t("ui.cancel") }}
        </button>
        <button
          class="button button--secondary"
          :disabled="file == null || uploading"
          @click="submitFile"
        >
          {{ $t("ui.upload") }}
        </button>
      </template>
    </ModalSecondary>
  </Teleport>
</template>
