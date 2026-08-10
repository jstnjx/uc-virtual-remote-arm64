<!-- Entity command parameter `type: regex` -->
<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";
import { useTranslation } from "i18next-vue";
import { addErrorBottom } from "@/stores/messages";

import type { MediaItem } from "@/types/media";

import MediaBrowse from "@/components/ui/MediaBrowse.vue";

const { t } = useTranslation();

const props = defineProps({
  id: {
    type: String,
    required: true,
  },
  entityId: {
    type: String,
    required: true,
  },
  paramName: {
    type: String,
    required: true,
  },
  regex: {
    type: String,
    required: true,
  },
  value: {
    type: String,
    required: true,
  },
  editIcon: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});
const emit = defineEmits(["change"]);

const elMediaBrowse =
  useTemplateRef<InstanceType<typeof MediaBrowse>>("elMediaBrowse");
const testValue = ref(props.value ?? "");
const lastEmitted = ref(props.value);

watch(
  () => props.value,
  (v) => {
    testValue.value = v;
    lastEmitted.value = v;
  },
);

const regexPattern = computed(() => {
  try {
    return new RegExp(props.regex);
  } catch {
    return null;
  }
});

const invalidNewValue = computed(() => {
  if (!testValue.value) return false;
  if (!regexPattern.value) return false;

  return !regexPattern.value.test(testValue.value);
});

const isMediaId = computed(() => {
  return props.paramName === "media_id";
});

const mainClasses = computed(() => {
  let classList = "";

  classList += invalidNewValue.value ? `setup-item--regex--error ` : "";
  classList += isMediaId.value ? `setup-item--regex--browse-media ` : "";

  return classList;
});

function showMediaBrowse() {
  if (elMediaBrowse.value) {
    elMediaBrowse.value.open();
  }
}

function updateTextValue(event: Event) {
  const target = event.target;

  if (!(target instanceof HTMLInputElement)) return;

  const newValue = target.value;

  if (invalidNewValue.value) {
    addErrorBottom(t("error.INVALID_FORMAT"));
    return;
  }

  if (newValue === lastEmitted.value) return;

  emitChange(newValue);
}

function emitChange(newValue: string) {
  lastEmitted.value = newValue;

  emit("change", {
    paramValue: newValue,
    paramName: props.paramName,
  });
}

function selectMedia(item: MediaItem) {
  const message = [];

  if (item.media_id) {
    message.push({ paramValue: item.media_id, paramName: "media_id" });
    message.push({
      paramValue: item.media_type ?? "",
      paramName: "media_type",
    });
    emit("change", message);
  }
}
</script>
<template>
  <div class="setup-item setup-item--regex" :class="mainClasses">
    <div class="setup-item__body">
      <input
        :id="`input-${id}-${paramName}`"
        v-model="testValue"
        :aria-invalid="invalidNewValue"
        :disabled="disabled"
        type="text"
        @keyup.enter="updateTextValue"
        @blur="updateTextValue"
      />
    </div>
    <button
      v-if="isMediaId"
      class="button button--secondary button--icon setup-item__button-browse"
      @click="showMediaBrowse"
    >
      <i class="fa-light fa-photo-film"></i>
    </button>
    <MediaBrowse
      ref="elMediaBrowse"
      :entity-id="entityId"
      @select="selectMedia"
    />
  </div>
</template>
