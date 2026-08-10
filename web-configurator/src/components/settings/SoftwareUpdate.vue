<script setup lang="ts">
import { ref, watch, onMounted, computed, useTemplateRef } from "vue";
import { storeToRefs } from "pinia";
import ApiConnection from "@/api";

import {
  SystemUpdateEventType,
  SystemUpdateProgressState,
  SystemUpdateDownloadState,
  CfgGroups,
} from "@/types/enums";
import type { ChangeCallbackParams } from "@/types/config";
import type { SystemUpdateCheck, AvailableSystemUpdate } from "@/types/update";
import type { BatteryStatus } from "@/types/systemBase";

import { addErrorBottom, addErrorFull } from "@/stores/messages";
import { systemBaseStore } from "@/stores/systemBase";
import { systemUpdateStore } from "@/stores/systemUpdate";
import { configStore } from "@/stores/config";
import { appStateStore } from "@/stores/appState";

import translatedProperty from "@/composables/translatedProperty";
import { errorOnChange, getErrorMessage } from "@/composables/error";
import { useTiming } from "@/composables/timing";

import VueMarkdown from "vue-markdown-render";
import ModalSecondary from "@/components/elements/ModalSecondary.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import ProgressBar from "@/components/ui/ProgressBar.vue";
import UCToggle from "@/components/ui/UCToggle.vue";
import SettingsOptionButton from "@/components/settings/SettingsOptionButton.vue";
import { useTranslation } from "i18next-vue";

const systemApi = ApiConnection.system;

const { t } = useTranslation();

const systemBaseStorage = systemBaseStore();
const store = systemUpdateStore();
const appStore = appStateStore();

const props = defineProps({
  back: {
    type: Function,
    required: true,
  },
});

const { sleep } = useTiming();
const config = configStore();
const checkingUpdate = ref(false);
const msgError = ref("");

defineExpose({
  checkForUpdate,
});

const emit = defineEmits(["close", "updateStatus"]);

const activeUpdateIndex = ref(-1);
const preparingUpdate = ref(false);
const restarting = ref(false);
const hadForcedCheck = ref(false);
const activeReleaseNotes = ref(-1);
const checkUpdateData = ref<SystemUpdateCheck | null>();
const cfgSoftwareUpdate = ref();
const { updateMessage } = storeToRefs(store);
const showBetaUpdateDisclaimer = ref(false);
const batteryStatus = ref<BatteryStatus | null>(null);
const settingsSectionMain = useTemplateRef<HTMLDivElement>(
  "settingsSectionMain",
);
const dialogDisableBetaUpdates = useTemplateRef<InstanceType<typeof AppDialog>>(
  "dialogDisableBetaUpdates",
);

/**
 * What the settings list shows for this section before it is opened.
 *
 * Pushed to the parent rather than pulled from it: reading it off the component
 * instance made the parent's render depend on the instance, so a section that
 * failed to mount re-triggered that render on every retry and the page locked up
 * in a re-mount loop.
 */
const updateStatus = computed(() => ({
  available: !!checkUpdateData.value?.available?.length,
  errorMessage: msgError.value.length > 0 ? msgError.value : null,
}));

watch(updateStatus, (status) => emit("updateStatus", status));

const channelState = computed(() => {
  return cfgSoftwareUpdate.value && cfgSoftwareUpdate.value.channel == "TESTING"
    ? true
    : false;
});

const downloading = computed(() => {
  const progress = updateMessage.value?.progress;

  if (!progress) return false;
  if (progress.state !== "DOWNLOAD") return false;
  if (typeof progress.download_percent === "undefined") return false;

  return progress.download_percent < 100;
});

const updating = computed(() => {
  return (
    updateMessage.value?.event_type == SystemUpdateEventType.PROGRESS &&
    updateMessage.value?.progress?.state != SystemUpdateProgressState.DONE &&
    updateMessage.value?.progress?.state == SystemUpdateProgressState.PROGRESS
  );
});

watch(downloading, (val, oldVal) => {
  if (val == false && oldVal == true) {
    checkForUpdate(false, true);
  }
});

watch(
  () => store.error,
  (error) => {
    if (error) {
      errorOnChange(error);
    }
  },
);

watch(updateMessage, async () => {
  if (
    updateMessage.value?.progress?.state == SystemUpdateProgressState.DONE &&
    restarting.value == false
  ) {
    appStore.setRestarting(true);
    await sleep(1000);
    restarting.value = true;
    store.$state.updateMessage = null;
    activeUpdateIndex.value = -1;
  }

  if (
    updateMessage.value?.event_type == SystemUpdateEventType.PROGRESS &&
    updateMessage.value?.progress?.state == SystemUpdateProgressState.DOWNLOAD
  ) {
    if (updateMessage.value?.progress?.download_percent == 100) {
      activeUpdateIndex.value = -1;
    } else if (
      updateMessage.value?.progress?.download_percent &&
      updateMessage.value?.progress?.download_percent < 100 &&
      activeUpdateIndex.value < 0 &&
      checkUpdateData.value &&
      checkUpdateData.value.available
    ) {
      const active = checkUpdateData.value.available.findIndex(
        (a) => a.id == updateMessage.value?.progress?.update_id,
      );
      if (active > -1) {
        activeUpdateIndex.value = active;
      }
    }
  }

  if (
    updateMessage.value?.event_type == SystemUpdateEventType.PROGRESS &&
    updateMessage.value?.progress?.state == SystemUpdateProgressState.SUCCESS
  ) {
    checkForUpdate(false, true);
    activeUpdateIndex.value = -1;
  }

  if (
    updateMessage.value?.event_type == SystemUpdateEventType.PROGRESS &&
    updateMessage.value?.progress?.state == SystemUpdateProgressState.FAILURE
  ) {
    activeUpdateIndex.value = -1;
  }
});

watch(
  () => config.error,
  (error) => {
    if (error) {
      errorOnChange(error);
    }
  },
);

watch(
  () => config.config?.software_update,
  (value) => {
    if (value) {
      cfgSoftwareUpdate.value = value;
    }
  },
  { immediate: true },
);

watch(
  () => systemBaseStorage.batteryStatus,
  (status) => {
    if (status) {
      batteryStatus.value = status;
    }
  },
);

watch(
  () => [appStore.restarting, appStore.connected],
  async ([storeRestarting, connected]) => {
    if (restarting.value == true && storeRestarting == false && connected) {
      await sleep(1000);
      checkForUpdate(false, true);
      restarting.value = false;
    }
  },
);

function enableDownload(update: AvailableSystemUpdate) {
  return (
    checkUpdateData.value &&
    checkUpdateData.value.available &&
    checkUpdateData.value.available.length > 0 &&
    update.download == SystemUpdateDownloadState.PENDING
  );
}

function enableInstall(update: AvailableSystemUpdate) {
  return (
    checkUpdateData.value &&
    checkUpdateData.value.available &&
    checkUpdateData.value.available.length > 0 &&
    update.download == SystemUpdateDownloadState.DOWNLOADED
  );
}

async function doUpdate(itemIndex: number) {
  activeUpdateIndex.value = itemIndex;
  preparingUpdate.value = true;

  try {
    if (
      checkUpdateData.value &&
      checkUpdateData.value.available &&
      checkUpdateData.value.available[itemIndex].id
    ) {
      await store.doUpdate(checkUpdateData.value.available[itemIndex].id);
    }
  } catch (e) {
    addErrorBottom(e);
  }

  preparingUpdate.value = false;
}

async function checkForUpdate(forcedCheck = false, reload = false) {
  checkingUpdate.value = true;
  clearErrors();
  try {
    checkUpdateData.value = await store.getUpdates(forcedCheck, reload);
  } catch (error) {
    setCheckError(error);
  }
  checkingUpdate.value = false;
  if (forcedCheck) {
    hadForcedCheck.value = true;
  }
}

function checkUpdateChange(ev: Event) {
  const chbox = ev.target as HTMLInputElement;
  onItemChange([
    {
      name: "check_for_updates",
      value: chbox.checked,
    },
    {
      name: "auto_update",
      value: cfgSoftwareUpdate.value.auto_update,
    },
  ]);
}

function autoUpdateChange(ev: Event) {
  const chbox = ev.target as HTMLInputElement;
  onItemChange([
    {
      name: "auto_update",
      value: chbox.checked,
    },
    {
      name: "check_for_updates",
      value: cfgSoftwareUpdate.value.check_for_updates,
    },
  ]);
}

function startDisableBetaUpdates() {
  dialogDisableBetaUpdates.value?.open();
}

async function setChannelDefault() {
  await changeChannel("DEFAULT");
  reboot();
}

async function setChannelTesting() {
  await changeChannel("TESTING");
  showBetaUpdateDisclaimer.value = false;
  reboot();
}

async function changeChannel(channelValue: string) {
  await onItemChange([
    {
      name: "channel",
      value: channelValue,
    },
    {
      name: "check_for_updates",
      value: cfgSoftwareUpdate.value.check_for_updates,
    },
    {
      name: "auto_update",
      value: cfgSoftwareUpdate.value.auto_update,
    },
  ]);
}

async function onItemChange(list: ChangeCallbackParams[]) {
  try {
    await config.updateByList(CfgGroups.software_update as string, list);
  } catch (e) {
    addErrorBottom(e, null, settingsSectionMain.value ?? undefined);
  }
}

function setCheckError(e: unknown) {
  msgError.value = getErrorMessage(e, "software_update.check")?.message;
}

function openReleaseNotes(index: number) {
  activeReleaseNotes.value = index;
}

function startUpdateCheck() {
  checkForUpdate(true);
}

async function fetchBatteryStatus() {
  try {
    const status = await systemBaseStorage.getBatteryStatus();
    if (status) {
      batteryStatus.value = status;
    }
  } catch (e) {
    console.error(e);
  }
}

async function reboot() {
  try {
    await systemApi.restartRemote();
    appStore.setRestarting(true);
  } catch (e) {
    addErrorFull(e);
  }
}

onMounted(async () => {
  await checkForUpdate(false);
  await fetchBatteryStatus();
});

const descriptionText = computed(() => {
  return msgError.value.length > 0
    ? msgError.value
    : checkUpdateData?.value?.installed_version;
});

function clearErrors() {
  if (msgError.value.length > 0) {
    msgError.value = "";
  }
}
</script>
<template>
  <div class="software-update">
    <button
      class="button button--secondary button--icon button--icon--medium"
      @click="props.back()"
    >
      <i class="fas fa-arrow-left"></i>
    </button>
    <span class="page-settings-section__page-name">{{
      $t("software_update.title")
    }}</span>
    <div ref="settingsSectionMain" class="page-settings-section__main">
      <div
        v-if="checkingUpdate && !preparingUpdate"
        class="page-settings-section__software-update-status page-settings-section__software-update-status--checking-update"
      >
        <span
          class="page-settings-section__software-update-status__icon page-settings-section__software-update-status__icon--rotate"
          ><i class="fa-light fa-arrows-rotate"></i
        ></span>
        {{ $t("software_update.state.check_for_update") }}
      </div>
      <div
        v-else-if="msgError.length > 0"
        class="page-settings-section__software-update-status page-settings-section__software-update-status--error"
      >
        <span class="page-settings-section__software-update-status__icon"
          ><i class="fa-light fa-warning"></i
        ></span>
        {{ $t("software_update.state.check_error") }}
        <p>{{ msgError }}</p>
        <button
          class="button button--tertiary button--min-w"
          @click="clearErrors"
        >
          {{ $t("ui.close") }}
        </button>
      </div>
      <div
        v-else-if="
          checkUpdateData?.available && checkUpdateData?.available.length > 0
        "
        class="page-settings-section__software-update-status page-settings-section__software-update-status--available-software"
      >
        <span class="page-settings-section__software-update-status__icon"
          ><i class="fa-light fa-cloud-arrow-down"></i
        ></span>
        {{ $t("software_update.state.available_software") }}
      </div>
      <div v-else class="page-settings-section__software-update-status">
        <span class="page-settings-section__software-update-status__icon"
          ><i class="fa-light fa-circle-check"></i
        ></span>
        {{ $t("software_update.state.up_to_date") }}
      </div>

      <SettingsOptionButton
        :type="'system-version'"
        :label="$t('software_update.up_to_date.system_version')"
        :description="descriptionText"
      >
        <template #customFields>
          <button
            :disabled="checkingUpdate || msgError.length > 0"
            class="button button--secondary"
            @click="startUpdateCheck()"
          >
            {{ $t("software_update.up_to_date.check_for_update") }}
          </button>
        </template>
      </SettingsOptionButton>

      <template
        v-if="
          checkUpdateData?.available && checkUpdateData?.available.length > 0
        "
      >
        <template
          v-for="(update, index) in checkUpdateData?.available"
          :key="update.id"
        >
          <SettingsOptionButton
            :type="'new-version'"
            :label="$t('software_update.new_version.title')"
            :description="`${update.version}${
              update.download == 'DOWNLOADING'
                ? ' - ' + $t(`software_update.status.${update.download}`)
                : ''
            }`"
          >
            <template #customFields>
              <div class="settings-option-button--new-version__triggers">
                <button
                  class="button button--blank button-release-notes"
                  @click="openReleaseNotes(index)"
                >
                  <i class="fa-light fa-book-open-reader"></i>
                  {{ $t("software_update.release_notes.title") }}
                </button>
                <p
                  v-if="batteryStatus == null || batteryStatus?.capacity < 50"
                  class="software-update__battery-message"
                >
                  <i class="fa-light fa-battery-quarter"></i>
                  <span>{{ $t("software_update.min_battery") }}</span>
                </p>
                <ProgressBar
                  v-else-if="
                    downloading && updateMessage && activeUpdateIndex == index
                  "
                  :progress="updateMessage.progress?.download_percent"
                />
                <button
                  v-else-if="enableDownload(update) || enableInstall(update)"
                  :disabled="
                    preparingUpdate ||
                    downloading ||
                    updating ||
                    activeUpdateIndex > -1
                  "
                  class="button button--secondary"
                  @click="doUpdate(index)"
                >
                  <template v-if="enableDownload(update)">{{
                    $t("ui.download")
                  }}</template>
                  <template v-else>{{ $t("ui.install") }}</template>
                </button>
              </div>
            </template>
          </SettingsOptionButton>
        </template>
      </template>

      <UCToggle
        v-if="cfgSoftwareUpdate"
        v-model="cfgSoftwareUpdate.check_for_updates"
        :settings="true"
        :label="$t('software_update.check_updates.title')"
        :description="$t('software_update.check_updates.description')"
        :full-w="true"
        @change="checkUpdateChange($event)"
      />

      <UCToggle
        v-if="cfgSoftwareUpdate"
        v-model="cfgSoftwareUpdate.auto_update"
        :settings="true"
        :label="$t('software_update.auto_update.title')"
        :description="$t('software_update.auto_update.description')"
        :full-w="true"
        @change="autoUpdateChange($event)"
      />

      <div class="software-update__beta-update">
        <UCToggle
          v-model="channelState"
          :settings="true"
          :label="$t('software_update.beta_updates.title')"
          :description="$t('software_update.beta_updates.description')"
          :full-w="true"
          :inactive-label="true"
        />
        <div
          v-if="channelState == false"
          class="software-update__beta-update__trigger"
          @click="showBetaUpdateDisclaimer = true"
        ></div>
        <div
          v-else
          class="software-update__beta-update__trigger"
          @click="startDisableBetaUpdates"
        ></div>
      </div>
    </div>
    <AppDialog
      ref="dialogDisableBetaUpdates"
      :title="$t('software_update.beta_updates.modal.title')"
      :text="$t('software_update.beta_updates.modal.disabling')"
      :submit-text="$t('ui.confirm_and_reboot')"
      :cancel-text="$t('ui.cancel')"
      @submit="setChannelDefault"
    />
    <Teleport to="body">
      <ModalSecondary
        :show="showBetaUpdateDisclaimer == true"
        :width="'37.5rem'"
        :name="'modal-beta-disclaimer'"
        class="software-update__modal--beta-disclaimer"
        @close="showBetaUpdateDisclaimer = false"
      >
        <template #header>
          {{ $t("software_update.beta_updates.modal.title") }}
        </template>
        <div v-markdown-tools class="markdown-wrapper">
          <vue-markdown
            :source="$t('software_update.beta_updates.modal.disclaimer')"
            class="vue-markdown software-update__modal--beta-disclaimer__text"
          />
        </div>
        <template #footer>
          <button
            class="button button--tertiary"
            @click="showBetaUpdateDisclaimer = false"
          >
            {{ $t("ui.cancel") }}
          </button>
          <button class="button button--secondary" @click="setChannelTesting">
            {{ $t("ui.confirm_and_reboot") }}
          </button>
        </template>
      </ModalSecondary>
    </Teleport>
    <Teleport to="body">
      <ModalSecondary
        :show="activeReleaseNotes > -1"
        :width="'37.5rem'"
        :name="'modal-release-notes'"
        class="software-update__modal--release-notes"
        @close="activeReleaseNotes = -1"
      >
        <template #header>
          {{ $t("software_update.release_notes.title") }}
        </template>
        <div v-markdown-tools class="markdown-wrapper">
          <vue-markdown
            v-if="
              checkUpdateData?.available &&
              checkUpdateData?.available[activeReleaseNotes].description
            "
            :source="
              translatedProperty(
                checkUpdateData?.available[activeReleaseNotes].description,
              )
            "
            class="vue-markdown software-update__modal--release-notes__text"
          />
        </div>
      </ModalSecondary>
    </Teleport>
    <Teleport to="body">
      <div v-if="updateMessage && updating" class="process-software-update">
        <div class="process-software-update__container">
          <div></div>
          <div class="process-software-update__body">
            <div
              v-if="
                updateMessage.event_type == SystemUpdateEventType.PROGRESS &&
                updateMessage.progress?.state ==
                  SystemUpdateProgressState.SUCCESS
              "
              class="process-software-update__success"
            >
              <i class="fa-light fa-check-circle"></i>
              <p>{{ $t("software_update.success.title") }}</p>
              <span>{{ $t("software_update.success.description") }}</span>
            </div>

            <div
              v-else-if="
                updateMessage.event_type == SystemUpdateEventType.PROGRESS &&
                updateMessage.progress?.state ==
                  SystemUpdateProgressState.FAILURE
              "
              class="process-software-update__fail"
            >
              <i class="fa-light fa-close"></i>
              <p>{{ $t("software_update.fail.title") }}</p>
              <span>{{ $t("software_update.fail.description") }}</span>
              <button class="button button--secondary button--min-w">
                {{ $t("ui.back") }}
              </button>
            </div>

            <div
              v-else-if="
                updateMessage.event_type == SystemUpdateEventType.START ||
                updateMessage.event_type == SystemUpdateEventType.PROGRESS
              "
              class="process-software-update__progress"
            >
              <p>{{ $t("software_update.progress.title") }}</p>
              <span
                v-if="
                  updateMessage.progress?.total_steps &&
                  updateMessage.progress?.current_step
                "
              >
                {{
                  t("software_update.progress.step", {
                    current: updateMessage.progress?.current_step,
                    total: updateMessage.progress?.total_steps,
                  })
                }}
              </span>
              <ProgressBar
                v-if="updateMessage.progress?.current_percent"
                :progress="updateMessage.progress?.current_percent"
              />
            </div>
          </div>

          <div class="process-software-update__footer">
            <p
              v-if="
                updateMessage.event_type == SystemUpdateEventType.START ||
                updateMessage.event_type == SystemUpdateEventType.PROGRESS
              "
              class="process-software-update__warning"
            >
              <i class="fa-light fa-exclamation"></i>
              <span>{{ $t("software_update.progress.do_not_turn_off") }}</span>
            </p>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
