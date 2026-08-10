<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from "vue";

import type { CfgAll } from "@/types/config";
import { LoginState } from "@/types/enums";

import { authStorage } from "@/stores/auth";
import { configStore } from "@/stores/config";
import { addErrorBottom } from "@/stores/messages";

const auth = authStorage();
const config = configStore();
const cfg = ref<CfgAll | null>(null);
const time_format_24h = computed(
  () => config.config?.localization?.time_format_24h ?? true,
);
const time_zone = computed(
  () => config.config?.localization?.time_zone ?? "UTC",
);

const currentTime = ref("");

watch(
  () => auth.authenticated,
  async (authenticated) => {
    if (authenticated == LoginState.AUTHORISED && cfg.value == null) {
      await getConfigData();
    }
  },
);

function getTime() {
  if (cfg.value == null) {
    return;
  }

  currentTime.value = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: !time_format_24h.value,
    timeZone: time_zone.value,
  });
}

async function getConfigData() {
  try {
    cfg.value = await config.getAll();
  } catch (e) {
    addErrorBottom(e);
  }
}

let timer: number;
onMounted(async () => {
  if (auth.authenticated == LoginState.AUTHORISED) {
    await getConfigData();
  }

  timer = <any>setInterval(getTime, 1000);
});

onUnmounted(() => {
  clearInterval(timer);
});
</script>
<template>
  <div v-if="currentTime" class="time">{{ currentTime }}</div>
</template>
