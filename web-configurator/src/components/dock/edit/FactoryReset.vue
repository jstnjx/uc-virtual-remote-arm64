<script setup lang="ts">
import { ref, useTemplateRef } from "vue";

import { FlashMessageInfoStatus } from "@/types/enums";
import type { DockConfiguration } from "@/types/dock";

import { docksStore } from "@/stores/docks";
import { addInfoFull, addErrorBottom } from "@/stores/messages";

import AppDialog from "@/components/elements/AppDialog.vue";

const props = defineProps({
  dock: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(["done"]);

const storage = docksStore();
const dock = ref<DockConfiguration>(props.dock as DockConfiguration);

const dialogFactoryReset =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogFactoryReset");

async function confirmReset() {
  addInfoFull(FlashMessageInfoStatus.SAVING);
  try {
    await storage.factoryReset(dock.value.dock_id);
    addInfoFull(FlashMessageInfoStatus.SUCCESS);
    emit("done");
  } catch (e) {
    addErrorBottom(e);
  }
}
</script>
<template>
  <button class="button button--danger" @click="dialogFactoryReset?.open()">
    {{ $t("ui.factory_reset") }}
  </button>

  <AppDialog
    ref="dialogFactoryReset"
    icon="fa-thin fa-warning"
    :title="$t('dock.factory_reset.title')"
    :text="$t('dock.factory_reset.description')"
    :submit-text="$t('ui.confirm')"
    :cancel-text="$t('ui.cancel')"
    :warning="true"
    :text-center="true"
    @submit="confirmReset"
  />
</template>
