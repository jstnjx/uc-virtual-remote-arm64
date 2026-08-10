<script setup lang="ts">
import { ref, onMounted, watch, computed, useTemplateRef } from "vue";
import { useRoute } from "vue-router";
import { useTranslation } from "i18next-vue";

import ApiConnection from "@/api";

import { FlashMessageInfoStatus, CfgGroups, BackupStates } from "@/types/enums";
import type { RestoreBackupParams } from "@/types/backup";
import type { ChangeCallbackParams } from "@/types/config";
import type { CodeSetFileData } from "@/types/ir";

import { appStateStore } from "@/stores/appState";
import { configStore } from "@/stores/config";
import { addErrorFull, addErrorBottom, addInfoFull } from "@/stores/messages";

import { useDownloadFile } from "@/composables/downloadFile";
import { useTiming } from "@/composables/timing";
import { getIconName } from "@/composables/icon";

import UCInput from "@/components/ui/UCInput.vue";
import SettingsOptionButton from "@/components/settings/SettingsOptionButton.vue";
import SettingsAbout from "@/components/settings/SettingsAbout.vue";
import SoftwareUpdate from "@/components/settings/SoftwareUpdate.vue";
import AppDialog from "@/components/elements/AppDialog.vue";

const { t } = useTranslation();
const { sleep } = useTiming();
const route = useRoute();

const currentPage = ref<string>("home");

const appState = appStateStore();
const config = configStore();
const errorMessage = ref("");
const deviceName = ref("");
const backupState = ref("");

const backupApi = ApiConnection.backup;
const systemApi = ApiConnection.system;

const { getFile } = useDownloadFile();
const merge = ref(false);
const file = ref<File | null>(null);
const fileInput = useTemplateRef<HTMLInputElement>("fileInput");
const irApi = ApiConnection.ir;

const downloadingDataset = ref(false);

const dialogRestore =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogRestore");
const dialogReboot =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogReboot");
const elAbout = useTemplateRef<InstanceType<typeof SettingsAbout>>("elAbout");
// `memo-circle-info` is Pro-only; resolve it through the Pro→Free fallback so the
// About row shows a real icon (circle-info) on free-tier deployments instead of a
// tofu box. Returns the icon unchanged when Pro is present.
const aboutIcon = ref("fa-thin fa-circle-info");
const elSoftwareUpdate =
  useTemplateRef<InstanceType<typeof SoftwareUpdate>>("elSoftwareUpdate");
const settingsSection = useTemplateRef<HTMLDivElement>("settingsSection");

const updateStatus = ref<{
  available: boolean;
  errorMessage: string | null;
}>({ available: false, errorMessage: null });

watch(
  () => config.config?.device?.name,
  (name) => {
    if (name) {
      deviceName.value = name;
    }
  },
  { immediate: true },
);

watch(currentPage, (val) => {
  if (val == "software-update") {
    elSoftwareUpdate.value?.checkForUpdate(false);
  }
});

const pageTransition = computed(() => {
  return currentPage.value == "home"
    ? "slide-settings-right"
    : "slide-settings-left";
});

async function changeDeviceName() {
  if (deviceName.value == null || typeof deviceName.value == "undefined") {
    return false;
  }

  const params: ChangeCallbackParams = {
    group: CfgGroups.device,
    name: "name",
    value: deviceName.value,
  };
  onItemChange(params);
}

function clearErrors() {
  if (errorMessage.value.length > 0) {
    errorMessage.value = "";
  }
}

const triggerFileInput = () => {
  if (fileInput.value) {
    fileInput.value.click();
  }
};

async function onItemChange(params: ChangeCallbackParams) {
  try {
    await config.update(
      params.group as string,
      params.name as string,
      params.value,
    );
  } catch (e) {
    addErrorBottom(e, null, settingsSection.value ?? undefined);
  }
}

const goToPage = (page: string) => {
  currentPage.value = page;
};

async function exportBackup() {
  try {
    backupState.value = BackupStates.BACKUPING;
    const result = await backupApi.exportBackup();

    if (result && result.data && result.headers) {
      const contentDisposition = result.headers["content-disposition"];
      const fileName =
        contentDisposition
          ?.split("filename=")[1]
          ?.split(";")[0]
          ?.replaceAll('"', "") || "export.backup";
      getFile(result.data, "application/octet-stream", fileName);
    }
  } catch (error) {
    addErrorFull(error);
  }
  backupState.value = "";
}

async function restore() {
  if (file.value == null) {
    return;
  }

  const params = {
    merge: merge.value,
  } as RestoreBackupParams;

  try {
    addInfoFull(
      FlashMessageInfoStatus.SAVING,
      t("settings.general.restore.message.restoring_backup"),
    );
    backupState.value = BackupStates.UPLOADING;
    await backupApi.restoreBackup(params, file.value);
    backupState.value = BackupStates.RESTART_NEEDED;
    addInfoFull(FlashMessageInfoStatus.SUCCESS);
    await sleep(500);
    dialogReboot.value?.open();
  } catch (e) {
    addErrorFull(e, "settings.general.restore");
    backupState.value = "";
  } finally {
    clearBackupInput();
  }
}

function cancelRestore() {
  clearBackupInput();
}

async function handleFileUpload(ev: Event) {
  const inp = ev.target as HTMLInputElement;
  const files = inp.files as FileList;

  if (files[0] && files[0].name.endsWith(".backup")) {
    file.value = files[0];
    await sleep(100);
    dialogRestore.value?.open();
  } else {
    if (inp) inp.value = "";
  }
}

async function reboot() {
  backupState.value = "";
  try {
    await systemApi.restartRemote();
    appState.setRestarting(true);
  } catch (e) {
    addErrorFull(e);
  }
}

async function downloadDataset(): Promise<void> {
  downloadingDataset.value = true;

  try {
    const result: CodeSetFileData = await irApi.downloadCustomCodeSet();
    if (result && result.data && result.headers) {
      const contentDisposition = result.headers["content-disposition"];
      const fileName =
        contentDisposition
          ?.split("filename=")[1]
          ?.split(";")[0]
          ?.replaceAll('"', "") || "codesets.csv";
      getFile(result.data, "text/csv", fileName);
    }
  } catch (error) {
    console.error(error);
  }

  downloadingDataset.value = false;
}

function clearBackupInput() {
  if (fileInput.value) {
    fileInput.value.value = "";
    file.value = null;
  }
}

onMounted(async () => {
  if (route.query && route.query.action) {
    const action = route.query.action.toString();
    goToPage(action);
  }
  const resolved = await getIconName("fa-circle-info");
  if (resolved) aboutIcon.value = `fa-thin ${resolved}`;
});
</script>
<template>
  <div class="page-settings-wrapper page-settings-wrapper--general">
    <Transition :name="pageTransition">
      <div
        v-show="currentPage === 'home'"
        ref="settingsSection"
        class="page-settings-section"
      >
        <h1 class="page-settings-section__title">
          {{ $t("page.general") }}
        </h1>
        <div class="page-settings-section__main">
          <div class="page-settings-section__remote-name">
            <UCInput
              v-model="deviceName"
              :label="$t('settings.general.remote_name.label')"
              :error-message="errorMessage ? $t(errorMessage) : ''"
              :full-w="true"
              @click="clearErrors"
              @submit="changeDeviceName"
            />
          </div>

          <div class="page-settings-section__main__options">
            <SettingsOptionButton
              :icon="aboutIcon"
              button-icon="fa-light fa-chevron-right"
              :label="$t('settings.general.about.label')"
              :description="$t('settings.general.about.description')"
              :clickable="true"
              @click="goToPage('about')"
            />
            <div class="page-settings-section__divider"></div>
            <SettingsOptionButton
              button-icon="fa-light fa-chevron-right"
              :icon="`fa-thin ${
                updateStatus.errorMessage != null
                  ? 'fa-warning'
                  : updateStatus.available
                    ? 'fa-cloud-arrow-down'
                    : 'fa-circle-check'
              }`"
              :label="$t('settings.general.software_update.label')"
              :description="
                updateStatus.errorMessage ||
                (updateStatus.available
                  ? $t(
                      'settings.general.software_update.status.available_software',
                    )
                  : $t('settings.general.software_update.status.up_to_date'))
              "
              :clickable="true"
              @click="goToPage('software-update')"
            />
            <div class="page-settings-section__divider"></div>
            <SettingsOptionButton
              icon="fa-thin fa-download"
              button-icon="fa-light fa-chevron-right"
              :label="$t('settings.general.backup.label')"
              :description="$t('settings.general.backup.description')"
              :clickable="true"
              @click="goToPage('backup')"
            />
            <div class="page-settings-section__divider"></div>
            <SettingsOptionButton
              icon="fa-thin fa-download"
              :label="$t('settings.general.ir_dataset.label')"
              :description="$t('settings.general.ir_dataset.description')"
              :type="'ir-dataset'"
            >
              <template #extra>
                <img
                  v-if="downloadingDataset"
                  src="/images/loading-indicator.png"
                  alt="Loading"
                  class="img-loading"
                />
                <button
                  v-else
                  class="button button--secondary"
                  @click="downloadDataset"
                >
                  {{ $t("ui.download") }}
                </button>
              </template>
            </SettingsOptionButton>
          </div>
        </div>
      </div>
    </Transition>
    <Transition :name="pageTransition">
      <div v-show="currentPage === 'about'" class="page-settings-section">
        <SettingsAbout ref="elAbout" :back="() => goToPage('home')" />
      </div>
    </Transition>

    <Transition :name="pageTransition">
      <div
        v-show="currentPage === 'software-update'"
        class="page-settings-section"
      >
        <SoftwareUpdate
          ref="elSoftwareUpdate"
          :back="() => goToPage('home')"
          @update-status="(status) => (updateStatus = status)"
        />
      </div>
    </Transition>

    <Transition :name="pageTransition">
      <div
        v-show="currentPage === 'backup'"
        class="page-settings-section page-settings-section--backup"
      >
        <button
          class="button button--secondary button--icon button--icon--medium"
          @click="goToPage('home')"
        >
          <i class="fas fa-arrow-left"></i>
        </button>
        <span class="page-settings-section__page-name">
          {{ $t("settings.general.backup.label") }}
        </span>
        <div class="page-settings-section__main">
          <SettingsOptionButton
            icon="fa-thin fa-download"
            :label="$t('settings.general.backup.label')"
            :description="$t('settings.general.download.description')"
            :type="'backup'"
          >
            <template #extra>
              <img
                v-if="backupState == BackupStates.BACKUPING"
                src="/images/loading-indicator.png"
                alt="Loading"
                class="img-loading"
              />
              <button
                v-else
                class="button button--secondary"
                @click="exportBackup"
              >
                {{ $t("ui.download") }}
              </button>
            </template>
          </SettingsOptionButton>
          <div
            class="page-settings-section__divider page-settings-section__divider--full"
          ></div>
          <SettingsOptionButton
            icon="fa-thin fa-upload"
            :button-label="$t('ui.browse')"
            :label="$t('settings.general.restore.label')"
            :description="$t('settings.general.restore.description')"
            :type="'restore'"
            @click-button="triggerFileInput"
          >
            <template #extra>
              <span v-if="file" class="file-meta">
                <i class="fa-light fa-file"></i>
                {{ file.name }}
              </span>
              <input
                ref="fileInput"
                type="file"
                accept=".backup"
                style="display: none"
                @change="handleFileUpload($event)"
              />
            </template>
          </SettingsOptionButton>
        </div>
      </div>
    </Transition>

    <AppDialog
      ref="dialogRestore"
      :title="$t('settings.general.restore.dialog.title')"
      :text="$t('settings.general.restore.dialog.question')"
      :submit-text="$t('ui.restore')"
      :cancel-text="$t('ui.cancel')"
      @submit="restore"
      @close="cancelRestore"
    />

    <AppDialog
      ref="dialogReboot"
      :title="$t('settings.general.reboot.dialog.title')"
      :text="$t('settings.general.reboot.dialog.question')"
      :submit-text="$t('ui.reboot')"
      :cancel-text="$t('ui.cancel')"
      @submit="reboot"
    />
  </div>
</template>
