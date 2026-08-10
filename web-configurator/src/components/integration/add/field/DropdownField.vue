<script setup lang="ts">
import { ref, computed, onMounted } from "vue";

interface SelectOption {
  label: string;
  value: string;
}

import type { SettingTypeDropdown } from "@/types/integrationInstance";
import type { LanguageText } from "@/types/config";

import translatedProperty from "@/composables/translatedProperty";

import UCSelect from "@/components/ui/UCSelect.vue";

const props = defineProps({
  id: {
    type: String,
    required: true,
  },
  fieldId: {
    type: String,
    required: true,
  },
  label: {
    type: Object,
    required: true,
  },
  field: {
    type: Object,
    required: true,
  },
  error: {
    type: String,
  },
});
const emit = defineEmits(["change"]);

const field = ref(props.field as SettingTypeDropdown);
const label = ref(props.label as LanguageText);
const value = ref<SelectOption>({ label: "", value: "" });

const dropdownItems = computed(() => {
  return field.value.dropdown.items.map((option: any) => {
    return { label: translatedProperty(option.label), value: option.id };
  });
});

function getDefaultValue() {
  if (!dropdownItems.value) {
    return { label: "", value: "" };
  }

  const defaultVal = dropdownItems.value.find((option: any) => {
    return option.value === field.value.dropdown.value;
  });

  if (!defaultVal) {
    return { label: "", value: "" };
  }

  emitChange(defaultVal);
  return defaultVal;
}

function emitChange(selectedItem: SelectOption) {
  if (selectedItem) {
    value.value = selectedItem;
    emit("change", props.id, value.value?.value);
  }
}

onMounted(() => {
  value.value = getDefaultValue();
});
</script>
<template>
  <div class="add-integration__field add-integration__field--dropdown">
    <div class="select-extra">
      <div class="select-extra__text">
        <span class="select-extra__label">
          {{ translatedProperty(label) }}
        </span>
      </div>
      <UCSelect
        v-model="value"
        :options="dropdownItems"
        :light="true"
        :dynamic-width="true"
        :dynamic-position="true"
        :position="'right'"
        @select="emitChange"
      />
    </div>
    <p v-if="error" class="add-integration__field--dropdown__error">
      {{ error }}
    </p>
  </div>
</template>
