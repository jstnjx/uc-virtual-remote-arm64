<!-- Entity command parameter `type: regex` -->
<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";
import { useTranslation } from "i18next-vue";

import type { MediaItem } from "@/types/media";

import { addErrorBottom } from "@/stores/messages";

import UCInput from "@/components/ui/UCInput.vue";
import MediaBrowse from "@/components/ui/MediaBrowse.vue";

const { t } = useTranslation();

const props = defineProps({
  entityId: {
    type: String,
    required: true,
  },
  paramName: {
    type: String,
    required: true,
  },
  label: {
    type: String,
    default: "",
  },
  value: {
    type: String,
    required: true,
  },
  regex: {
    type: String,
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["change", "setMedia"]);

const elMediaBrowse =
  useTemplateRef<InstanceType<typeof MediaBrowse>>("elMediaBrowse");
const value = ref(props.value);

watch(props, () => {
  value.value = props.value;
});

const invalidNewValue = computed(() => {
  const pattern = props.regex;

  if (!value.value) return false;
  if (!pattern) return false;

  return !new RegExp(pattern).test(value.value);
});

const isMediaId = computed(() => {
  return props.paramName === "media_id";
});

function showMediaBrowse() {
  if (elMediaBrowse.value) {
    elMediaBrowse.value.open();
  }
}

function doChange(value: unknown) {
  if (invalidNewValue.value === false) {
    emitChange(value);
  } else {
    addErrorBottom(t("error.INVALID_FORMAT"));
  }
}

function emitChange(value: any) {
  emit("change", value);
}

function selectMedia(item: MediaItem) {
  const message = [];

  if (item.media_id) {
    message.push({ paramValue: item.media_id, paramName: "media_id" });
    message.push({
      paramValue: item.media_type ?? "",
      paramName: "media_type",
    });
    emit("setMedia", message);
  }
}
</script>
<template>
  <div
    class="param-setup param-setup--regex"
    :class="{ 'param-setup--regex--browse-media': isMediaId }"
  >
    <UCInput
      v-if="value != null"
      v-model="value"
      :label="label"
      :full-w="true"
      :type="'text'"
      :invalid="invalidNewValue"
      :disabled="disabled"
      @submit="doChange"
    />
    <button
      v-if="isMediaId"
      class="button button--secondary button--icon param-setup__button-browse"
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
