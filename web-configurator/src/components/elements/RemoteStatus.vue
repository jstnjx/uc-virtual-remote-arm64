<script setup lang="ts">
import {
  ref,
  watch,
  computed,
  onMounted,
  onUnmounted,
  useTemplateRef,
} from "vue";
import { useTranslation } from "i18next-vue";
import { connectionMonitor } from "@/api/monitor";

import { BatteryStatusValue, LoginState } from "@/types/enums";
import type { BatteryStatus, StandbyInhibitor } from "@/types/systemBase";

import { authStorage } from "@/stores/auth";
import { systemBaseStore } from "@/stores/systemBase";
import { appStateStore } from "@/stores/appState";
import { addErrorBottom } from "@/stores/messages";

import CountdownCircle from "@/components/ui/CountdownCircle.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import UCSelect from "@/components/ui/UCSelect.vue";

import { useWindowDimension } from "@/composables/windowDimension";
import { useTiming } from "@/composables/timing";
import { useModalToggle } from "@/composables/modal";

const { t } = useTranslation();
const { isSmallScreen } = useWindowDimension();
const { sleep } = useTiming();

const auth = authStorage();
const systemBaseStorage = systemBaseStore();
const appState = appStateStore();

const props = defineProps({
  minimal: {
    type: Boolean,
    default: false,
  },
});

const intervalPowerCheckTimer = 30;
const secondsPreventSleep = 900;

const batteryStatus = ref<BatteryStatus | null>(null);

const duration = ref(0);
const remainingSeconds = ref(-1);
const progress = computed(() => 1 - remainingSeconds.value / duration.value);

const runningOut = ref(false);

let intervalId: number | null = null;

const dialogExtendTimeout = useTemplateRef<InstanceType<typeof AppDialog>>(
  "dialogExtendTimeout",
);
const powerCheckTimer = ref(-1);
const maxRemainingTime = ref(-1);
const timeoutDuration = ref(-1);

const isOnPowerSupply = ref(false);
const enableDialogExtendTimeout = ref(true);

const inited = ref(false);
const loading = ref(true);

const openSleepTimeout = ref(false);
const disabledStandbyInhibitor = ref(false);
const deviceWasSleeping = ref(false);

useModalToggle(openSleepTimeout, { lockScroll: false });

const dialogRemoveInhibitor = useTemplateRef<InstanceType<typeof AppDialog>>(
  "dialogRemoveInhibitor",
);

const optionsPreventSleep = computed(() => {
  return ["5", "10", "15"].map((option: any) => {
    return {
      label: `${option} ${t("sleep_timeout.prevent_sleep_for.unit")}`,
      value: option,
    };
  });
});

const activePreventSleep = ref(
  optionsPreventSleep.value[optionsPreventSleep.value.length - 1],
);

watch(batteryStatus, async (newValue, prevValue) => {
  isOnPowerSupply.value = newValue?.power_supply || false;

  if (!isOnPowerSupply.value && prevValue?.power_supply == true) {
    initStandbyTimeout();
  } else if (isOnPowerSupply.value) {
    stopTimer();
  }
});

watch(remainingSeconds, async (val, oldVal) => {
  if (loading.value) return;

  if (val < 60 && !runningOut.value) {
    runningOut.value = true;
  }

  if (
    val < 30 &&
    disabledStandbyInhibitor.value == false &&
    enableDialogExtendTimeout.value &&
    !dialogExtendTimeout.value?.isActive()
  ) {
    if (dialogExtendTimeout.value) {
      dialogExtendTimeout.value?.open();
    }
    enableDialogExtendTimeout.value = false;
  }

  if (val == 0 && oldVal > 0) {
    if (dialogExtendTimeout.value) {
      dialogExtendTimeout.value?.close();
    }

    await sleep(2500);
    checkConnection();
  }
});

const isAuthenticated = computed(() => {
  return auth.authenticated == LoginState.AUTHORISED;
});

watch(isAuthenticated, async (newValue, prevValue) => {
  if (newValue && !prevValue) {
    if (inited.value) {
      await fetchBatteryStatus(true);
    }

    init();
  }
});

watch(
  () => appState.connected,
  async (newValue, prevValue) => {
    if (newValue && !prevValue && isAuthenticated.value) {
      // Device reconnected (woke up), refresh battery status and reinitialize standby timeout
      console.log(
        "RemoteStatus: Device woke up, reinitializing standby timeout",
      );
      deviceWasSleeping.value = true;
      await fetchBatteryStatus(true);
      if (!isOnPowerSupply.value) {
        await initStandbyTimeout();
      }
      // Reset sleep flag after a short delay
      setTimeout(() => {
        deviceWasSleeping.value = false;
        console.log("RemoteStatus: Sleep flag reset");
      }, 1000);
    } else if (!newValue && prevValue && isAuthenticated.value) {
      // Device disconnected (likely going to sleep), stop timer if it was running
      console.log("RemoteStatus: Device going to sleep, stopping timer");
      if (remainingSeconds.value > 0) {
        stopTimer();
      }
    }
  },
);

const showTimeout = computed(() => {
  return (
    remainingSeconds.value > 0 &&
    !isOnPowerSupply.value &&
    !deviceWasSleeping.value
  );
});

const showBatteryStatus = computed(() => {
  return (
    isOnPowerSupply.value ||
    (batteryStatus.value && batteryStatus.value?.capacity)
  );
});

const mainClasses = computed(() => {
  let classList = "";
  classList += props.minimal == true ? "remote-status--minimal " : "";
  classList += showTimeout.value == false ? "remote-status--only-battery " : "";
  return classList;
});

const batteryClasses = computed(() => {
  let classList = "";
  classList += isOnPowerSupply.value ? "remote-status__battery--green " : "";
  classList +=
    batteryStatus.value?.status == BatteryStatusValue.LOW_BATTERY
      ? "remote-status__battery--red "
      : "";
  return classList;
});

const formattedTime = computed(() => {
  const totalSec = Math.max(0, Math.floor(remainingSeconds.value));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const secStr = seconds.toString().padStart(2, "0");

  if (minutes === 0) {
    return seconds.toString();
  } else {
    return `${minutes}.${secStr}`;
  }
});

async function fetchBatteryStatus(reload = false) {
  try {
    const status = await systemBaseStorage.getBatteryStatus(reload);
    if (status) {
      batteryStatus.value = status;

      if (status.power_supply) {
        isOnPowerSupply.value = true;
      }
    }
  } catch (e) {
    console.error(e);
  }
}

function resetTimer(delay: number, seconds: number) {
  if (typeof seconds !== "number") return;

  stopTimer();

  duration.value = delay;
  remainingSeconds.value = seconds;
  enableDialogExtendTimeout.value = true;
  runningOut.value = false;

  if (dialogExtendTimeout.value?.isActive()) {
    dialogExtendTimeout.value?.close();
  }
  powerCheckTimer.value = remainingSeconds.value - intervalPowerCheckTimer;

  const endTime = Date.now() + seconds * 1000;

  const tick = () => {
    const now = Date.now();
    const remaining = Math.max((endTime - now) / 1000, 0);
    remainingSeconds.value = remaining;

    if (powerCheckTimer.value > remainingSeconds.value) {
      checkPowerStatus(remainingSeconds.value);
    }

    if (remaining > 0) {
      intervalId = window.setTimeout(tick, 200);
    } else {
      stopTimer();
    }
  };

  tick();
}

function stopTimer() {
  if (intervalId !== null) {
    clearTimeout(intervalId);
    intervalId = null;
  }
}

watch(
  () => systemBaseStorage.batteryStatus,
  (status) => {
    if (status) {
      batteryStatus.value = status;
    }
  },
);

async function fetchStandbyInhibitors() {
  try {
    const data = await systemBaseStorage.getStandbyInhibitors(true);
    await setConfiguratorInhibitor(data);
  } catch (e) {
    console.error(e);
  }
}

async function createStandbyInhibitor(preventSleep?: number) {
  const message = {
    id: "web-configurator",
    who: "Web configurator",
    why: "device configuration",
    delay: preventSleep || secondsPreventSleep,
  };

  try {
    await systemBaseStorage.updateStandbyInhibitors(message);
    const data = await systemBaseStorage.getStandbyInhibitors(true);
    await setConfiguratorInhibitor(data, true);

    if (preventSleep) {
      openSleepTimeout.value = false;
    }
  } catch (e) {
    console.error(e);
  }
}

async function setConfiguratorInhibitor(
  data: StandbyInhibitor[],
  creating = false,
) {
  let doResetInhibitor = false;
  if (data && data.length > 0) {
    const inhibitor = data.find((item) => item.id === "web-configurator");

    if (
      inhibitor &&
      typeof inhibitor.delay != "undefined" &&
      typeof inhibitor.elapsed != "undefined"
    ) {
      const timeout = inhibitor.delay - inhibitor.elapsed;

      if (timeout < 35) {
        doResetInhibitor = true;
      }

      if (!doResetInhibitor) {
        if (inhibitor.delay) {
          maxRemainingTime.value = inhibitor.delay;
        }

        if (timeout && timeout > 0) {
          disabledStandbyInhibitor.value = false;
          timeoutDuration.value = inhibitor.delay;
          return resetTimer(timeoutDuration.value, timeout);
        }
      }
    }
  }

  if (doResetInhibitor || !creating) {
    await createStandbyInhibitor();
  }
}

async function checkPowerStatus(remaining = -1, removeInhibitor = false) {
  if (remaining > 0) {
    powerCheckTimer.value = remaining - 30;
  }
  let status = null;

  try {
    status = await systemBaseStorage.getPowerStatus(true);
  } catch (e) {
    console.error(e);
  }

  if (
    status != null &&
    status?.power_supply == false &&
    status?.standby_timeout_sec
  ) {
    let timeoutSec = status?.standby_timeout_sec;
    if (removeInhibitor) {
      timeoutDuration.value = timeoutSec;
    }

    if (
      timeoutSec > maxRemainingTime.value &&
      disabledStandbyInhibitor.value == false
    ) {
      timeoutSec = maxRemainingTime.value;
    } else if (disabledStandbyInhibitor.value == true) {
      if (timeoutDuration.value < timeoutSec) {
        timeoutDuration.value = timeoutSec;
      }
    }

    resetTimer(timeoutDuration.value, timeoutSec);
  } else if (status != null && status?.power_supply == true) {
    isOnPowerSupply.value = true;
  }
}

async function initStandbyTimeout() {
  await fetchStandbyInhibitors();
  await checkPowerStatus();
}

async function removeStandbyInhibitor() {
  try {
    await systemBaseStorage.removeStandbyInhibitor("web-configurator");
    disabledStandbyInhibitor.value = true;
    // stopTimer();
    // remainingSeconds.value = -1;
    openSleepTimeout.value = false;
    checkPowerStatus(-1, true);
  } catch (e) {
    addErrorBottom(e);
  }
}

async function init() {
  if (inited.value) return true;

  loading.value = true;
  await fetchBatteryStatus();

  if (!isOnPowerSupply.value) {
    await initStandbyTimeout();
  }

  inited.value = true;
  loading.value = false;
}

function clickedRemoteStatus(e: Event) {
  const target = e.target as HTMLElement | null;

  if (
    target &&
    !target.closest(".sleep-timeout") &&
    !target.closest(".sleep-timeout-background")
  ) {
    openSleepTimeout.value = true;
  }
}

function checkConnection() {
  // Ask the ConnectionMonitor for an immediate out-of-cycle liveness check
  // (heartbeat ping or reachability probe, depending on its state).
  connectionMonitor.wakeHint();
}

onMounted(() => {
  if (isAuthenticated.value) {
    init();
  }
});

onUnmounted(() => {
  stopTimer();
});
</script>
<template>
  <div class="remote-status" :class="mainClasses" @click="clickedRemoteStatus">
    <template v-if="showTimeout && !loading">
      <div class="remote-status__timeout">
        <div class="remote-status__timeout__indicator">
          <CountdownCircle
            :progress="progress"
            :class="{ 'countdown-circle--warning': runningOut }"
          />
        </div>
        <span
          class="remote-status__timeout__value"
          :class="{ 'remote-status__timeout__value--warning': runningOut }"
          >{{ formattedTime }}</span
        >
      </div>
      <span v-if="showBatteryStatus" class="remote-status__divider"></span>
      <AppDialog
        ref="dialogExtendTimeout"
        :title="$t('remote_status.extend_timeout.title')"
        :text="
          $t('remote_status.extend_timeout.question', {
            seconds: Math.ceil(remainingSeconds),
          })
        "
        :submit-text="$t('ui.extend')"
        :cancel-text="$t('ui.cancel')"
        @submit="createStandbyInhibitor"
      />
    </template>
    <div
      v-if="showBatteryStatus"
      class="remote-status__battery"
      :class="batteryClasses"
    >
      <i
        v-if="batteryStatus?.status == BatteryStatusValue.CHARGING"
        class="fa-light fa-bolt remote-status__battery__icon-charging"
      ></i>
      <template v-if="batteryStatus && batteryStatus.capacity">
        <span class="remote-status__battery__capacity">{{
          batteryStatus.capacity
        }}</span>
        <span class="remote-status__battery__indicator">
          <span
            class="remote-status__battery__indicator__value"
            :style="`height: ${batteryStatus.capacity}%`"
          ></span>
        </span>
      </template>
    </div>
    <Teleport to="body" :disabled="!isSmallScreen">
      <Transition name="opacity">
        <div
          v-show="openSleepTimeout"
          class="sleep-timeout-background"
          @click="openSleepTimeout = false"
        ></div>
      </Transition>
    </Teleport>

    <Teleport to="body" :disabled="!isSmallScreen">
      <Transition name="grow">
        <div
          v-show="openSleepTimeout"
          :class="{ opened: openSleepTimeout }"
          class="sleep-timeout"
        >
          <div class="sleep-timeout__title">
            {{ $t("sleep_timeout.title") }}
          </div>
          <button
            class="button button--secondary button--icon button--icon--small button-close"
            @click="openSleepTimeout = false"
          >
            <i class="fa-regular fa-close"></i>
          </button>
          <div class="sleep-timeout__body">
            <p class="sleep-timeout__info">
              <template v-if="isOnPowerSupply">{{
                $t("sleep_timeout.info_charging")
              }}</template>
              <template v-else>{{ $t("sleep_timeout.info_prevent") }}</template>
            </p>
            <div v-if="isOnPowerSupply" class="sleep-timeout__charging">
              <i class="fa-light fa-bolt"></i>
              <span v-if="batteryStatus"
                ><template v-if="batteryStatus.capacity"
                  >{{ batteryStatus.capacity }} -
                </template>
                {{ $t(`battery_status.value.${batteryStatus.status}`) }}
              </span>
            </div>
            <template v-else>
              <div class="select-extra">
                <div class="select-extra__text">
                  <span class="select-extra__label">
                    {{ $t("sleep_timeout.prevent_sleep_for.label") }}
                  </span>
                </div>
                <UCSelect
                  v-model="activePreventSleep"
                  :options="optionsPreventSleep"
                  :position="'right'"
                  :light="true"
                />
              </div>
              <div v-if="showTimeout" class="sleep-timeout__timer">
                <span class="sleep-timeout__timer__label">{{
                  $t("sleep_timeout.going_to_sleep")
                }}</span>
                <span class="sleep-timeout__timer__value">{{
                  formattedTime
                }}</span>
                <button
                  v-if="!disabledStandbyInhibitor"
                  class="button button--blank button--icon button--icon"
                  @click="dialogRemoveInhibitor?.open()"
                >
                  <i class="fa-thin fa-trash"></i>
                </button>
              </div>
              <button
                class="button button--primary"
                :class="{
                  'button--secondary': !showTimeout || disabledStandbyInhibitor,
                }"
                @click="createStandbyInhibitor(activePreventSleep.value * 60)"
              >
                {{
                  $t("sleep_timeout.prevent_sleep_for.action", {
                    minutes: activePreventSleep.value,
                  })
                }}
              </button>
            </template>
          </div>
        </div>
      </Transition>
    </Teleport>

    <AppDialog
      ref="dialogRemoveInhibitor"
      :title="$t('sleep_timeout.dialog.delete_inhibitor.title')"
      :text="$t('sleep_timeout.dialog.delete_inhibitor.question')"
      :submit-text="$t('ui.delete')"
      :cancel-text="$t('ui.cancel')"
      @submit="removeStandbyInhibitor"
    />
  </div>
</template>
