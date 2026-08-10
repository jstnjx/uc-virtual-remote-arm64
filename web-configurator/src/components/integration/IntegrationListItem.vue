<!--
  Modified by Justin Jäger for the Unfolded.Tools Remote Simulator.
  Modified build first published: 2026-08-03.
  Licensed as part of the modified Web Configurator under GNU GPL v3.0 only.
  See MODIFICATIONS.md for details.
-->
<script setup lang="ts">
import { computed, type PropType, useTemplateRef } from "vue";
import { useRouter } from "vue-router";

import type {
  IntegrationStatus,
  IntegrationUpdateStatus,
} from "@/types/integrationInstance";

import { IntegrationState, DriverType } from "@/types/enums";

import translatedProperty from "@/composables/translatedProperty";

import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";
import AppDialog from "@/components/elements/AppDialog.vue";

const router = useRouter();

const props = defineProps({
  integration: {
    type: Object,
    required: true,
  },
  update: {
    type: Object as PropType<IntegrationUpdateStatus | null>,
    default: null,
  },
});
const emit = defineEmits(["startNotConfigured", "delete"]);

const dialogDelete =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDelete");

const isActive = computed(() => {
  return (
    (props.integration as IntegrationStatus).state == IntegrationState.ACTIVE ||
    (props.integration as IntegrationStatus).state == IntegrationState.CONNECTED
  );
});

const showDeleteButton = computed(() => {
  const int = props.integration;
  return (
    (int.driver_type == DriverType.LOCAL &&
      (int.instance_count > 0 || typeof int.state != "undefined")) ||
    int.driver_type == DriverType.EXTERNAL ||
    int.driver_type == DriverType.CUSTOM
  );
});

function goto() {
  if (props.integration.integration_id) {
    router.push({
      name: "integration",
      params: { integration_id: props.integration.integration_id },
    });
    return;
  }

  emit("startNotConfigured", props.integration);
}

function startDelete() {
  dialogDelete.value?.open();
}

function deleteItem() {
  emit("delete", props.integration);
}
</script>
<template>
  <div class="ent-item" @click="goto">
    <div class="ent-item__header">
      <SelectedIcon :icon="integration.icon || 'uc:puzzle'" />
    </div>
    <div class="ent-item__text">
      <h3 class="ent-item__title">
        {{ translatedProperty(integration.name) }}
      </h3>
    </div>
    <div class="ent-item__footer">
      <div class="ent-item__attributes">
        <span
          v-if="integration.instance_count < 1"
          class="ent-item__attribute ent-item__attribute--green"
        >
          <i class="fa-light fa-circle-plus"></i>
        </span>
        <span
          v-else-if="integration.state"
          class="ent-item__attribute"
          :class="
            isActive ? 'ent-item__attribute--green' : 'ent-item__attribute--red'
          "
          :title="
            integration.state
              ? $t(`integration.status.${integration.state}`)
              : $t(`integration.status.NOT_CONFIGURED`)
          "
        >
          <i
            class="fa-light"
            :class="isActive ? 'fa-circle-check' : 'fa-circle-xmark'"
          ></i>
        </span>
        <span
          v-if="update?.available"
          class="ent-item__attribute ent-item__attribute--yellow"
          :title="
            update.available_version
              ? `Update ${update.available_version} available`
              : 'Integration update available'
          "
        >
          <i class="fa-regular fa-cloud-arrow-down"></i>
        </span>
        <span
          v-if="
            integration.driver_type === DriverType.CUSTOM ||
            integration.driver_type === DriverType.EXTERNAL
          "
          :title="
            integration.driver_type === DriverType.CUSTOM
              ? $t('integration.driver_type.custom')
              : $t('integration.driver_type.external')
          "
          class="ent-item__attribute ent-item__attribute--wide"
        >
          <i
            v-if="integration.driver_type === DriverType.CUSTOM"
            class="fa-light fa-user-group"
          ></i>
          <i v-else class="fa-light fa-server"></i>
        </span>
      </div>
      <div class="ent-item__options">
        <button
          v-if="showDeleteButton"
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
    :title="$t('integration.delete.title')"
    :text="$t('integration.delete.question')"
    :submit-text="$t('ui.delete')"
    :cancel-text="$t('ui.cancel')"
    @submit="deleteItem"
  />
</template>
