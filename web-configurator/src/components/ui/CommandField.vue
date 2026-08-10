<script setup lang="ts">
import { useTranslation } from "i18next-vue";

const { t } = useTranslation();

defineProps({
  entityType: {
    type: String,
    required: true,
  },
  id: {
    type: String,
    default: "",
  },
  name: {
    type: String,
    required: false,
  },
  entity: {
    type: String,
    default: "",
  },
  showCommandSelect: {
    type: Boolean,
    default: false,
  },
  label: {
    type: String,
    required: false,
  },
  extendedCommandSelect: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["openCommandSelect", "toggleCommandSelect"]);

function triggerOpenCommandSelect() {
  emit("openCommandSelect");
}

function triggerToggleCommandSelect() {
  emit("toggleCommandSelect");
}
</script>
<template>
  <div class="command-field">
    <div class="command-field__main">
      <label class="command-field__label">
        {{ label || t("button_mapping.command.title") }}
      </label>
      <div class="command-field__value">
        <template v-if="entityType === 'activity'">
          <span v-if="id" :title="name || id">
            {{ name || id }}
          </span>
          <span v-else>{{ $t("ui.none") }}</span>
          <span v-if="entity.length > 0" class="command-field__value__entity">
            {{ entity }}
          </span>
        </template>
        <template v-else-if="entityType === 'remote'">
          <span class="component--setting--command-selected">
            {{ id || $t("ui.none") }}
          </span>
        </template>
      </div>
    </div>
    <div class="command-field__actions">
      <button
        v-if="extendedCommandSelect"
        class="command-field__toggle button button--secondary button--icon"
        @click="triggerOpenCommandSelect"
      >
        <i class="fa-regular fa-edit"></i>
      </button>
      <button
        v-else
        :class="{ 'command-field__toggle--open': showCommandSelect == true }"
        class="command-field__toggle button button--secondary button--icon"
        @click="triggerToggleCommandSelect"
      >
        <i class="fa-regular fa-chevron-down"></i>
      </button>
    </div>
  </div>
</template>
