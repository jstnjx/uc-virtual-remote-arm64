<script setup lang="ts">
import { ref, useTemplateRef } from "vue";
import type { PropType } from "vue";

import type { ExternalSystem } from "@/types/externalToken";

import translatedProperty from "@/composables/translatedProperty";

import AppDialog from "@/components/elements/AppDialog.vue";
import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";

defineProps({
  credentials: {
    type: Array as PropType<ExternalSystem[]>,
    default: () => [],
  },
});

const emit = defineEmits(["delete"]);

const dialogDelete =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDelete");
const itemIdToDelete = ref("");

function startDelete(item: ExternalSystem) {
  itemIdToDelete.value = item.system;
  dialogDelete.value?.open();
}

function deleteCredential() {
  if (itemIdToDelete.value.length < 1) return;
  emit("delete", itemIdToDelete.value);
}
</script>
<template>
  <div class="list-application-credentials">
    <table v-if="credentials.length > 0" class="responsive-table">
      <thead>
        <tr>
          <th class="list-application-credentials__th--integration">
            {{ $t("application_credentials.list.integration") }}
          </th>
          <th class="list-application-credentials__th--name">
            {{ $t("application_credentials.list.name") }}
          </th>
          <th>{{ $t("application_credentials.list.client_id") }}</th>
          <th></th>
        </tr>
      </thead>

      <tbody>
        <tr v-for="c in credentials" :key="c.system">
          <td :data-label="$t('application_credentials.list.integration')">
            <div class="td-content">
              <div class="td-item">
                <SelectedIcon
                  class="list-application-credentials__item__icon"
                  :icon="c?.icon || 'uc:puzzle'"
                  :thin="true"
                />
              </div>
              <div class="td-item">
                {{ translatedProperty(c.intg_name) }}
              </div>
            </div>
          </td>
          <td :data-label="$t('application_credentials.list.name')">
            <div class="td-content">
              <div class="td-item">
                {{ c.name ?? "" }}
              </div>
            </div>
          </td>
          <td
            :data-label="$t('application_credentials.list.client_id')"
            class="td-client-id"
          >
            <div class="td-content">
              <div class="td-item" :title="c.token_id ?? ''">
                {{ c.token_id ?? "" }}
              </div>
            </div>
          </td>
          <td data-label="">
            <div class="td-content">
              <div class="td-item">
                <button
                  class="button button--icon button--icon"
                  @click.stop="startDelete(c)"
                >
                  <i class="fa-light fa-trash"></i>
                </button>
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <AppDialog
      ref="dialogDelete"
      :title="$t('application_credentials.dialog.delete.title')"
      :text="$t('application_credentials.dialog.delete.question')"
      :submit-text="$t('ui.delete')"
      :cancel-text="$t('ui.cancel')"
      @submit="deleteCredential"
    />
  </div>
</template>
