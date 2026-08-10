<script setup lang="ts">
import {
  computed,
  getCurrentInstance,
  onBeforeMount,
  onBeforeUpdate,
  ref,
  unref,
  useTemplateRef,
  watch,
} from "vue";
import { useTranslation } from "i18next-vue";
import ApiConnection from "@/api";

type ExtendedSupportedResource = SupportedResource & { id: string };

import VuePictureCropper from "vue-picture-cropper";
// Cropper stylesheets (were eagerly imported in main.ts); loaded here with the
// only component that uses the cropper.
// - cropperjs 1.0 (externalised from vue-picture-cropper 0.7): without it the
//   crop box is unstyled — the image renders full height and the source <img>
//   shows beneath the cropper canvas (image appears twice).
// - vue-picture-cropper 1.0 ships its own component styles separately; its
//   `.vpc-img { max-width/height: 100% }` rule constrains the image so cropperjs
//   sizes the container to the fitted image.
import "cropperjs/dist/cropper.css";
import "vue-picture-cropper/style.css";

// vue-picture-cropper 1.0 dropped the module-level `cropper` singleton; the
// Cropper instance is now read off the component via a template ref. Its type
// is `ShallowRef<CropperInstance | null>` but Vue auto-unwraps it on access,
// so `unref()` bridges the type back to the instance (works either way).
const cropperRef =
  useTemplateRef<InstanceType<typeof VuePictureCropper>>("cropperRef");

import { FlashMessageInfoStatus, ResourceUploadStates } from "@/types/enums";
import type { ResourceTypeOption, SupportedResource } from "@/types/resources";
import type { ErrorTexts } from "@/types/flashMessages";

import { useTiming } from "@/composables/timing";
import { useFileHelper } from "@/composables/fileHelper";
import { useModalToggle } from "@/composables/modal";
import { useWindowDimension } from "@/composables/windowDimension";
import { getErrorMessage } from "@/composables/error";

import {
  addInfoFull,
  addErrorBottom,
  addErrorFull,
  hideMessage,
} from "@/stores/messages";

import ErrorBox from "@/components/ui/ErrorBox.vue";

const props = defineProps({
  allowedTypes: {
    type: Array,
    default: () => [],
  },
  defaultType: {
    type: String,
    default: "Icon",
  },
  modalTitle: {
    type: String,
    default: "resource",
  },
});

const instanceUid =
  getCurrentInstance()?.uid || Math.floor(Math.random() * 1000);
const defaultFileType = "image/jpeg";

const { t } = useTranslation();
const { sleep } = useTiming();
const { isSmallScreen } = useWindowDimension();

const { niceBytes } = useFileHelper();

const type = ref<ResourceTypeOption | null>();
const supportedResourceOptions = ref<ExtendedSupportedResource[]>([]);
const files = ref<File[] | null>(null);
const fileInput = useTemplateRef<HTMLInputElement>("fileInput");
const typeOptions = ref<ResourceTypeOption[]>([]);
const uploadState = ref<ResourceUploadStates>(ResourceUploadStates.IDLE);
const dragging = ref(false);

const errorUpload = ref<ErrorTexts | null>(null);
const progressPercent = ref(0);

const loadedImage = ref<string>("");
const fileName = ref("");
const fileType = ref(defaultFileType);
const fileSize = ref("");
const naturalResolution = ref<{ width: number; height: number }>({
  width: 0,
  height: 0,
});
const boxStyleWidth = ref("100%");

const directUpload = ref(false);
const showCrop = ref(false);

useModalToggle(showCrop, { id: instanceUid });
const imageCrop = useTemplateRef<HTMLDivElement>("imageCrop");

const emit = defineEmits(["uploaded", "crop"]);

watch(uploadState, async (val) => {
  if (val == ResourceUploadStates.UPLOADING) {
    for (let index = 0; index < 60; index++) {
      progressPercent.value = index;
      await sleep(5);
    }
  }
});

watch(errorUpload, (val) => {
  if (val != null && Object.keys(val).length > 0) {
    uploadState.value = ResourceUploadStates.ERROR;
  }
});

watch(showCrop, async (val) => {
  if (val == false) {
    resetForm();
  }

  emit("crop", val);
});

watch(
  () => props.allowedTypes,
  () => {
    setFilterOptions();
  },
);

const mainClasses = computed(() => {
  let classList = "";
  classList +=
    uploadState.value == ResourceUploadStates.ERROR
      ? "resource-upload--error "
      : "";
  classList +=
    uploadState.value == ResourceUploadStates.UPLOADING
      ? "resource-upload--uploading "
      : "";
  classList += props.defaultType
    ? `resource-upload--type-${props.defaultType.toLowerCase()}`
    : "";
  return classList;
});

const imageSize = computed(() => {
  if (props.defaultType == "Icon") {
    return { width: 90, height: 90 };
  }
  if (props.defaultType == "TvChannelIcon") {
    return { width: 90, height: 90 };
  }
  if (props.defaultType == "BackgroundImage") {
    return { width: 480, height: 275 };
  }
  return { width: null, height: null };
});

const aspectRatio = computed(() => {
  if (imageSize.value.width && imageSize.value.height) {
    return imageSize.value.width / imageSize.value.height;
  }
  return 1 / 1;
});

async function selectFile(e: DragEvent | Event) {
  e.preventDefault();

  errorUpload.value = null;
  loadedImage.value = "";
  fileName.value = "";

  let fileList: FileList | null = null;

  if (e instanceof DragEvent && e.dataTransfer) {
    fileList = e.dataTransfer.files;
  } else if (e.target && (e.target as HTMLInputElement).files) {
    fileList = (e.target as HTMLInputElement).files;
  }

  if (!fileList || !fileList.length) return;

  const files = Array.from(fileList);

  if (files.length === 1) {
    const file = files[0];
    const valid = await checkImageProperties(file);
    fileName.value = file.name || "image";
    fileType.value = file.type || defaultFileType;
    fileSize.value = niceBytes(file.size);

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      loadedImage.value = reader.result as string;
      if (valid) {
        directUpload.value = true;
        showCrop.value = false;
        uploadFile([file]);
      } else {
        directUpload.value = false;
        startCropping();
      }
    };
  } else {
    for (const file of files) {
      const valid = await checkImageProperties(file);
      if (!valid) {
        const err = t("resource.invalid_dimensions", {
          width: imageSize.value.width,
          height: imageSize.value.height,
        });
        addErrorFull(err);
        return;
      }
    }
    uploadFile(files);
  }

  if (fileInput.value instanceof HTMLInputElement) {
    fileInput.value.value = "";
  }
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob: Blob | null) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Failed to convert canvas to blob."));
      }
    }, type);
  });
}

async function uploadFile(files: File[]) {
  try {
    addInfoFull(FlashMessageInfoStatus.SAVING);

    const result = await ApiConnection.resources.upload(
      (type.value as ResourceTypeOption)?.type,
      files,
    );

    addInfoFull(FlashMessageInfoStatus.SUCCESS);
    emit("uploaded", result.response);
  } catch (e) {
    hideMessage();
    addErrorFull(e, "resource.upload");
  }
}

async function submitCanvasFile() {
  const files: File[] = [];
  const cropper = unref(cropperRef.value?.cropper);
  if (!cropper) return;

  const croppedCanvas = cropper.getCroppedCanvas(
    imageSize.value.width && imageSize.value.height
      ? {
          width: imageSize.value.width,
          height: imageSize.value.height,
          imageSmoothingQuality: "high",
        }
      : { imageSmoothingQuality: "high" },
  );

  try {
    const blob = await canvasToBlob(croppedCanvas, fileType.value);
    const resizedFile = new File([blob], fileName.value, {
      type: fileType.value,
    });
    files.push(resizedFile);
  } catch (error) {
    console.error("Error processing canvas:", error);
  }

  errorUpload.value = null;
  try {
    uploadState.value = ResourceUploadStates.UPLOADING;
    addInfoFull(FlashMessageInfoStatus.SAVING);

    const result = await ApiConnection.resources.upload(
      (type.value as ResourceTypeOption)?.type,
      files,
    );
    uploadState.value = ResourceUploadStates.IDLE;
    addInfoFull(FlashMessageInfoStatus.SUCCESS);
    showCrop.value = false;
    emit("uploaded", result.response);
  } catch (e) {
    hideMessage();
    errorUpload.value = getErrorMessage(e, "resource.upload");
    uploadState.value = ResourceUploadStates.ERROR;
  }
}

function checkImageProperties(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const image = new Image();
      image.src = reader.result as string;
      image.onload = () => {
        const isValid =
          (props.defaultType === "Icon" ||
            props.defaultType === "TvChannelIcon" ||
            props.defaultType === "BackgroundImage") &&
          image.width === imageSize.value.width &&
          image.height === imageSize.value.height;
        resolve(isValid);
      };
      image.onerror = () => resolve(false);
    };
    reader.onerror = () => resolve(false);
  });
}

function startCropping() {
  showCrop.value = true;
}

function cropperReady() {
  const cropper = unref(cropperRef.value?.cropper);
  if (!cropper) return;
  naturalResolution.value.width = cropper.getImageData().naturalWidth;
  naturalResolution.value.height = cropper.getImageData().naturalHeight;
}

function acceptedFiles() {
  if (!type.value) {
    return "";
  }

  return (type.value?.file_formats || [])
    .map((type) => {
      return `.${type}`;
    })
    .join(",");
}

function setDefaultTypeValue() {
  let defaultTypeValue;
  if (props.defaultType) {
    defaultTypeValue = typeOptions.value.find((item) => {
      return item.type === props.defaultType;
    });
  }

  if (!defaultTypeValue) {
    defaultTypeValue = typeOptions.value[0];
  }
  type.value = defaultTypeValue;
}

function resetForm() {
  files.value = null;
  naturalResolution.value = { width: 0, height: 0 };
  uploadState.value = ResourceUploadStates.IDLE;
}

function closeError() {
  errorUpload.value = null;
  resetForm();
}

function setFilterOptions() {
  const filterOptions =
    props.allowedTypes &&
    Array.isArray(props.allowedTypes) &&
    props.allowedTypes.length;
  typeOptions.value = supportedResourceOptions.value.filter((item) => {
    if (!filterOptions) {
      return true;
    }
    return props.allowedTypes.includes(item.type);
  });
  setDefaultTypeValue();
}

onBeforeMount(async () => {
  let items: SupportedResource[] = [];
  try {
    items = await ApiConnection.resources.getSupportedResources();
  } catch (e) {
    addErrorBottom(e);
  }
  supportedResourceOptions.value = items.map((item) => {
    return {
      id: item.type,
      ...item,
    };
  });

  setFilterOptions();
});

onBeforeUpdate(() => {
  setDefaultTypeValue();
});
</script>
<template>
  <div class="resource-upload" :class="mainClasses">
    <label
      :for="`file-${instanceUid}`"
      :class="{ 'resource-upload__drop-area--dragging': dragging }"
      class="resource-upload__drop-area"
      @drop="selectFile"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @dragenter.prevent
    >
      <i class="fa-light fa-upload"></i>
      <label :for="`file-${instanceUid}`" class="">
        <template v-if="isSmallScreen">{{ $t("resource.tap_to") }}</template>
        <template v-else>{{ $t("resource.drag_image") }}</template>
      </label>
    </label>
    <span class="resource-upload__footer">
      <template v-if="uploadState == ResourceUploadStates.UPLOADING">{{
        $t("resource.uploading")
      }}</template>
      <template v-else-if="uploadState == ResourceUploadStates.ERROR">
        <span v-if="files"
          >{{ files[0].name
          }}<template v-if="files.length > 1"> ,..</template></span
        >
      </template>
      <template v-else>
        {{ $t("resource.or") }}
        <label :for="`file-${instanceUid}`" class="resource-upload__browse">{{
          $t("resource.browse")
        }}</label>
      </template>
    </span>
    <div class="resource-upload__progress">
      <span class="resource-upload__progress__item">
        <span
          class="resource-upload__progress__bar"
          :style="`width:${progressPercent}%`"
        ></span>
      </span>
    </div>
    <div class="resource-upload__error-message">
      <ErrorBox
        v-if="errorUpload"
        :message="errorUpload"
        :margin-bottom="true"
      />
      <button
        class="button button--secondary button--icon"
        @click.stop="closeError"
      >
        <i class="fa-light fa-close"></i>
      </button>
    </div>
    <input
      :id="`file-${instanceUid}`"
      ref="fileInput"
      type="file"
      :accept="acceptedFiles()"
      multiple
      @change="selectFile($event)"
    />

    <Teleport to="body">
      <div v-show="showCrop" ref="imageCrop" class="image-crop">
        <div class="image-crop__container">
          <div class="image-crop__header">
            {{ modalTitle }}
            <button
              :disabled="uploadState == ResourceUploadStates.UPLOADING"
              class="button button--secondary button--icon button--icon--medium button-close"
              @click="showCrop = false"
            >
              <i class="fa-regular fa-close"></i>
            </button>
          </div>
          <div class="image-crop__main">
            <div class="image-crop__body">
              <div class="image-crop__body__cropper">
                <VuePictureCropper
                  v-if="showCrop"
                  ref="cropperRef"
                  :box-style="{
                    width: boxStyleWidth,
                    margin: 'auto',
                  }"
                  :img="loadedImage"
                  :options="{
                    dragMode: 'crop',
                    aspectRatio: aspectRatio,
                    ready: cropperReady,
                  }"
                />
              </div>
              <div class="image-crop__body__metas">
                <span class="image-crop__body__file-name">
                  {{ fileName }}
                </span>
                <span class="image-crop__body__file-data">
                  <span
                    v-if="
                      naturalResolution.width > 0 &&
                      naturalResolution.height > 0
                    "
                  >
                    {{ naturalResolution.width }} x
                    {{ naturalResolution.height }} px
                  </span>
                  <span v-if="fileSize">{{ fileSize }}</span>
                </span>
              </div>
            </div>
            <div class="image-crop__footer">
              <ErrorBox
                v-if="errorUpload"
                :message="errorUpload"
                :margin-bottom="true"
              />
              <div class="image-crop__footer__triggers">
                <button
                  :disabled="uploadState == ResourceUploadStates.UPLOADING"
                  class="button button--tertiary"
                  @click="showCrop = false"
                >
                  {{ $t("ui.cancel") }}
                </button>
                <button
                  :disabled="uploadState == ResourceUploadStates.UPLOADING"
                  class="button button--secondary"
                  @click="submitCanvasFile"
                >
                  {{ $t("ui.save") }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
