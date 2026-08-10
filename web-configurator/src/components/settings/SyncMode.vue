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
const broadcasts = ref("");
const dockTokens = ref("");
let pollTimer: number | null = null;

const stateLabel = computed(() => {
  if (busy.value || state.value?.applying) return "Applying changes…";
  if (!state.value?.enabled) return "Sync Mode is off";
  if (state.value.integration?.status === "CONNECTED") return "Ready";
  if (state.value.job?.message) return state.value.job.message;
  return state.value.integration?.status ? "Starting…" : "Enabled";
});

const stateDescription = computed(() => {
  if (!state.value?.enabled) return "Turn on Sync Mode to use this Virtual Remote as the Primary for your physical remotes.";
  if (state.value.integration?.status === "CONNECTED") return "This Virtual Remote is ready to keep paired physical remotes synchronized.";
  return state.value.integration?.error || "The synchronization service is starting. This page updates automatically.";
});

const intervalMinutes = computed({
  get: () => Math.max(5, Math.round(Number(form.value?.sync.interval_seconds || 900) / 60)),
  set: (value: number) => { if (form.value) form.value.sync.interval_seconds = Math.max(5, Number(value || 5)) * 60; },
});

const sectionLabels: Record<string, { label: string; description: string }> = {
  resources: { label: "Icons & images", description: "Custom icons, backgrounds and other resources" },
  entities: { label: "Devices & entities", description: "Configured devices and their entities" },
  activities: { label: "Activities", description: "Activities and their sequences" },
  activity_groups: { label: "Activity groups", description: "Activity groups and organization" },
  macros: { label: "Macros", description: "Reusable command sequences" },
  remotes: { label: "Remote layouts", description: "Remote button and screen configuration" },
  profiles: { label: "Profiles", description: "Profiles, pages and groups" },
  docks: { label: "Docks", description: "Dock configuration and assignments" },
};

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
    <div v-else-if="form && state" class="page-settings-section__main sync-content">
      <section class="sync-card sync-hero">
        <div><div class="sync-eyebrow">Remote synchronization</div><h2>{{ stateLabel }}</h2><p>{{ stateDescription }}</p></div>
        <div class="sync-actions">
<button v-if="!state.enabled" class="button button--primary" :disabled="busy" @click="command('apply', true)">Enable Sync Mode</button>
<template v-else><button class="button button--primary" :disabled="busy" @click="command('apply', true)">Save changes</button><button class="button" :disabled="busy" @click="command('sync')">Sync now</button><button class="button" :disabled="busy" @click="command('disable')">Turn off</button></template>
        </div>
      </section>
      <div v-if="state.warnings.length" class="sync-warning"><strong>Needs attention</strong><div v-for="warning in state.warnings" :key="warning">{{ warning }}</div></div>
      <div class="sync-status-grid"><div class="sync-status"><span>Primary</span><strong>{{ form.primary.node_name || "Virtual Remote" }}</strong></div><div class="sync-status"><span>Paired remotes</span><strong>{{ state.agent.satellites.length }}</strong></div><div class="sync-status"><span>Automatic sync</span><strong>{{ form.sync.auto_sync ? `Every ${intervalMinutes} min` : "Off" }}</strong></div></div>
      <section class="sync-card"><h2>Primary Remote</h2><p>This is the name physical remotes will see for this Primary.</p><label class="sync-field compact-field"><span>Name</span><input v-model="form.primary.node_name" type="text" /></label></section>
      <section class="sync-card"><div class="sync-section-heading"><div><h2>Automatic synchronization</h2><p>Keep paired remotes updated without having to press Sync now.</p></div><label class="sync-toggle"><input v-model="form.sync.auto_sync" type="checkbox" /><span>{{ form.sync.auto_sync ? "On" : "Off" }}</span></label></div><label v-if="form.sync.auto_sync" class="sync-field compact-field"><span>Sync every</span><div class="input-with-unit"><input v-model.number="intervalMinutes" type="number" min="5" max="1440" /><span>minutes</span></div></label><label class="sync-option-row"><input v-model="form.sync.prune" type="checkbox" /><span><strong>Mirror deletions</strong><small>Remove items from paired remotes when you delete them on the Primary.</small></span></label></section>
      <section class="sync-card"><h2>What gets synchronized</h2><p>Choose which parts of your Remote configuration are copied to paired remotes.</p><div class="sync-sections"><label v-for="section in sectionOptions" :key="section" class="sync-section-option"><input type="checkbox" :checked="sectionEnabled(section)" @change="setSection(section, $event)" /><span><strong>{{ sectionLabels[section]?.label || section }}</strong><small>{{ sectionLabels[section]?.description }}</small></span></label></div></section>
      <section class="sync-card"><h2>Satellite remotes</h2><p>Physical remotes paired with this Primary appear here.</p><div v-if="!state.agent.satellites.length" class="sync-empty">No remotes paired yet. Pair a Remote below to get started.</div><div v-else class="satellites"><div v-for="satellite in state.agent.satellites" :key="satellite.peer_id || satellite.id" class="satellite"><div><strong>{{ satellite.name || satellite.peer_id || satellite.id }}</strong><small>{{ satellite.peer_id || satellite.id }}</small></div><span>{{ satellite.online === false ? "Offline" : "Online" }}</span><span>{{ satellite.last_error || satellite.last_seen_at || "Ready" }}</span></div></div></section>
      <details class="sync-card sync-advanced"><summary><span><strong>Advanced settings</strong><small>Network, integration runtime, credentials and compatibility options</small></span><span>⌄</span></summary><div class="advanced-content">
        <section class="advanced-group"><h3>Integration runtime</h3><p>Normally you should leave these values unchanged.</p><div class="sync-grid"><label class="sync-field"><span>Container image</span><input v-model="form.integration.image" type="text" /></label><label class="sync-field"><span>Image version</span><input v-model="form.integration.version" type="text" /></label></div></section>
        <section class="advanced-group"><h3>Network & Dock access</h3><div class="sync-grid"><label class="sync-field"><span>Agent port</span><input v-model.number="form.primary.agent_port" type="number" min="1" max="65535" /></label><label class="sync-field"><span>Virtual Dock port</span><input v-model.number="form.primary.virtual_dock_port" type="number" min="1" max="65535" /></label><label class="sync-field"><span>Public agent URL override</span><input v-model="form.primary.agent_public_url" type="text" placeholder="Automatic" /></label><label class="sync-field"><span>Network interface override</span><input v-model="form.primary.network_interface" type="text" placeholder="Automatic" /></label><label class="sync-field"><span>MAC address override</span><input v-model="form.primary.network_mac" type="text" placeholder="Automatic" /></label><label class="sync-field"><span>Wake broadcast addresses</span><input v-model="broadcasts" type="text" placeholder="Automatic" /></label><label class="sync-field"><span>Default physical Dock token</span><input v-model="form.primary.physical_dock_default_token" type="password" /></label><label class="sync-field"><span>Per-Dock tokens</span><input v-model="dockTokens" type="text" placeholder="DOCK_ID=token" /></label></div></section>
        <section class="advanced-group"><h3>Compatibility</h3><div class="advanced-options"><label class="sync-option-row"><input v-model="form.sync.use_standby_inhibitor" type="checkbox" /><span><strong>Keep Satellites awake while syncing</strong><small>Prevents standby from interrupting a synchronization.</small></span></label><label class="sync-option-row"><input v-model="form.sync.verify_existing_resource_hashes" type="checkbox" /><span><strong>Verify existing resources</strong><small>Re-check existing icons and resources before reusing them.</small></span></label><label class="sync-option-row"><input v-model="form.hardware.enforce_wifi_enabled" type="checkbox" /><span><strong>Keep virtual Wi-Fi enabled</strong></span></label><label class="sync-option-row"><input v-model="form.hardware.keep_wifi_connected_during_standby" type="checkbox" /><span><strong>Keep Wi-Fi connected in standby</strong></span></label><label class="sync-option-row"><input v-model="form.hardware.disable_standby" type="checkbox" /><span><strong>Disable Primary standby</strong></span></label><label class="sync-option-row"><input v-model="form.hardware.simulator_charging" type="checkbox" /><span><strong>Virtual Remote is charging</strong></span></label></div><div class="sync-grid"><label class="sync-field"><span>Virtual battery level</span><input v-model.number="form.hardware.simulator_battery_level" type="number" min="0" max="100" /></label><label class="sync-field"><span>Virtual Wi-Fi state</span><select v-model="form.hardware.simulator_wifi_state"><option>CONNECTED</option><option>CONNECTING</option><option>DISCONNECTED</option></select></label></div></section>
        <section class="advanced-group"><h3>Service status</h3><div class="sync-meta"><span>Core access <strong>{{ state.credentials.api_key_provisioned ? "Ready" : "Not ready" }}</strong></span><span>Integration <strong>{{ state.integration?.status || "Not installed" }}</strong></span><span>Container <strong>{{ state.managed?.container || "Not installed" }}</strong></span><span>Agent <strong>{{ state.agent.status?.state || (state.agent.health ? "Healthy" : "Unavailable") }}</strong></span></div><div class="sync-actions left"><button class="button" :disabled="busy" @click="command('refresh')">Refresh status</button><button class="button" :disabled="busy" @click="command('rotate-key')">Reset managed credentials</button><button class="button" :disabled="busy || !state.enabled" @click="command('preview')">Preview next sync</button></div></section>
      </div></details>
    </div>
  </div>
</template>
<style scoped>
.sync-content{display:grid;gap:18px}.sync-loading{padding:32px}.sync-card{padding:22px;border:1px solid var(--color-border,rgba(255,255,255,.12));border-radius:14px;background:var(--color-background-elevated,rgba(255,255,255,.025))}.sync-card h2,.sync-card h3{margin:0 0 8px}.sync-card p{margin:3px 0 0;line-height:1.5;opacity:.72}.sync-hero,.sync-section-heading{display:flex;align-items:center;justify-content:space-between;gap:24px}.sync-eyebrow{margin-bottom:5px;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;opacity:.6}.sync-actions,.sync-meta{display:flex;flex-wrap:wrap;gap:10px}.sync-actions{justify-content:flex-end}.sync-actions.left{justify-content:flex-start;margin-top:16px}.sync-warning{display:grid;gap:5px;padding:14px 16px;border:1px solid rgba(255,190,50,.35);border-radius:12px;background:rgba(255,190,50,.08)}.sync-status-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.sync-status{display:grid;gap:4px;padding:15px 17px;border:1px solid var(--color-border,rgba(255,255,255,.1));border-radius:12px;background:rgba(255,255,255,.025)}.sync-status span{font-size:12px;opacity:.62}.sync-field{display:grid;gap:7px;font-size:13px}.compact-field{max-width:420px;margin-top:16px}.sync-field input[type=text],.sync-field input[type=password],.sync-field input[type=number],.sync-field select{width:100%;min-height:42px;padding:8px 11px;color:inherit;border:1px solid var(--color-border,rgba(255,255,255,.15));border-radius:9px;background:var(--color-background,rgba(0,0,0,.18))}.sync-toggle,.sync-option-row,.sync-section-option{display:flex;align-items:flex-start;gap:11px}.sync-toggle{align-items:center;font-weight:600}.sync-toggle input,.sync-option-row input,.sync-section-option input{width:18px;height:18px;flex:0 0 auto}.input-with-unit{display:flex;align-items:center;gap:9px}.input-with-unit input{max-width:120px}.sync-option-row{margin-top:16px}.sync-option-row>span,.sync-section-option>span{display:grid;gap:2px}.sync-option-row small,.sync-section-option small,.sync-advanced summary small,.satellite small{display:block;font-size:12px;line-height:1.4;opacity:.62}.sync-sections{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:16px}.sync-section-option{padding:13px;border:1px solid var(--color-border,rgba(255,255,255,.1));border-radius:10px}.sync-empty{margin-top:16px;padding:16px;border-radius:10px;background:rgba(255,255,255,.035);opacity:.72}.satellites{display:grid;gap:10px;margin-top:16px}.satellite{display:grid;grid-template-columns:minmax(180px,1fr) auto minmax(160px,.8fr);gap:14px;align-items:center;padding:13px;border-radius:10px;background:rgba(255,255,255,.04)}.satellite>div{display:grid;gap:2px}.sync-advanced{padding:0;overflow:hidden}.sync-advanced>summary{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:19px 22px;cursor:pointer;list-style:none}.sync-advanced>summary::-webkit-details-marker{display:none}.sync-advanced>summary>span:first-child{display:grid;gap:3px}.advanced-content{padding:0 22px 22px}.advanced-group{padding-top:20px;border-top:1px solid var(--color-border,rgba(255,255,255,.09))}.advanced-group+.advanced-group{margin-top:22px}.sync-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 18px;margin-top:16px}.advanced-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:20px}.sync-meta{gap:9px 20px;margin-top:14px;font-size:13px}.sync-meta span{display:grid;gap:2px}@media(max-width:800px){.sync-hero,.sync-section-heading{display:grid}.sync-actions{justify-content:flex-start}.sync-status-grid,.sync-sections,.sync-grid,.advanced-options{grid-template-columns:1fr}.satellite{grid-template-columns:1fr}}
</style>
