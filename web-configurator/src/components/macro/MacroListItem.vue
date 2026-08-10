<script setup lang="ts">
import { useTemplateRef } from "vue";
import translatedProperty from "@/composables/translatedProperty";

import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";
import AppDialog from "@/components/elements/AppDialog.vue";

const props = defineProps({
  macro: {
    type: Object,
    required: true,
  },
});
const emit = defineEmits(["goto", "clone", "delete"]);

const dialogDeleteMacro =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDeleteMacro");

function goto() {
  emit("goto");
}

function clone() {
  emit("clone", props.macro);
}

function startDelete() {
  dialogDeleteMacro.value?.open();
}

function deleteItem() {
  emit("delete");
}
</script>
<template>
  <div class="ent-item" @click="goto">
    <div class="ent-item__header">
      <SelectedIcon :icon="macro.icon || 'uc:macro'" />
    </div>
    <div class="ent-item__text">
      <h3 class="ent-item__title">{{ translatedProperty(macro.name) }}</h3>
    </div>
    <div class="ent-item__footer">
      <div class="ent-item__attributes">
        <span class="ent-item__attribute">
          <i class="fa-light fa-list-ul"></i>
        </span>
      </div>
      <div class="ent-item__options">
        <button
          class="button button--secondary button--icon button--icon--medium"
          @click.stop="clone"
        >
          <i class="fa-light fa-clone"></i>
        </button>
        <button
          class="button button--delete button--icon button--icon--medium"
          @click.stop="startDelete"
        >
          <i class="fa-light fa-trash"></i>
        </button>
      </div>
    </div>
  </div>
  <AppDialog
    ref="dialogDeleteMacro"
    :title="$t('macro.delete.title')"
    :text="$t('macro.delete.question')"
    :submit-text="$t('ui.delete')"
    :cancel-text="$t('ui.cancel')"
    @submit="deleteItem"
  />
</template>
