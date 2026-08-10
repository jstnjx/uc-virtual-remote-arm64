<script setup lang="ts">
import { computed, useTemplateRef } from "vue";

import translatedProperty from "@/composables/translatedProperty";

import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";
import AppDialog from "@/components/elements/AppDialog.vue";

const props = defineProps({
  activity: {
    type: Object,
    required: true,
  },
});
const emit = defineEmits(["goto", "delete", "clone"]);

const dialogDelete =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDelete");

const activeItem = computed(() => {
  return (
    props.activity.attributes &&
    (props.activity.attributes?.state == "ON" ||
      props.activity.attributes?.state == "RUNNING")
  );
});

function goto() {
  emit("goto");
}

function clone() {
  emit("clone", props.activity);
}

function startDelete() {
  dialogDelete.value?.open();
}

function deleteItem() {
  emit("delete");
}
</script>
<template>
  <div class="ent-item" @click="goto">
    <div class="ent-item__header">
      <SelectedIcon :icon="activity.icon || 'uc:activity'" />
    </div>
    <div class="ent-item__text">
      <h3 class="ent-item__title">{{ translatedProperty(activity.name) }}</h3>
    </div>
    <div class="ent-item__footer">
      <div class="ent-item__attributes">
        <span
          class="ent-item__attribute"
          :class="{ 'ent-item__attribute--active': activeItem }"
        >
          <i class="fa-light fa-clapperboard"></i>
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
    ref="dialogDelete"
    :title="$t('activity.delete.title')"
    :text="$t('activity.delete.question')"
    :submit-text="$t('ui.delete')"
    :cancel-text="$t('ui.cancel')"
    @submit="deleteItem"
  />
  <!-- {{ activity }} -->
</template>
