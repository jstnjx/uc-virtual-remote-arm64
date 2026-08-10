<script setup lang="ts">
import { computed } from "vue";

import { configStore } from "@/stores/config";

const config = configStore();
let name = "";
try {
  name = await config.getDeviceName();
} catch (e) {
  console.error(e);
}
const remoteName = computed(() => config.deviceMeta?.device_name || name || "");
const remoteIp = window.location.hostname;
</script>
<template>
  <h1 class="device-meta__name">{{ remoteName }}</h1>
  <div class="device-meta__host">{{ remoteIp }}</div>
</template>
