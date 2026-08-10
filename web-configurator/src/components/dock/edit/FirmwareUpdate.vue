<script setup lang="ts">
import { computed, onBeforeMount, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";

import {
  DockUpdateProgressEventState,
  DockUpdateProgressEventType,
  DockUpdateProgressState,
} from "@/types/enums";

import type { DockUpdateProgressMessage, DockUpdateCheck } from "@/types/dock";
import type { BatteryStatus } from "@/types/systemBase";

import { systemBaseStore } from "@/stores/systemBase";
import { docksStore } from "@/stores/docks";

import translatedProperty from "@/composables/translatedProperty";
import { getErrorMessage } from "@/composables/error";

import VueMarkdown from "vue-markdown-render";
import ModalSecondary from "@/components/elements/ModalSecondary.vue";
import ProgressBar from "@/components/ui/ProgressBar.vue";
import { addErrorBottom } from "@/stores/messages";

const { t } = useTranslation();

const props = defineProps({
  dock: {
    type: Object,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: false,
  },
});
const emit = defineEmits(["success"]);

const store = docksStore();
const systemBaseStorage = systemBaseStore();

const updateStatus = ref<null | DockUpdateCheck>(null);

const showReleaseNotes = ref(false);
const errorStatus = ref(false);

const progress = ref(-1);
const currentState = ref<string>(DockUpdateProgressState.IDLE);

const updateErrorMessage = ref("");

const checkingUpdate = ref(false);

const remoteBatteryStatus = ref<BatteryStatus | null>(null);

store.$onAction(({ name, args, after }) => {
  if (name !== "dockUpdateChange") {
    return;
  }

  after(() => {
    const msg: DockUpdateProgressMessage = args[0];
    if (msg.dock_id !== props.dock.dock_id) {
      return;
    }

    progress.value = msg.progress;
    if (msg.state === DockUpdateProgressEventState.OK) {
      currentState.value = DockUpdateProgressState.SUCCESS;
      const newVer = msg.version;
      emit("success", newVer);
      resetUpdate();
    } else if (msg.state === DockUpdateProgressEventState.ERROR) {
      currentState.value = DockUpdateProgressState.ERROR;
    } else if (msg.event_type === DockUpdateProgressEventType.START) {
      currentState.value = DockUpdateProgressState.IN_PROGRESS;
    }
  });
});

watch(
  () => systemBaseStorage.batteryStatus,
  (status) => {
    if (status) {
      remoteBatteryStatus.value = status;
    }
  },
);

onBeforeMount(() => {
  checkForUpdate();
  fetchRemoteBatteryStatus();
});

const statusText = computed(() => {
  if (!updateStatus.value) {
    return "dock.update.loading";
  }
  if (!updateStatus.value.update_check_enabled) {
    return "dock.update.disabled";
  }
  if (!updateStatus.value.update_available) {
    return "dock.update.ok";
  }
  return "dock.update.update";
});

const updateAvailable = computed(() => {
  if (!updateStatus.value) {
    return false;
  }
  return updateStatus.value.update_available;
});

const newVersion = computed(() => {
  if (!updateStatus.value?.update_available) {
    return null;
  }
  return updateStatus.value.firmware_update?.version || null;
});

const showCheckUpdate = computed(() => {
  if (!updateStatus.value) {
    return true;
  }

  return !updateAvailable.value;
});

async function checkForUpdate(userAction = false) {
  checkingUpdate.value = true;
  errorStatus.value = false;

  try {
    updateStatus.value = await store.getUpdateStatus(
      props.dock.dock_id,
      userAction,
    );
  } catch {
    errorStatus.value = true;
  }

  checkingUpdate.value = false;
}

async function startFirmwareUpdate() {
  try {
    await store.startUpgrade(props.dock.dock_id);
    currentState.value = DockUpdateProgressState.IN_PROGRESS;
  } catch (e) {
    const err = e as any;
    const textPrefix = t("dock.update.errors.prefix") + ": ";

    updateErrorMessage.value =
      textPrefix +
      (err?.response?.status ? err?.response?.status + " " : "") +
      getErrorMessage(err, "dock.update")?.message;

    // if (err && err?.response && (err?.response?.status == 400 || err?.response?.status == 404)) {
    //   updateErrorMessage.value = textPrefix + t("dock.update.errors.not_available");
    // } else if (err && err?.response && err?.response?.status == 409) {
    //   updateErrorMessage.value = textPrefix + t("dock.update.errors.already_in_progress");
    // } else if (err && err?.response && err?.response?.status == 503) {
    //   updateErrorMessage.value = textPrefix + t("dock.update.errors.not_connected");
    // } else if (err && (err?.response && err?.response?.status) || err?.message) {
    //   const errMsg = err?.message ? ` (${err?.message})` : '';
    //   updateErrorMessage.value = `${textCode}${err?.response?.status||''}${errMsg}`;
    // }
  }
}

async function fetchDockList() {
  try {
    await store.getDockList(true);
  } catch (e) {
    addErrorBottom(e);
  }
}

async function fetchRemoteBatteryStatus() {
  try {
    const status = await systemBaseStorage.getBatteryStatus();
    if (status) {
      remoteBatteryStatus.value = status;
    }
  } catch (e) {
    console.error(e);
  }
}

function resetUpdate(afterError = false) {
  if (afterError) {
    currentState.value = DockUpdateProgressState.IDLE;
  }

  progress.value = -1;
  updateStatus.value = null;
}

// async function abortUpdate() {
//   await store.abortUpgrade(props.dock.dock_id);
// }

async function updateDone() {
  await fetchDockList();
  currentState.value = DockUpdateProgressState.IDLE;
}
</script>
<template>
  <div class="dock-firmware-update">
    <div class="dock-firmware-update__row dock-firmware-update__row--action">
      <div class="dock-firmware-update__item">
        <span class="dock-firmware-update__item__label">
          {{ $t("dock.update.firmware_version") }}
        </span>
        <span class="dock-firmware-update__item__value">
          <template v-if="dock.version">{{ dock.version }}</template>
          <template v-else>{{ $t("ui.n_a", "N/A") }}</template>
        </span>
      </div>
      <div v-if="updateAvailable" class="dock-firmware-update__item">
        <div class="dock-firmware-update__item__update-idle">
          <div
            v-if="updateErrorMessage && updateErrorMessage.length > 0"
            class="dock-firmware-update__item__update-error"
          >
            <span>{{ updateErrorMessage }}</span>
            <button
              class="button button--secondary button--icon button--icon--small"
              @click.prevent="updateErrorMessage = ''"
            >
              <i class="fa-regular fa-close"></i>
            </button>
          </div>
          <template v-else>
            <span
              v-if="
                remoteBatteryStatus == null ||
                remoteBatteryStatus?.capacity < 20
              "
              class="dock-firmware-update__item__text dock-firmware-update__item__text--secondary"
            >
              {{ $t("dock.update.min_battery_percent_required") }}
            </span>
            <button
              v-else-if="isActive"
              class="button button--secondary"
              @click="startFirmwareUpdate"
            >
              {{ $t("ui.update") }}
            </button>
          </template>
        </div>
      </div>
      <div v-else class="dock-firmware-update__item">
        <div
          v-if="errorStatus"
          class="dock-firmware-update__item__update-error"
        >
          <i class="fa-light fa-exclamation"></i>
          <span>{{ $t("dock.update.error_on_check") }}</span>
          <button
            class="button button--secondary button--icon button--icon--small"
            @click.prevent="errorStatus = false"
          >
            <i class="fa-regular fa-close"></i>
          </button>
        </div>
        <div
          v-else-if="showCheckUpdate && isActive"
          class="dock-firmware-update__item__checking"
        >
          <button
            :disabled="checkingUpdate"
            class="button button--secondary"
            @click="checkForUpdate(true)"
          >
            {{ $t("dock.update.check") }}
          </button>
          <img
            v-show="checkingUpdate"
            src="/images/loading-indicator.png"
            alt="Loading"
            class="img-loading"
          />
        </div>
        <span v-else-if="isActive" class="dock-firmware-update__item__text">
          {{ $t(statusText) }}
        </span>
      </div>
    </div>
    <div
      v-if="newVersion && newVersion != dock.version"
      class="dock-firmware-update__row"
    >
      <div class="dock-firmware-update__item">
        <span class="dock-firmware-update__item__label">
          {{ $t("dock.update.new_version") }}
        </span>
        <span class="dock-firmware-update__item__value">
          {{ newVersion }}
        </span>
      </div>
      <div class="dock-firmware-update__item">
        <button
          v-if="updateStatus?.firmware_update?.description"
          class="button button--blank button-release-notes"
          @click="showReleaseNotes = true"
        >
          <i class="fa-light fa-book-open-reader"></i>
          {{ $t("dock.update.release_notes") }}
        </button>
      </div>
    </div>

    <Teleport to="body">
      <ModalSecondary
        :show="showReleaseNotes"
        :width="'37.5rem'"
        :name="'modal-release-notes'"
        class="software-update__modal--release-notes"
        @close="showReleaseNotes = false"
      >
        <template #header>
          {{ $t("dock.update.release_notes") }}
        </template>
        <div v-markdown-tools class="markdown-wrapper">
          <vue-markdown
            v-if="updateStatus?.firmware_update?.description"
            :source="
              translatedProperty(updateStatus?.firmware_update?.description)
            "
            class="vue-markdown software-update__modal--release-notes__text"
          />
        </div>
      </ModalSecondary>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="
          (updateAvailable && currentState != DockUpdateProgressState.IDLE) ||
          currentState === DockUpdateProgressState.SUCCESS
        "
        class="process-software-update"
      >
        <div class="process-software-update__container">
          <div></div>
          <div class="process-software-update__body">
            <div
              v-if="currentState === DockUpdateProgressState.ERROR"
              class="process-software-update__fail"
            >
              <i class="fa-light fa-close"></i>
              <p>{{ $t("dock.update.error.title") }}</p>
              <span>{{ $t("dock.update.error.description") }}</span>
              <button
                class="button button--secondary button--min-w"
                @click="resetUpdate(true)"
              >
                {{ $t("ui.back") }}
              </button>
            </div>

            <div
              v-else-if="currentState === DockUpdateProgressState.IN_PROGRESS"
              class="process-software-update__progress"
            >
              <p>{{ $t("dock.update.in_progress") }}</p>
              <ProgressBar v-if="progress > -1" :progress="progress" />
            </div>

            <div
              v-else-if="currentState === DockUpdateProgressState.SUCCESS"
              class="process-software-update__success"
            >
              <i class="fa-light fa-check-circle"></i>
              <p>{{ $t("dock.update.success.title") }}</p>
              <span>{{ $t("dock.update.success.description") }}</span>
              <button
                class="button button--secondary button--min-w"
                @click="updateDone"
              >
                {{ $t("ui.done") }}
              </button>
            </div>
          </div>

          <div class="process-software-update__footer">
            <p
              v-if="currentState === DockUpdateProgressState.IN_PROGRESS"
              class="process-software-update__warning"
            >
              <i class="fa-light fa-exclamation"></i>
              <span>{{ $t("dock.update.do_not_turn_off") }}</span>
            </p>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
