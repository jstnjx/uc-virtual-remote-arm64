<script setup lang="ts">
import { ref, watch, onMounted } from "vue";

import type { Page } from "@/types/page";
import type { ProfileStore } from "@/stores/profile";
import type { BatteryStatus } from "@/types/systemBase";

import { profileStore } from "@/stores/profile";
import { systemBaseStore } from "@/stores/systemBase";
import { addErrorBottom } from "@/stores/messages";

import DeviceTime from "@/components/elements/DeviceTime.vue";

const props = defineProps({
  activeProfile: {
    type: Object,
    required: true,
  },
  page: {
    type: Object,
    default: null,
  },
  fullWidth: {
    type: Boolean,
    required: false,
  },
});

const storage = profileStore();
const systemBaseStorage = systemBaseStore();
const pages = ref<Page[]>([]);
const batteryStatus = ref<BatteryStatus | null>(null);

watch(props, async (_val) => {
  getProfile();
});

watch(
  () => systemBaseStorage.batteryStatus,
  (status) => {
    if (status) {
      batteryStatus.value = status;
    }
  },
);

async function getProfile() {
  if (props.activeProfile) {
    try {
      setProfile(storage);
    } catch (e) {
      console.error(e);
    }
  }
}

function setProfile(store: ProfileStore) {
  pages.value = store.$state.pages;
}

onMounted(async () => {
  try {
    const bStatus = await systemBaseStorage.getBatteryStatus();
    if (bStatus && bStatus != null) {
      batteryStatus.value = bStatus;
    }
  } catch (e) {
    addErrorBottom(e);
  }
});
</script>
<template>
  <div class="remote-nav" :class="{ 'remote-nav--full-width': fullWidth }">
    <Transition name="opacity-fast">
      <span
        v-if="page && page != null && page.name"
        v-show="fullWidth"
        class="remote-nav__page-name"
        >{{ page.name }}</span
      >
    </Transition>
    <div class="remote-nav__info">
      <Transition name="opacity-fast">
        <span
          v-if="batteryStatus != null"
          v-show="!fullWidth"
          class="remote-nav__battery"
          :style="`width:${batteryStatus.capacity}%;`"
        ></span>
      </Transition>
      <div class="remote-nav__clock">
        <DeviceTime />
      </div>
      <div class="remote-nav__profile">
        <template v-if="activeProfile.name">{{
          activeProfile.name.charAt(0).toUpperCase()
        }}</template>
      </div>
    </div>
  </div>
</template>
