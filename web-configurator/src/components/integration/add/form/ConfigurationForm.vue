<script setup lang="ts">
import { ref, watch, onMounted, getCurrentInstance, nextTick } from "vue";

import type { DriverSetting } from "@/types/integrationInstance";

import { setupFieldType } from "@/composables/setupFieldType";

const props = defineProps({
  settings: {
    type: Array,
    required: true,
  },
  errors: {
    type: Object,
    default: () => ({}),
  },
  className: {
    type: [String, Array, Object],
    default: "",
  },
  idPrefix: {
    type: String,
    required: true,
  },
});
const emit = defineEmits(["change"]);

const instanceId =
  getCurrentInstance()?.uid ||
  Math.floor(Math.random() * (99999 - 10000 + 1)) + 10000; // with fallback
const settings = ref<DriverSetting[]>(props.settings as DriverSetting[]);
const fieldErrors = ref<any>({});

watch(props, () => {
  fieldErrors.value = props.errors;
});

onMounted(() => {
  fieldErrors.value = props.errors;
  nextTick(() => {
    const elForm = document.querySelector(`#configuration-form-${instanceId}`);
    if (elForm) {
      const firstInput = elForm.querySelector("input, textarea") as HTMLElement;

      if (
        firstInput instanceof HTMLTextAreaElement ||
        (firstInput instanceof HTMLInputElement &&
          (firstInput.type === "text" || firstInput.type === ""))
      ) {
        firstInput.focus();
      }
    }
  });
});

function onValueChange(id: string, value: any) {
  fieldErrors.value = {};
  emit("change", id, value);
}

function getFieldError(fieldId: string) {
  if (fieldId && fieldErrors.value[fieldId] !== undefined) {
    return fieldErrors.value[fieldId] || "";
  }

  return "";
}
</script>
<template>
  <div
    :id="`configuration-form-${instanceId}`"
    v-overflow-indicator
    :class="className"
  >
    <template
      v-for="(setting, index) in settings"
      :key="index + '--' + setting.id"
    >
      <component
        :is="setupFieldType(setting)"
        :id="setting.id"
        :field-id="idPrefix + '__' + setting.id"
        :label="setting.label"
        :field="setting.field"
        :error="getFieldError(setting.id)"
        @change="onValueChange"
      />
    </template>
  </div>
</template>
