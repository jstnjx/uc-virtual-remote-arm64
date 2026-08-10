<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { addErrorBottom } from "@/stores/messages";

type SyncSettings = {
  enabled: boolean;
  integration: { image: string; version: string };
  primary: {
    node_name: string;
    agent_port: number;
    agent_public_url: string;
    virtual_dock_port: number;
    network_interface: string;
    network_mac: string;
    network_broadcasts: string[];
    physical_dock_default_token: string;
    physical_dock_tokens: Record<string, string>;
  };
  sync: {
    sections: string[];
    interval_seconds: number;
    auto_sync: boolean;
    prune: boolean;
    use_standby_inhibitor: boolean;
    verify_existing_resource_hashes: boolean;
  };
  hardware: {
    enforce_wifi_enabled: boolean;
    keep_wifi_connected_during_standby: boolean;
    disable_standby: boolean;
    simulator_battery_level: number;
    simulator_charging: boolean;
    simulator_wifi_state: string;
  };
};

type CatalogItem = {
  key: string;
  value: unknown;
  source: string;
  availability: string;
  default_web_configurator: boolean;
};

type SyncState = {
  settings: SyncSettings;
  enabled: boolean;
  applying: boolean;
  configured: boolean;
  credentials: {
    api_key_provisioned: boolean;
    api_key_id: string | null;
    agent_token_provisioned: boolean;
  };
  integration: null | {
    status: string;
    version?: string;
    enabled: boolean;
    configured: boolean;
    error?: string | null;
  };
  managed: null | { container?: string; image?: string; port?: number };
  job: null | { state?: string; progress?: number; message?: string };
  agent: { health: unknown; status: any; satellites: any[] };
  warnings: string[];
  catalog: Array<{ id: string; title: string; items: CatalogItem[] }>;
  updated_at?: string | null;
};

const BASE = String(
  (window as Window & { __UCVR_BASE_PATH__?: string }).__UCVR_BASE_PATH__ || "",
).replace(/\/$/, "");
const API = `${BASE}/api/cfg/sync_mode`;
const sectionOptions = [
  "resources",
  "entities",
  "activities",
  "activity_groups",
  "macros",
  "remotes",
  "profiles",
  "docks",
];

const state = ref<SyncState | null>(null);
const form = ref<SyncSettings | null>(null);
const loading = ref(true);
const busy = ref(false);
const filter = ref("");
const broadcasts = ref("");
const dockTokens = ref("");
let pollTimer: number | null = null;

const stateLabel = computed(() => {
  if (busy.value || state.value?.applying) return "Applying";
  if (!state.value?.enabled) return "Disabled";
  if (state.value.integration?.status === "CONNECTED") {
    return "Primary connected";
  }
  return (
    state.value.job?.message ||
    state.value.integration?.status ||
    "Enabled"
  );
});

const catalog = computed(() => {
  const query = filter.value.trim().toLowerCase();
  const groups = state.value?.catalog || [];
  if (!query) return groups;
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${item.key} ${item.value} ${item.source} ${item.availability}`
          .toLowerCase()
          .includes(query),
      ),
    }))
    .filter((group) => group.items.length);
});

async function api(options: RequestInit = {}) {
  const response = await fetch(API, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(
      payload?.message || payload?.error || text || `HTTP ${response.status}`,
    );
  }
  return payload as SyncState;
}

function accept(payload: SyncState, resetForm = true) {
  state.value = payload;
  if (!resetForm || !payload.settings) return;
  form.value = structuredClone(payload.settings);
  broadcasts.value = payload.settings.primary.network_broadcasts.join(", ");
  dockTokens.value = Object.entries(
    payload.settings.primary.physical_dock_tokens,
  )
    .map(([id, token]) => `${id}=${token}`)
    .join(", ");
}

async function refresh(resetForm = false) {
  try {
    accept(await api(), resetForm || !form.value);
  } catch (error) {
    addErrorBottom(error);
  } finally {
    loading.value = false;
  }
}

function settingsPayload(): SyncSettings | null {
  if (!form.value) return null;
  return {
    ...form.value,
    primary: {
      ...form.value.primary,
      network_broadcasts: broadcasts.value
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean),
      physical_dock_tokens: Object.fromEntries(
        dockTokens.value
          .split(/[\n,]+/)
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => {
            const separator = item.indexOf("=");
            return separator > 0
              ? [
                  item.slice(0, separator).trim(),
                  item.slice(separator + 1).trim(),
                ]
              : ["", ""];
          })
          .filter(([id, token]) => id && token),
      ),
    },
  };
}

async function command(action: string, includeSettings = false) {
  busy.value = true;
  try {
    const settings = includeSettings ? settingsPayload() : null;
    accept(
      await api({
        method: "PATCH",
        body: JSON.stringify({
          action,
          ...(settings ? { settings } : {}),
        }),
      }),
      false,
    );
    window.setTimeout(() => refresh(false), 500);
  } catch (error) {
    addErrorBottom(error);
  } finally {
    busy.value = false;
  }
}

function sectionEnabled(section: string) {
  return form.value?.sync.sections.includes(section) || false;
}

function setSection(section: string, event: Event) {
  if (!form.value) return;
  const enabled = Boolean((event.target as HTMLInputElement | null)?.checked);
  const sections = new Set(form.value.sync.sections);
  if (enabled) sections.add(section);
  else sections.delete(section);
  form.value.sync.sections = [...sections];
}

onMounted(async () => {
  await refresh(true);
  await command("refresh");
  pollTimer = window.setInterval(() => refresh(false), 2500);
});

onBeforeUnmount(() => {
  if (pollTimer !== null) window.clearInterval(pollTimer);
});
</script>

<template>
  <div class="page-settings-section sync-mode">
    <h1 class="page-settings-section__title">Sync Mode</h1>
    <div v-if="loading" class="sync-loading">Loading Sync Mode…</div>
    <div
      v-else-if="form && state"
      class="page-settings-section__main sync-content"
    >
      <section class="sync-card sync-hero">
        <div>
          <div class="sync-eyebrow">UC Remote Sync Primary</div>
          <h2>{{ stateLabel }}</h2>
          <p>
            Runs <strong>uc-remote-sync</strong> on this virtual Core and makes
            it the authoritative Primary for physical Satellite remotes.
          </p>
        </div>
        <div class="sync-actions">
          <button
            class="button button--primary"
            :disabled="busy"
            @click="command('apply', true)"
          >
            Save &amp; Apply
          </button>
          <button
            v-if="state.enabled"
            class="button"
            :disabled="busy"
            @click="command('disable')"
          >
            Disable
          </button>
          <button class="button" :disabled="busy" @click="command('refresh')">
            Refresh
          </button>
        </div>
      </section>

      <div v-if="state.warnings.length" class="sync-warning">
        <div v-for="warning in state.warnings" :key="warning">
          {{ warning }}
        </div>
      </div>

      <section class="sync-card">
        <h2>Primary service</h2>
        <div class="sync-grid">
          <label>
            <span>Primary name</span>
            <input v-model="form.primary.node_name" type="text" />
          </label>
          <label>
            <span>Container image</span>
            <input v-model="form.integration.image" type="text" />
          </label>
          <label>
            <span>Image tag</span>
            <input v-model="form.integration.version" type="text" />
          </label>
          <label>
            <span>Agent port</span>
            <input
              v-model.number="form.primary.agent_port"
              type="number"
              min="1"
              max="65535"
            />
          </label>
          <label>
            <span>Virtual Dock port</span>
            <input
              v-model.number="form.primary.virtual_dock_port"
              type="number"
              min="1"
              max="65535"
            />
          </label>
          <label>
            <span>Public agent URL override</span>
            <input
              v-model="form.primary.agent_public_url"
              type="text"
              placeholder="Automatic"
            />
          </label>
          <label>
            <span>Network interface override</span>
            <input
              v-model="form.primary.network_interface"
              type="text"
              placeholder="Automatic"
            />
          </label>
          <label>
            <span>MAC override</span>
            <input
              v-model="form.primary.network_mac"
              type="text"
              placeholder="Automatic"
            />
          </label>
          <label class="wide">
            <span>WoWLAN broadcast overrides</span>
            <input
              v-model="broadcasts"
              type="text"
              placeholder="192.168.1.255, 10.0.0.255"
            />
          </label>
          <label>
            <span>Default physical Dock token</span>
            <input
              v-model="form.primary.physical_dock_default_token"
              type="password"
            />
          </label>
          <label class="wide">
            <span>Per-Dock tokens</span>
            <input
              v-model="dockTokens"
              type="text"
              placeholder="DOCK_ID=token, OTHER_DOCK=token"
            />
          </label>
        </div>
        <div class="sync-meta">
          <span>
            Core API key:
            <strong>
              {{
                state.credentials.api_key_provisioned
                  ? "Provisioned"
                  : "Not provisioned"
              }}
            </strong>
          </span>
          <span>
            Integration:
            <strong>{{ state.integration?.status || "Not installed" }}</strong>
          </span>
          <span>
            Container:
            <strong>{{ state.managed?.container || "Not installed" }}</strong>
          </span>
          <span>
            Agent:
            <strong>
              {{
                state.agent.status?.state ||
                (state.agent.health ? "Healthy" : "Unavailable")
              }}
            </strong>
          </span>
        </div>
        <div class="sync-actions left">
          <button class="button" :disabled="busy" @click="command('rotate-key')">
            Rotate managed credentials
          </button>
          <button
            class="button"
            :disabled="busy || !state.enabled"
            @click="command('preview')"
          >
            Preview synchronization
          </button>
          <button
            class="button"
            :disabled="busy || !state.enabled"
            @click="command('sync')"
          >
            Synchronize now
          </button>
        </div>
      </section>

      <section class="sync-card">
        <h2>Synchronization policy</h2>
        <div class="sync-sections">
          <label v-for="section in sectionOptions" :key="section">
            <input
              type="checkbox"
              :checked="sectionEnabled(section)"
              @change="setSection(section, $event)"
            />
            <span>{{ section.replace(/_/g, " ") }}</span>
          </label>
        </div>
        <div class="sync-grid">
          <label>
            <span>Automatic interval (seconds)</span>
            <input
              v-model.number="form.sync.interval_seconds"
              type="number"
              min="300"
              max="86400"
            />
          </label>
          <label class="check">
            <input v-model="form.sync.auto_sync" type="checkbox" />
            <span>Automatic synchronization</span>
          </label>
          <label class="check">
            <input v-model="form.sync.prune" type="checkbox" />
            <span>Remove deleted objects</span>
          </label>
          <label class="check">
            <input
              v-model="form.sync.use_standby_inhibitor"
              type="checkbox"
            />
            <span>Use Satellite standby inhibitor</span>
          </label>
          <label class="check">
            <input
              v-model="form.sync.verify_existing_resource_hashes"
              type="checkbox"
            />
            <span>Verify existing resource hashes</span>
          </label>
        </div>
      </section>

      <section class="sync-card">
        <h2>Primary Remote requirements</h2>
        <div class="sync-grid">
          <label class="check">
            <input
              v-model="form.hardware.enforce_wifi_enabled"
              type="checkbox"
            />
            <span>Keep Wi-Fi enabled</span>
          </label>
          <label class="check">
            <input
              v-model="form.hardware.keep_wifi_connected_during_standby"
              type="checkbox"
            />
            <span>Keep Wi-Fi connected during standby</span>
          </label>
          <label class="check">
            <input
              v-model="form.hardware.disable_standby"
              type="checkbox"
            />
            <span>Disable Primary standby</span>
          </label>
          <label>
            <span>Virtual battery level</span>
            <input
              v-model.number="form.hardware.simulator_battery_level"
              type="number"
              min="0"
              max="100"
            />
          </label>
          <label class="check">
            <input
              v-model="form.hardware.simulator_charging"
              type="checkbox"
            />
            <span>Virtual Remote charging</span>
          </label>
          <label>
            <span>Virtual Wi-Fi state</span>
            <select v-model="form.hardware.simulator_wifi_state">
              <option>CONNECTED</option>
              <option>CONNECTING</option>
              <option>DISCONNECTED</option>
            </select>
          </label>
        </div>
      </section>

      <section class="sync-card">
        <h2>Satellite remotes</h2>
        <p v-if="!state.agent.satellites.length">
          No paired Satellites are currently reported by the Primary agent.
        </p>
        <div v-else class="satellites">
          <div
            v-for="satellite in state.agent.satellites"
            :key="satellite.peer_id || satellite.id"
            class="satellite"
          >
            <strong>
              {{ satellite.name || satellite.peer_id || satellite.id }}
            </strong>
            <span>{{ satellite.online === false ? "Offline" : "Online" }}</span>
            <span>
              {{ satellite.last_error || satellite.last_seen_at || "Ready" }}
            </span>
          </div>
        </div>
      </section>

      <section class="sync-card">
        <div class="catalog-title">
          <div>
            <h2>Remote configuration catalog</h2>
            <p>
              All Core configuration and native host hardware values. Settings
              missing from the stock Web Configurator are marked as API or
              physical-Remote only.
            </p>
          </div>
          <input
            v-model="filter"
            class="search"
            type="search"
            placeholder="Filter settings"
          />
        </div>
        <div v-for="group in catalog" :key="group.id" class="catalog">
          <h3>{{ group.title }}</h3>
          <div class="catalog-header">
            <span>Setting</span><span>Value</span><span>Availability</span>
          </div>
          <div v-for="item in group.items" :key="item.key" class="catalog-row">
            <code>{{ item.key }}</code>
            <span class="catalog-value">{{ item.value }}</span>
            <span
              :class="[
                'badge',
                { 'badge--api': !item.default_web_configurator },
              ]"
            >
              {{ item.availability }}
            </span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.sync-content {
  display: grid;
  gap: 20px;
}
.sync-loading {
  padding: 32px;
}
.sync-card {
  padding: 22px;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  border-radius: 16px;
  background: var(--color-background-elevated, rgba(255, 255, 255, 0.025));
}
.sync-card h2,
.sync-card h3 {
  margin: 0 0 10px;
}
.sync-card p {
  margin: 4px 0 0;
  line-height: 1.5;
  opacity: 0.78;
}
.sync-hero,
.catalog-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.sync-eyebrow {
  margin-bottom: 6px;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.65;
}
.sync-actions,
.sync-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.sync-actions {
  justify-content: flex-end;
}
.sync-actions.left {
  justify-content: flex-start;
  margin-top: 18px;
}
.sync-meta {
  gap: 10px 22px;
  margin-top: 18px;
  font-size: 13px;
}
.sync-warning {
  padding: 14px 16px;
  border: 1px solid rgba(255, 190, 50, 0.35);
  border-radius: 12px;
  background: rgba(255, 190, 50, 0.08);
}
.sync-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 18px;
  margin-top: 16px;
}
.sync-grid label {
  display: grid;
  gap: 7px;
  font-size: 13px;
}
.sync-grid input[type="text"],
.sync-grid input[type="password"],
.sync-grid input[type="number"],
.sync-grid select,
.search {
  width: 100%;
  min-height: 42px;
  padding: 8px 11px;
  color: inherit;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.15));
  border-radius: 9px;
  background: var(--color-background, rgba(0, 0, 0, 0.18));
}
.wide {
  grid-column: 1 / -1;
}
.check {
  display: flex !important;
  align-items: center;
  gap: 10px !important;
  min-height: 42px;
}
.check input,
.sync-sections input {
  width: 18px;
  height: 18px;
}
.sync-sections {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 16px;
}
.sync-sections label {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px;
  text-transform: capitalize;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  border-radius: 9px;
}
.satellites {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}
.satellite {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) auto minmax(180px, 1fr);
  gap: 14px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
}
.search {
  max-width: 260px;
}
.catalog {
  margin-top: 22px;
}
.catalog-header,
.catalog-row {
  display: grid;
  grid-template-columns: minmax(220px, 1.3fr) minmax(160px, 1fr) minmax(180px, 0.8fr);
  gap: 14px;
  align-items: center;
}
.catalog-header {
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 600;
  opacity: 0.65;
}
.catalog-row {
  padding: 10px;
  border-top: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
}
.catalog-row code,
.catalog-value {
  overflow-wrap: anywhere;
}
.catalog-value {
  opacity: 0.8;
}
.badge {
  justify-self: start;
  padding: 4px 8px;
  font-size: 11px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
}
.badge--api {
  color: #ffc76b;
  background: rgba(255, 185, 55, 0.14);
}
@media (max-width: 800px) {
  .sync-hero,
  .catalog-title {
    display: grid;
  }
  .sync-actions {
    justify-content: flex-start;
  }
  .sync-grid,
  .sync-sections {
    grid-template-columns: 1fr;
  }
  .wide {
    grid-column: auto;
  }
  .catalog-header {
    display: none;
  }
  .catalog-row,
  .satellite {
    grid-template-columns: 1fr;
  }
  .search {
    max-width: none;
  }
}
</style>
