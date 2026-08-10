<!--
  Modified by Justin Jäger for the Unfolded.Tools Remote Simulator.
  Modified build first published: 2026-08-03.
  Licensed as part of the modified Web Configurator under GNU GPL v3.0 only.
  See MODIFICATIONS.md for details.
-->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import type {
  InstalledIntegrationManagementItem,
  IntegrationDriver,
  IntegrationStatus,
  IntegrationUpdateStatus,
} from "@/types/integrationInstance";
import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";
import { searchLanguageText } from "@/composables/translatedProperty";
import IntegrationListItem from "@/components/integration/IntegrationListItem.vue";

const store = integrationsStore();
const {
  statuses,
  notConfiguredCustomDrivers,
  notConfiguredExternalDrivers,
} = storeToRefs(store);
const props = defineProps({ searchText: { type: String, default: "" } });
const emit = defineEmits(["startNotConfigured"]);
const loading = ref(false);
const integrationUpdates = ref<Record<string, IntegrationUpdateStatus | null>>({});
const managementBasePath = String(
  (window as Window & { __UCVR_BASE_PATH__?: string }).__UCVR_BASE_PATH__ || "",
).replace(/\/$/, "");

type IntegrationListEntry = IntegrationStatus &
  Partial<IntegrationDriver> & {
    instance_count?: number;
  };

defineExpose({ loadData });

const instanceList = computed<IntegrationListEntry[]>(() => {
  const configuredDriverIds = new Set(
    statuses.value.map((item) => item.driver_id).filter(Boolean),
  );
  const unconfigured = [
    ...notConfiguredCustomDrivers.value,
    ...notConfiguredExternalDrivers.value,
  ]
    .filter((driver) => !configuredDriverIds.has(driver.driver_id))
    .map(
      (driver) =>
        ({
          ...driver,
          integration_id: undefined,
          state: undefined,
          instance_count: 0,
        }) as IntegrationListEntry,
    );

  return [...(statuses.value as IntegrationListEntry[]), ...unconfigured];
});

const filteredInstanceList = computed<IntegrationListEntry[]>(() => {
  const search = props.searchText.toLowerCase();
  return instanceList.value.filter(
    (item) =>
      searchLanguageText(item.name, search) ||
      (item.integration_id || "").toLowerCase().includes(search) ||
      item.driver_id?.toLowerCase().includes(search),
  );
});

async function loadUpdateMetadata() {
  const response = await fetch(
    `${managementBasePath}/management/installed-integrations`,
    { credentials: "same-origin", cache: "no-store" },
  );
  if (response.status === 404) {
    integrationUpdates.value = {};
    return;
  }
  const payload = (await response.json().catch(() => ({}))) as {
    integrations?: InstalledIntegrationManagementItem[];
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(
      payload.error || payload.message || `Request returned HTTP ${response.status}`,
    );
  }
  integrationUpdates.value = Object.fromEntries(
    (payload.integrations || []).map((item) => [item.id, item.update || null]),
  );
}

async function loadData() {
  try {
    await Promise.all([
      store.getStatuses(true),
      store.getNotConfiguredCustomDrivers(true),
      store.getNotConfiguredExternalDrivers(true),
      loadUpdateMetadata(),
    ]);
  } catch (error) {
    addErrorBottom(error);
  }
}

async function deleteIntegration(integration: IntegrationListEntry) {
  try {
    // The existing Core service already implements the official two-stage
    // contract: an instance card deletes /instances/:id (reset), while the
    // resulting unconfigured driver card deletes /drivers/:id (uninstall).
    await store.deleteIntegration(integration as IntegrationStatus);
    await loadData();
  } catch (error) {
    addErrorBottom(error);
  }
}

onMounted(async () => {
  loading.value = true;
  await loadData();
  loading.value = false;
});
</script>
<template>
  <div class="integration-list">
    <div class="integration-list__body">
      <div class="ent-list">
        <div
          v-if="filteredInstanceList.length > 0"
          v-overflow-indicator
          class="ent-list__body-wrapper"
        >
          <div class="ent-list__body">
            <IntegrationListItem
              v-for="inst in filteredInstanceList"
              :key="inst.integration_id || `driver:${inst.driver_id}`"
              :integration="inst"
              :update="
                integrationUpdates[
                  inst.integration_id || inst.driver_id || ''
                ] || null
              "
              @start-not-configured="emit('startNotConfigured', $event)"
              @delete="deleteIntegration"
            />
          </div>
        </div>
        <p
          v-if="instanceList.length < 1 && !loading"
          class="ent-list__description"
        >
          {{ $t("integration.no_integrations") }}
        </p>
        <p
          v-else-if="filteredInstanceList.length < 1 && !loading"
          class="ent-list__description"
        >
          {{ $t("ui.nothing_was_found") }}
        </p>
      </div>
    </div>
  </div>
</template>
