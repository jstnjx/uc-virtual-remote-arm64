<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import { useTranslation } from "i18next-vue";

import { ImportIrCodeSetState, FlashMessageInfoStatus } from "@/types/enums";

import ApiConnection from "@/api";
import { getErrorMessage } from "@/composables/error";

import { addInfoFull, hideMessage } from "@/stores/messages";

import AppModal from "@/components/elements/AppModal.vue";
import UCInput from "@/components/ui/UCInput.vue";
import UCToggle from "@/components/ui/UCToggle.vue";

const props = defineProps({
  irDataset: {
    type: Object,
    required: true,
  },
});

const state = ref("UPLOAD");

const { t } = useTranslation();

const irApi = ApiConnection.ir;
const showModal = ref(false);

const delimiter = ref("");
const comment = ref("");
const overwrite = ref<boolean>(false);
const file = ref<File | null>(null);
const fileInput = useTemplateRef<HTMLInputElement>("fileInput");

const uploading = ref(false);

const messageSuccess = ref("");
const messageError = ref("");

const emit = defineEmits(["close", "reloadIrDataset"]);

defineExpose({
  open,
  closeModal,
});

const isUploadState = computed(() => {
  return state.value === ImportIrCodeSetState.UPLOAD;
});
const isErrorState = computed(() => {
  return state.value === ImportIrCodeSetState.ERROR;
});
const isSuccessState = computed(() => {
  return state.value === ImportIrCodeSetState.SUCCESS;
});

// Methods
function open() {
  state.value = ImportIrCodeSetState.UPLOAD;
  showModal.value = true;
}

function closeModal() {
  state.value = ImportIrCodeSetState.UPLOAD;
  resetUploadData();
  showModal.value = false;
  emit("close");
}

function goToUpload() {
  file.value = null;
  state.value = ImportIrCodeSetState.UPLOAD;
}

function resetUploadData() {
  file.value = null;
  delimiter.value = "";
  comment.value = "";
  overwrite.value = false;
  messageSuccess.value = "";
  messageError.value = "";
}

function getMessageSuccess(result: any) {
  if (
    !result.processed.toString() ||
    !result.added.toString() ||
    !result.updated.toString()
  ) {
    return "";
  }
  return `${result.processed} records have been processed: ${result.added} have been added and ${result.updated} records have been updated.`;
}

function handleFileUpload(ev: Event) {
  const inp = ev.target as HTMLInputElement;
  const files = inp.files as FileList;
  file.value = files[0] || null;
}

async function submitFile() {
  uploading.value = true;
  addInfoFull(FlashMessageInfoStatus.SAVING, t("ui.uploading"));
  try {
    const result = await irApi.uploadCustomCodeSet(
      props.irDataset.id as string,
      file.value as File,
      overwrite.value as boolean,
      comment.value as string,
      delimiter.value as string,
    );

    messageSuccess.value = getMessageSuccess(result);
    state.value = ImportIrCodeSetState.SUCCESS;
    emit("reloadIrDataset");
  } catch (e) {
    messageError.value = getErrorMessage(e, "remote.ir_code.import")?.message;
    state.value = ImportIrCodeSetState.ERROR;
  }
  hideMessage();
  uploading.value = false;
}
</script>
<template>
  <Teleport v-if="showModal" to="body">
    <AppModal
      :show="showModal"
      name="import-ir-code"
      class="modal--import-ir-code import-ir-code"
      :width="'32.5rem'"
      :class="{ 'import-ir-code--error': isErrorState }"
      @close="showModal = false"
    >
      <template #header>
        {{ $t("remote.ir_code.import.title") }}
        <span class="icon icon-close" @click="showModal = false"></span>
      </template>
      <div v-if="isUploadState" class="import-ir-code__state">
        <p class="import-ir-code__intro">
          {{ $t("remote.ir_code.import.description") }}
        </p>

        <div>
          <div class="form-item--file">
            <div class="form-item--file__icon">
              <i class="fa-thin fa-table"></i>
            </div>
            <label for="import-ir" class="form-item--file__label">
              <span class="form-item--file__label__main">
                {{ $t("ui.select_file_to_upload") }}
              </span>
              <span class="form-item--file__label__description">
                {{ $t("remote.ir_code.import.file_size") }}
              </span>
            </label>
            <span v-if="file" class="form-item--file__name">
              <span>{{ file.name }}</span>
            </span>

            <label for="import-ir" class="button button--secondary">
              {{ $t("ui.browse") }}
            </label>
            <input
              id="import-ir"
              ref="fileInput"
              type="file"
              :accept="'.csv'"
              @change="handleFileUpload($event)"
            />
          </div>

          <a
            href="https://support.unfoldedcircle.com/hc/en-us/article_attachments/14292536923420"
            target="_blank"
            class="button button--blank button--hybrid"
          >
            <i class="fa-light fa-file-arrow-down"></i>
            {{ $t("remote.ir_code.import.csv_template") }}
          </a>
        </div>
        <div class="import-ir-code__setting">
          <UCInput
            v-model="delimiter"
            :label="$t('remote.ir_code.import.delimiter_label')"
            :description="$t('remote.ir_code.import.delimiter_info')"
          />
        </div>
        <div class="import-ir-code__setting">
          <UCInput
            v-model="comment"
            :label="$t('remote.ir_code.import.comment_label')"
            :description="$t('remote.ir_code.import.comment_info')"
          />
        </div>

        <UCToggle
          v-model="overwrite"
          :label="$t('remote.ir_code.import.overwrite_label')"
          :description="$t('remote.ir_code.import.overwrite_description')"
          :full-w="true"
        />
      </div>
      <div
        v-else-if="isSuccessState"
        class="import-ir-code__state import-ir-code__state--success"
      >
        <p>
          <i class="fa-light fa-circle-check"></i>
          <span>{{ $t("remote.ir_code.import.state.success") }}</span>
        </p>
        <div class="import-ir-code__state__result">
          {{ messageSuccess }}
        </div>
      </div>
      <div
        v-else-if="isErrorState"
        class="import-ir-code__state import-ir-code__state--error"
      >
        <p>
          <i class="fa-light fa-warning"></i>
          <span>{{ $t("remote.ir_code.import.state.error") }}</span>
        </p>
        <div class="import-ir-code__state__result">
          {{ messageError }}
        </div>
      </div>

      <div
        v-if="isSuccessState || isErrorState"
        class="import-ir-code__actions"
      >
        <button
          v-if="isSuccessState"
          class="button button--secondary button--min-w"
          @click="closeModal"
        >
          {{ $t("remote.ir_code.import.done") }}
        </button>
        <button
          v-if="isErrorState"
          class="button button--secondary button--min-w"
          @click="goToUpload"
        >
          {{ $t("ui.try_again") }}
        </button>
      </div>
      <template v-if="!isSuccessState && !isErrorState" #footer>
        <button
          :disabled="!file || uploading"
          class="button button--primary button--min-w"
          @click="submitFile"
        >
          {{ $t("remote.ir_code.import.upload") }}
        </button>
      </template>
    </AppModal>
  </Teleport>
</template>
