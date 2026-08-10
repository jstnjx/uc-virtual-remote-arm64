<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import type { DockConfiguration } from "@/types/dock";
import { DockState } from "@/types/enums";

import AppDialog from "@/components/elements/AppDialog.vue";
import DockIllustration from "@/components/dock/DockIllustration.vue";

const router = useRouter();

const props = defineProps({
  dock: {
    type: Object,
    required: true,
  },
  availableFirmware: {
    type: String,
    default: "",
  },
});
const emit = defineEmits(["goto", "delete"]);

const dialogDelete =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDelete");

const isActive = computed(() => {
  return (props.dock as DockConfiguration).state == DockState.ACTIVE;
});

function goto() {
  router.push({
    name: "dock",
    params: { dock_id: props.dock.dock_id },
    query: { category: "dock" },
  });
}

function startDelete() {
  dialogDelete.value?.open();
}

function deleteItem() {
  emit("delete", props.dock);
}
</script>
<template>
  <div
    class="ent-item"
    :class="{ 'ent-item--inactive': !isActive }"
    @click="goto"
  >
    <div class="ent-item__background">
      <DockIllustration v-if="dock" :dock="dock" />
    </div>
    <div class="ent-item__header"></div>
    <div class="ent-item__text">
      <h3 class="ent-item__title">{{ dock.name }}</h3>
    </div>
    <div class="ent-item__footer">
      <div class="ent-item__attributes">
        <span
          class="ent-item__attribute"
          :class="`ent-item__attribute--${isActive ? 'green' : 'red'}`"
          :title="
            dock.state
              ? $t(`dock.status.${dock.state}`)
              : $t(`dock.status.UNKNOWN`)
          "
        >
          <i
            class="fa-light"
            :class="isActive ? 'fa-circle-check' : 'fa-circle-xmark'"
          ></i>
        </span>
        <span
          v-if="availableFirmware && availableFirmware.length > 0"
          class="ent-item__attribute ent-item__attribute--text ent-item__attribute--text--available-firmware"
        >
          <i class="fa-light fa-cloud-arrow-down"></i>
          {{ $t("ui.version") }} {{ availableFirmware }}
        </span>
        <span
          v-else-if="dock.version"
          class="ent-item__attribute ent-item__attribute--text ent-item__attribute--text--version"
        >
          <i class="fa-light fa-circle-check"></i>
          {{ $t("ui.version") }} {{ dock.version }}
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
    ref="dialogDelete"
    :title="$t('dock.delete.title')"
    :text="$t('dock.delete.question')"
    :submit-text="$t('ui.delete')"
    :cancel-text="$t('ui.cancel')"
    @submit="deleteItem"
  />
</template>
