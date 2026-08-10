<script setup lang="ts">
import { ref, useTemplateRef } from "vue";
import type { ActivityGroup } from "@/types/activityGroup";

import translatedProperty from "@/composables/translatedProperty";

import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";
import AppDialog from "@/components/elements/AppDialog.vue";

const props = defineProps({
  activityGroup: {
    type: Object,
    required: true,
  },
});
const emit = defineEmits(["goto", "delete"]);

const activityGroup = ref<ActivityGroup>(props.activityGroup as ActivityGroup);

const dialogDeleteActivityGroup = useTemplateRef<
  InstanceType<typeof AppDialog>
>("dialogDeleteActivityGroup");

function goto() {
  emit("goto");
}

function startDelete() {
  dialogDeleteActivityGroup.value?.open();
}

function deleteItem() {
  emit("delete");
}
</script>
<template>
  <div class="ent-item" @click="goto">
    <div class="ent-item__header">
      <SelectedIcon :icon="activityGroup.icon || 'uc:layer-group'" />
    </div>
    <div class="ent-item__text">
      <h3 class="ent-item__title">
        {{ translatedProperty(activityGroup.name) }}
      </h3>
    </div>
    <div class="ent-item__footer">
      <div class="ent-item__attributes">
        <span class="ent-item__attribute ent-item__attribute--text">
          {{ activityGroup.activity_count || 0 }}
          <template
            v-if="
              !activityGroup.activity_count || activityGroup.activity_count < 2
            "
            >{{ $t("activity.activity") }}</template
          >
          <template v-else>{{ $t("activity.activities") }}</template>
        </span>
      </div>
      <div class="ent-item__options">
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
    ref="dialogDeleteActivityGroup"
    :title="$t('activity_group.delete.title')"
    :text="$t('activity_group.delete.question')"
    :submit-text="$t('ui.delete')"
    :cancel-text="$t('ui.cancel')"
    @submit="deleteItem"
  />
  <!-- {{ activityGroup }} -->
</template>
