<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";

import type { DockConfiguration, DockUpdateCheck } from "@/types/dock";

import { docksStore } from "@/stores/docks";
import { addErrorBottom } from "@/stores/messages";

import DockListItem from "@/components/dock/DockListItem.vue";

const storage = docksStore();
const { docks, dockUpdateList } = storeToRefs(storage);

const props = defineProps({
  searchText: {
    type: String,
    default: "",
  },
});

const loading = ref(false);

const dockList = computed(() => {
  const search = props.searchText.toLowerCase();
  return docks.value.filter((item: DockConfiguration) => {
    return (
      item.name?.toLowerCase().includes(search) ||
      item.dock_id.toLowerCase().includes(search) ||
      item.model?.toLowerCase().includes(search)
    );
  });
});

async function startDeleteDock(dock: DockConfiguration) {
  try {
    await storage.removeDock(dock.dock_id);
    await storage.getDockList(true);
  } catch (e) {
    addErrorBottom(e);
  }
}

function getAvailableFirmware(dockId: string) {
  let firmwareVersion = "";
  const newFirmware = dockUpdateList.value.find(
    (d: DockUpdateCheck) => d.dock_id == dockId,
  );
  if (newFirmware) {
    firmwareVersion = newFirmware.firmware_update?.version || "";
  }
  return firmwareVersion;
}

onMounted(async () => {
  loading.value = true;
  try {
    await storage.getDockList(true);
  } catch (e) {
    addErrorBottom(e);
  }

  try {
    await storage.getDockUpdateList();
  } catch (e) {
    console.error(e);
  }

  loading.value = false;
});
</script>
<template>
  <div class="dock-list">
    <div class="dock-list__body">
      <div class="ent-list">
        <div
          v-if="dockList && dockList.length > 0"
          v-overflow-indicator
          class="ent-list__body-wrapper"
        >
          <div class="ent-list__body">
            <DockListItem
              v-for="dock in dockList"
              :key="JSON.stringify(dock)"
              :dock="dock"
              :available-firmware="getAvailableFirmware(dock.dock_id)"
              @delete="startDeleteDock"
            />
          </div>
        </div>
        <p v-if="docks.length < 1 && !loading" class="ent-list__description">
          {{ $t("dock.no_docks") }}
        </p>
        <p
          v-else-if="dockList.length < 1 && !loading"
          class="ent-list__description"
        >
          {{ $t("ui.nothing_was_found") }}
        </p>
      </div>
    </div>
  </div>
</template>
