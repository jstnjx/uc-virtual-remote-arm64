<script setup lang="ts">
import { ref, computed, watch, onMounted, useTemplateRef } from "vue";
import { useTranslation } from "i18next-vue";

import {
  FlashMessageInfoStatus,
  IrCodeSetType,
  RemoteKind,
} from "@/types/enums";

interface SelectOption {
  label: string;
  value: string;
}

import type { ChangeCallbackParams } from "@/types/config";

import type { Remote, RemoteUpdate } from "@/types/remote";
import type {
  RemoteDataSet,
  IrEmitter,
  IrEmitterPort,
  IrEmitterOption,
  RemoteIrCode,
  CodeSetFileData,
} from "@/types/ir";
import type {
  BluetoothInfo,
  BluetoothPairing,
  BluetoothProfile,
} from "@/types/bluetooth";

import { remotesStore } from "@/stores/remotes";
import { irStore } from "@/stores/ir";
import { bluetoothStore } from "@/stores/bluetooth";
import { addInfoFull, addErrorBottom } from "@/stores/messages";

import {
  getDefaultEntityIcon,
  getPrimaryCommandByEntityState,
  getPrimaryCommandLabel,
} from "@/composables/entity";
import translatedProperty, {
  getCurrentLocale,
  getValueByLang,
} from "@/composables/translatedProperty";
import router from "@/composables/router";
import { useTiming } from "@/composables/timing";
import { useDownloadFile } from "@/composables/downloadFile";
import { useWindowDimension } from "@/composables/windowDimension";
import { normalizeState } from "@/utils/state";
import { deepClone, useDataHelper } from "@/composables/dataHelper";

import UCSearch from "@/components/ui/UCSearch.vue";
import UCInput from "@/components/ui/UCInput.vue";
import UCSelect from "@/components/ui/UCSelect.vue";
import UCToggle from "@/components/ui/UCToggle.vue";
import ErrorBox from "@/components/ui/ErrorBox.vue";
import IconSelect from "@/components/elements/icon/IconSelect.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import ModalSecondary from "@/components/elements/ModalSecondary.vue";
import ModalMinimal from "@/components/elements/ModalMinimal.vue";

import AddIrCode from "@/components/remote-controller/AddIrCode.vue";
import ImportIrCode from "@/components/remote-controller/ImportIrCode.vue";
import AddRemoteBt from "@/components/remote-controller/AddRemoteBt.vue";

interface BtProfile {
  value: string;
  label: string;
}

import ApiConnection from "@/api";
const irApi = ApiConnection.ir;
const integrationsApi = ApiConnection.integrations;

const { t } = useTranslation();
const { getFile } = useDownloadFile();
const { sleep } = useTiming();
const { isSmallScreen } = useWindowDimension();
const { updateExistingObjectKeys, standardizeLangTexts, isNonEmptyObject } =
  useDataHelper();

const storage = remotesStore();
const irStorage = irStore();
const bluetoothStorage = bluetoothStore();

const props = defineProps({
  remoteId: {
    type: String,
    required: true,
  },
});

const remote = ref<Remote | null>(null);
const remoteValues = ref<Record<string, any>>({});

const irDataset = ref<RemoteDataSet | null>(null);
const irEmitters = ref();

const outputDevice = ref<SelectOption>({ label: "", value: "" });
const outputPort = ref<SelectOption>({ label: "", value: "" });

const codesetSearch = ref("");
const codesetList = ref<RemoteIrCode[]>([]);

const assignedCodes = ref<RemoteIrCode[]>([]);

const codeToReset = ref<RemoteIrCode | null>(null);

const loading = ref(false);

const addCode = useTemplateRef<InstanceType<typeof AddIrCode>>("addCode");
const importCode =
  useTemplateRef<InstanceType<typeof ImportIrCode>>("importCode");
const dialogReset =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogReset");
const dialogDeleteAssigned = useTemplateRef<InstanceType<typeof AppDialog>>(
  "dialogDeleteAssigned",
);

const btInfo = ref<BluetoothInfo | null>(null);
const btPairing = ref<BluetoothPairing | null>(null);
const activeBtProfile = ref<BtProfile>({
  value: "default",
  label: t("remote.device_profile.default"),
});
const btProfiles = ref();
const dialogBtUnpair =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogBtUnpair");

const showDeviceProfileModal = ref(false);
const resetButtonMapping = ref(true);
const resetUiConfiguration = ref(true);

const itemToModify = ref<RemoteIrCode | null>(null);
const itemIndexToModify = ref(-1);

const modalDeviceProfile =
  useTemplateRef<InstanceType<typeof ModalSecondary>>("modalDeviceProfile");
const elAddRemoteBt =
  useTemplateRef<InstanceType<typeof AddRemoteBt>>("elAddRemoteBt");
const formWrapper = useTemplateRef<HTMLDivElement>("formWrapper");
const dataSetWrapper = useTemplateRef<HTMLDivElement>("dataSetWrapper");

storage.$onAction(({ name, args, after }) => {
  if (name !== "socketUpdate") {
    return;
  }
  after(() => {
    const { entity_id, event_type } = args[0];
    if (entity_id !== props.remoteId) {
      return;
    }
    if (event_type === "DELETE") {
      router.push({
        name: "entities",
      });
    } else if (
      entity_id === props.remoteId &&
      event_type === "CHANGE" &&
      args[0] &&
      args[0].new_state
    ) {
      const updRemote = updateExistingObjectKeys(
        deepClone(remote.value!),
        args[0].new_state,
        true,
      );
      setRemote(updRemote);
    }
  });
});

watch(codesetSearch, () => {
  assignedCodes.value = [];
  codesetList.value = getCodesetList();
});

const ports = computed(() => {
  if (!outputDevice.value) {
    return [];
  }

  const outDevice = (irEmitters.value || []).find((emitter: IrEmitter) => {
    return outputDevice.value.value === emitter.device_id;
  });

  if (!outDevice) {
    return [];
  }

  return (
    outDevice.ports.map((port: IrEmitterPort) => ({
      label: port.name,
      value: port.port_id,
    })) || []
  );
});

const hasIrEmitterReduced = computed(() => {
  return irEmittersReduced.value && irEmittersReduced.value.length > 0;
});

const hasActiveEmitterReduced = computed(() => {
  if (!hasIrEmitterReduced.value) return false;
  return irEmittersReduced.value.some(
    (item: IrEmitterOption) => item.active === true,
  );
});

const isIRRemote = computed(() => {
  const kind = remote.value?.options?.kind;
  return !kind || kind === RemoteKind.IR;
});

const isBTRemote = computed(() => {
  return remote.value?.options?.kind === RemoteKind.BT;
});

const irEmittersReduced = computed(() => {
  return getEmitters();
});

const irLearnEmittersReduced = computed(() => {
  return getEmitters(true);
});

const isCustomDatasetType = computed(() => {
  return irDataset.value && irDataset.value.type === IrCodeSetType.custom;
});

const isConnected = computed(() => {
  return (
    remote.value &&
    remote.value.attributes &&
    typeof remote.value.attributes.connected !== "undefined" &&
    remote.value.attributes.connected
  );
});

const btProfilesList = computed<BtProfile[]>(() => {
  if (!btProfiles.value || btProfiles.value.length < 1) {
    return [];
  }

  return btProfiles.value.map((item: BluetoothProfile) => ({
    value: item.id,
    label: translatedProperty(item.name),
  }));
});

const showCommandButton = computed(() => {
  if (
    remote.value == null ||
    getPrimaryCommandByEntityState(remote.value) == null
  ) {
    return false;
  }

  return true;
});

function getEmitters(onlyLearn = false) {
  if (!irEmitters.value) {
    return [];
  }

  let irEmitterList = deepClone(irEmitters.value);

  if (onlyLearn == true) {
    irEmitterList = irEmitterList.filter((emitter: IrEmitter) => {
      return (
        emitter.capabilities &&
        emitter.capabilities?.learning &&
        Object.keys(emitter.capabilities?.learning).length > 0
      );
    });
  }

  return irEmitterList.map((emitter: IrEmitter) => ({
    label: !emitter.active
      ? emitter.name + " - " + t("integration.driver.state_inactive")
      : emitter.name,
    value: emitter.device_id,
    active: emitter.active || false,
  }));
}

async function loadRemoteData(onInit = false) {
  try {
    const newValue = await storage.getRemote(props.remoteId);

    if (!newValue || !isNonEmptyObject(newValue)) {
      return false;
    }

    const kind = (newValue as Remote).options?.kind;
    const isIR = !kind || kind === RemoteKind.IR;

    if (isIR) {
      irDataset.value = await storage.getRemoteIrCodes(props.remoteId);
      irEmitters.value = await irStorage.getAll();
    }

    if ((newValue as Remote).options?.kind == RemoteKind.BT) {
      await loadBtData();
    }
    setRemote(newValue, onInit);
  } catch (e) {
    addErrorBottom(e);
  }
}

async function getBtProfiles() {
  try {
    btProfiles.value = await bluetoothStorage.getProfiles();
    if (btInfo.value && btInfo.value != null && btInfo.value.dev_profile_id) {
      const activePr = btProfilesList.value.find(
        (p: BtProfile) => p.value == btInfo.value?.dev_profile_id,
      );
      if (activePr) {
        activeBtProfile.value = activePr;
      }
    }
  } catch (e) {
    addErrorBottom(e);
  }
}

async function loadBtData() {
  try {
    btInfo.value = await bluetoothStorage.getBtInfo(props.remoteId);
    btPairing.value = await bluetoothStorage.getBtPairing(props.remoteId);
    await getBtProfiles();
  } catch (e) {
    addErrorBottom(e);
  }
}

function setRemote(newVal: Remote | undefined, onInit = false) {
  if (!newVal || !isNonEmptyObject(newVal)) {
    return false;
  }

  const newValue = newVal as Remote;
  const nameLang = remoteValues.value.name?.langCode ?? getCurrentLocale();
  const descLang =
    remoteValues.value.description?.langCode ?? getCurrentLocale();

  remote.value = newValue;

  const remoteName = getValueByLang(newValue.name, nameLang, !onInit);
  const remoteDescr = getValueByLang(newValue.description, descLang, !onInit);

  remoteValues.value = {
    icon: newValue.icon || getDefaultEntityIcon(newValue),
    name: {
      value: remoteName.value,
      langCode: remoteName.lang,
    },
    description: {
      value: remoteDescr.value,
      langCode: remoteDescr.lang,
    },
  };

  if (typeof irEmitters.value === "undefined") {
    return;
  }

  const outDevice = irEmitters.value.find(
    (emitter: IrEmitter) =>
      newValue.options?.ir?.output?.device_id === emitter.device_id,
  );

  if (outDevice) {
    outputDevice.value = {
      label: outDevice.name,
      value: outDevice.device_id,
    };

    const outPort = outDevice.ports?.find(
      (port: IrEmitterPort) =>
        newValue.options?.ir?.output?.port_id === port.port_id,
    );

    if (outPort?.name && outPort.port_id) {
      outputPort.value = {
        label: outPort.name,
        value: outPort.port_id,
      };
    }
  }
}

function changeItemIcon(change: ChangeCallbackParams) {
  remoteValues.value.icon = change.value as string;

  if (!remote.value || remote.value == null) {
    return;
  }

  submitChange();
}

function changeItemName(_message: any) {
  if (!remote.value || remote.value == null) {
    return;
  }

  submitChange();
}

function changeItemDescription(_message: any) {
  if (!remote.value || remote.value == null) {
    return;
  }

  submitChange();
}

function changeOutputDevice(item: SelectOption) {
  outputDevice.value = item;

  const outDevice = (irEmitters.value || []).find((emitter: IrEmitter) => {
    return item.value === emitter.device_id;
  });

  if (outDevice && outDevice.ports && outDevice.ports.length > 0) {
    const defaultElement = outDevice.ports[outDevice.ports.length - 1];
    outputPort.value = {
      label: defaultElement.name,
      value: defaultElement.port_id,
    };
  }

  submitChange();
}

function changeOutputPort(item: SelectOption) {
  outputPort.value = item;
  submitChange();
}

function hasChange() {
  if (!remote.value) {
    return false;
  }

  const name = standardizeLangTexts(
    {
      ...(remote.value.name || {}),
      [remoteValues.value.name.langCode]: remoteValues.value.name.value,
    },
    remoteValues.value.name.langCode,
  );
  const description = standardizeLangTexts(
    {
      ...(remote.value.description || {}),
      [remoteValues.value.description.langCode]:
        remoteValues.value.description.value,
    },
    remoteValues.value.description.langCode,
  );

  const remoteUpd: RemoteUpdate = {
    name,
    icon: remoteValues.value.icon,
    description,
    options: {},
  };

  if (
    outputDevice.value &&
    outputDevice.value.value &&
    outputDevice.value.value.length > 0 &&
    outputPort.value &&
    outputPort.value.value &&
    outputPort.value.value.length > 0
  ) {
    (remoteUpd.options as any).ir = {
      output: {
        device_id: outputDevice.value.value,
        port_id: outputPort.value.value,
      },
    };
  }

  if (remote.value && isBTRemote.value && activeBtProfile.value) {
    (remoteUpd.options as any).bt = {
      dev_profile_id: activeBtProfile.value.value,
    };
  }

  return remoteUpd;
}

async function submitChange() {
  if (!remote.value) {
    return;
  }

  const modifiedRemote: RemoteUpdate | false = hasChange();
  if (!modifiedRemote) {
    return;
  }

  try {
    const newValue = (await storage.update(
      remote.value.entity_id,
      modifiedRemote,
    )) as Remote;
    setRemote(newValue);
  } catch (e) {
    addErrorBottom(e);
  }
}

function changeItemNameLang(lang: string) {
  remoteValues.value.name.langCode = lang;

  if (remote.value) {
    remoteValues.value.name.value = getValueByLang(
      remote.value.name,
      lang,
      true,
    ).value;
  }
}

function changeItemDescriptionLang(lang: string) {
  remoteValues.value.description.langCode = lang;

  if (remote.value) {
    remoteValues.value.description.value = getValueByLang(
      remote.value.description,
      lang,
      true,
    ).value;
  }
}

function getCodesetList() {
  const search = codesetSearch.value.toLowerCase();
  if (!irDataset.value) {
    return [];
  }

  return (irDataset.value.codes || []).filter((item) => {
    return item.cmd_id.toLowerCase().includes(search);
  });
}

async function executeCommand() {
  if (!remote.value) {
    return;
  }

  const command = getPrimaryCommandByEntityState(remote.value);
  if (command != null) {
    try {
      await integrationsApi.executeEntityCommand(
        remote.value.entity_id,
        command,
      );
    } catch (e) {
      addErrorBottom(e, null, formWrapper.value ?? undefined);
    }
  }
}

async function downloadDataset() {
  if (irDataset.value && irDataset.value.id) {
    try {
      const result: CodeSetFileData = await irApi.downloadCustomCodeSet(
        irDataset.value.id,
      );

      if (result && result.data && result.headers) {
        const fileName =
          result.headers["content-disposition"]
            .split("filename=")[1]
            .split(";")[0]
            .replaceAll('"', "") || `codesets.csv`; // with fallback
        getFile(result.data, "text/csv", fileName);
      }
    } catch (e) {
      addErrorBottom(e);
    }
  }
}

async function testCommand(code: RemoteIrCode) {
  if (isSmallScreen) {
    closeItemModify();
  }

  try {
    await irApi.sendTestCodeToRemote(props.remoteId as string, code.cmd_id);
  } catch (e) {
    addErrorBottom(e);
  }
}

function startResetCode(code: RemoteIrCode) {
  if (isSmallScreen) {
    closeItemModify();
  }

  codeToReset.value = code;
  dialogReset.value?.open();
}

async function resetCode(codes: RemoteIrCode[] = []) {
  let rmCodes = [];
  if (codes.length > 0) {
    rmCodes = codes;
  } else if (codeToReset.value != null) {
    rmCodes.push(codeToReset.value);
  } else {
    return;
  }
  try {
    for (const code of rmCodes) {
      await storage.removeCustomCodeFromSet(props.remoteId, code.cmd_id);
    }
    await loadRemoteData();
    codesetList.value = getCodesetList();
    codeToReset.value = null;
    if (codes.length > 0) {
      assignedCodes.value = [];
    }
  } catch (e) {
    addErrorBottom(e, null, dataSetWrapper.value ?? undefined);
  }
}

function deleteAssignedCodes() {
  resetCode(assignedCodes.value);
}

function isAssignedItem(code: RemoteIrCode) {
  return (
    assignedCodes.value.findIndex(
      (c: RemoteIrCode) => code.cmd_id === c.cmd_id,
    ) > -1
  );
}

function toggleItemCheckbox(code: RemoteIrCode) {
  const itemIndex = assignedCodes.value.findIndex(
    (c: RemoteIrCode) => code.cmd_id === c.cmd_id,
  );
  if (itemIndex > -1) {
    assignedCodes.value.splice(itemIndex, 1);
  } else {
    assignedCodes.value.push(code);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- ADR 0004: used by the commented-out deferred edit-profile button
function editDeviceProfile() {
  console.log("TODO: editDeviceProfile");
}

function startUpdateBtProfile(item: BtProfile) {
  activeBtProfile.value = item;
  resetButtonMapping.value = true;
  resetUiConfiguration.value = true;
  showDeviceProfileModal.value = true;
}

function closedDeviceProfileModal() {
  cancelChangeBtProfile();
  showDeviceProfileModal.value = false;
}

function cancelChangeBtProfile() {
  if (remote.value && isBTRemote.value) {
    getBtProfiles();
  }
}

async function resetAllButton() {
  try {
    const newValue = await storage.allButtonsReset(props.remoteId);
    setRemote(newValue);
  } catch (e) {
    addErrorBottom(e);
  }
}

async function resetAllUi() {
  try {
    const newValue = await storage.allUiReset(props.remoteId);
    setRemote(newValue);
  } catch (e) {
    addErrorBottom(e);
  }
}

async function updateBtProfile() {
  try {
    await submitChange();

    if (resetButtonMapping.value) {
      await resetAllButton();
    }

    if (resetUiConfiguration.value) {
      await resetAllUi();
    }
  } catch (e) {
    addErrorBottom(e);
  }

  modalDeviceProfile.value?.triggerClose();
}

function startBtPairing() {
  elAddRemoteBt.value?.startPairing(remote.value);
}

function closedAddIrCode() {
  loadData();
}

function closePairing() {
  loadBtData();
}

async function btUnpair() {
  try {
    if (props.remoteId) {
      addInfoFull(FlashMessageInfoStatus.SAVING);
      await bluetoothStorage.removeBtPairing(props.remoteId);
      await sleep(2000);
      btPairing.value = await bluetoothStorage.getBtPairing(props.remoteId);
      addInfoFull(FlashMessageInfoStatus.SUCCESS);
    }
  } catch (e) {
    addErrorBottom(e, null, formWrapper.value ?? undefined);
  }
}

async function loadData(onInit = false) {
  await loadRemoteData(onInit);
  codesetList.value = getCodesetList();
}

async function openItemModify(item: RemoteIrCode, index: number) {
  itemToModify.value = item;
  itemIndexToModify.value = index;
}

function closeItemModify() {
  itemToModify.value = null;
  itemIndexToModify.value = -1;
}

async function openAddCode(item: RemoteIrCode) {
  closeItemModify();
  await sleep(100);
  addCode.value?.open(item, true);
}

onMounted(async () => {
  try {
    loading.value = true;
    await loadData(true);
  } catch (e) {
    addErrorBottom(e);
  }
  loading.value = false;
});
</script>
<template>
  <div class="ep-settings">
    <div v-overflow-indicator class="ep-settings__form panel-col panel-col--40">
      <div ref="formWrapper" class="ep-settings__form__wrapper">
        <div class="ep-settings__form__header">
          <IconSelect
            :key="
              remoteValues && remoteValues.icon
                ? remoteValues.icon
                : 'fa-light fa-clapperboard'
            "
            :value="
              remoteValues && remoteValues.icon
                ? remoteValues.icon
                : 'fa-light fa-clapperboard'
            "
            :fallback="'fa-light fa-clapperboard'"
            :change-callback="changeItemIcon"
          />
          <div
            v-if="remote && remote.options && (isIRRemote || isBTRemote)"
            class="ep-settings__form__header__remote-type"
          >
            <template v-if="isIRRemote">
              <i class="fa-light fa-tower-broadcast"></i>
              <span>{{ $t("remote.infrared") }}</span>
            </template>
            <template v-else-if="isBTRemote">
              <i class="fa-light fa-bluetooth"></i>
              <span>Bluetooth</span>
            </template>
          </div>
        </div>
        <UCInput
          v-if="remoteValues.name"
          v-model="remoteValues.name"
          :translations="remote?.name"
          :has-lang="true"
          :full-w="true"
          :label="$t('form.name')"
          @submit="changeItemName"
          @change-lang="changeItemNameLang"
        />
        <UCInput
          v-if="remoteValues.description"
          v-model="remoteValues.description"
          :translations="remote?.description"
          :type="'textarea'"
          :has-lang="true"
          :full-w="true"
          :label="$t('form.description')"
          @submit="changeItemDescription"
          @change-lang="changeItemDescriptionLang"
        />
        <template v-if="remote && remote.options && isIRRemote">
          <div class="select-extra select-extra--output_device">
            <div class="select-extra__text">
              <span class="select-extra__label">
                {{ $t("remote.label.infrared_output_device") }}
              </span>
            </div>
            <UCSelect
              v-if="hasIrEmitterReduced"
              v-model="outputDevice"
              :options="irEmittersReduced"
              :dynamic-width="true"
              :dynamic-position="true"
              :light="true"
              @select="changeOutputDevice"
            />
            <ErrorBox
              v-else
              :message="$t('remote.no_output_device')"
              :width-flex="true"
            />
          </div>
          <div
            class="select-extra select-extra--output_port"
            :class="{ 'select-extra--disabled': !hasIrEmitterReduced }"
          >
            <div class="select-extra__text">
              <span class="select-extra__label">
                {{ $t("remote.label.infrared_output_port") }}
              </span>
            </div>
            <UCSelect
              v-model="outputPort"
              :options="ports"
              :dynamic-width="true"
              :dynamic-position="true"
              :light="true"
              @select="changeOutputPort"
            />
          </div>
        </template>
        <template v-else-if="remote && remote.options && isBTRemote">
          <div v-if="btInfo && btInfo.profile" class="ep-settings__form__row">
            <div class="ep-settings__form__meta">
              <span class="ep-settings__form__meta__label">
                {{ $t("remote.bluetooth.connection_number") }}
              </span>
            </div>
            <div class="ep-settings__form__meta">
              <span class="ep-settings__form__meta__label">{{
                btInfo.profile
              }}</span>
            </div>
          </div>
          <div v-if="btInfo" class="ep-settings__form__row">
            <div class="ep-settings__form__meta">
              <span class="ep-settings__form__meta__label">
                <template v-if="isConnected">{{
                  $t("remote.bluetooth.connection.connected")
                }}</template>
                <template v-else>{{
                  $t("remote.bluetooth.connection.disconnected")
                }}</template>
              </span>
            </div>
            <div
              class="ep-settings__form__meta ep-settings__form__meta--item-status ep-settings__form__meta--item-status--simple"
              :class="`ep-settings__form__meta--${
                isConnected ? 'green' : 'red'
              }`"
            >
              <i
                class="fa-light"
                :class="isConnected ? 'fa-circle-check' : 'fa-circle-xmark'"
              ></i>
            </div>
          </div>

          <div
            v-if="btInfo && btProfilesList && btProfilesList.length > 0"
            class="ep-settings__form__row ep-settings__form__row--device-profile"
          >
            <div class="ep-settings__form__meta">
              <span class="ep-settings__form__meta__label">
                {{ $t("remote.bluetooth.device_profile") }}
                <!-- <button @click="editDeviceProfile" class="ep-settings__form__meta__button">
                  <i class="fa-regular fa-edit"></i>
                </button> -->
              </span>
            </div>
            <div class="ep-settings__form__meta">
              <UCSelect
                v-model="activeBtProfile"
                :options="btProfilesList"
                :dynamic-width="true"
                :dynamic-position="true"
                :light="true"
                @select="startUpdateBtProfile"
              />
            </div>
          </div>
          <div v-if="btPairing" class="ep-settings__form__row">
            <div class="ep-settings__form__meta">
              <span class="ep-settings__form__meta__label">
                <template v-if="btPairing && btPairing.paired">{{
                  $t("remote.bluetooth.pair_state.paired")
                }}</template>
                <template v-else>{{
                  $t("remote.bluetooth.pair_state.unpaired")
                }}</template>
              </span>
            </div>
            <div class="ep-settings__form__meta">
              <div class="ep-settings__form__meta__label">
                <template v-if="btPairing && btPairing.paired">
                  <template
                    v-if="btPairing && btPairing.peer && btPairing.peer.address"
                    >{{ btPairing.peer.address }}</template
                  >
                  <button
                    class="button button--secondary button--icon button--icon--small button-unpair"
                    @click="dialogBtUnpair?.open()"
                  >
                    <i class="fa-regular fa-close"></i>
                  </button>
                </template>
                <button
                  v-else
                  class="button button--secondary button--min-w"
                  @click="startBtPairing"
                >
                  {{ $t("remote.bluetooth.pair") }}
                </button>
              </div>
            </div>
          </div>
        </template>
        <div v-if="remote" class="ep-settings__form__footer">
          <div
            v-if="remote.options && isIRRemote"
            class="ep-settings__form__footer__row"
          >
            <div class="ep-settings__form__meta">
              <template v-if="remote.attributes && remote.attributes?.state">
                <span class="ep-settings__form__meta__label">{{
                  $t("entity.label.state")
                }}</span>
                <span class="ep-settings__form__meta__value">{{
                  $t(`entity.state.${normalizeState(remote.attributes?.state)}`)
                }}</span>
              </template>
            </div>
            <button
              v-if="showCommandButton"
              class="button button--secondary button-toggle"
              @click="executeCommand"
            >
              {{ getPrimaryCommandLabel(remote) }}
            </button>
          </div>
          <div class="ep-settings__form__footer__row">
            <div class="ep-settings__form__meta">
              <span class="ep-settings__form__meta__label">{{
                $t("entity.label.ID", "ID")
              }}</span>
              <span class="ep-settings__form__meta__value">{{
                remote.entity_id
              }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div
      v-if="remote && remote.options && isIRRemote"
      class="ep-settings__ir-code-data-set panel-col panel-col--60"
    >
      <div ref="dataSetWrapper" class="ep-settings__ir-code-data-set__wrapper">
        <div class="ir-code-data-set__list__header">
          <div class="ir-code-data-set__list__header__top">
            <span>
              {{ $t("remote.ir_code.title") }}
            </span>

            <div class="ir-code-data-set__list__header__options">
              <button
                class="button button--secondary button--icon"
                @click="addCode?.open()"
              >
                <i class="fa-light fa-plus"></i>
              </button>
              <button
                v-if="isCustomDatasetType"
                class="button button--secondary button--icon"
                @click="importCode?.open()"
              >
                <i class="fa-light fa-upload"></i>
              </button>
              <button
                v-if="isCustomDatasetType"
                class="button button--secondary button--icon"
                @click="downloadDataset"
              >
                <i class="fa-light fa-download"></i>
              </button>
              <Transition name="opacity-fast">
                <button
                  v-show="assignedCodes.length > 0"
                  class="button button--secondary button--icon"
                  @click="dialogDeleteAssigned?.open()"
                >
                  <i class="fa-light fa-trash"></i>
                </button>
              </Transition>
            </div>
          </div>
          <div class="ir-code-data-set__list__header__search">
            <UCSearch v-model="codesetSearch" :small="true" />
          </div>
        </div>
        <div v-overflow-indicator class="ir-code-data-set__list__body">
          <div
            v-for="(item, index) in codesetList"
            :key="item.cmd_id"
            class="ir-code-data-set__item"
          >
            <div class="ir-code-data-set__item__select">
              <div
                v-if="item.custom || isCustomDatasetType"
                class="form-item form-item--checkbox-tick"
              >
                <input
                  :id="`${item.cmd_id}-checkbox-tick`"
                  type="checkbox"
                  :checked="isAssignedItem(item)"
                />
                <label class="toggle" :for="`${item.cmd_id}-checkbox-tick`" />
                <button
                  class="button--toggle-tick"
                  @click="toggleItemCheckbox(item)"
                ></button>
              </div>
            </div>
            <span class="ir-code-data-set__item__name">
              {{ item.cmd_id }}
              <span
                v-if="item.custom"
                class="ir-code-data-set__item__badge-custom"
              >
                {{ $t("ui.custom") }}
              </span>
            </span>
            <div class="ir-code-data-set__item__options">
              <span
                v-if="isSmallScreen"
                class="entity-item__quick-options"
                @click="openItemModify(item, index)"
              >
                <i class="fa-regular fa-ellipsis-vertical"></i>
              </span>
              <template v-else>
                <button
                  class="button button--blank button--icon"
                  @click="addCode?.open(item, true)"
                >
                  <i class="fa-light fa-edit"></i>
                </button>
                <button
                  :disabled="!hasIrEmitterReduced || !hasActiveEmitterReduced"
                  class="button button--blank button--blank--focus button--icon"
                  @click="testCommand(item)"
                >
                  <i class="fa-light fa-play"></i>
                </button>
                <button
                  v-if="isCustomDatasetType || item.custom || item.modified"
                  class="button button--blank button--icon"
                  @click="startResetCode(item)"
                >
                  <i
                    v-if="isCustomDatasetType || item.custom"
                    class="fa-light fa-trash"
                  ></i>
                  <i v-else class="fa-light fa-arrow-rotate-left"></i>
                </button>
                <span v-else class="ir-code-data-set__item__spacer"></span>
              </template>
            </div>
            <span
              class="ir-code-data-set__item__indicator"
              :title="$t('ui.modified')"
            >
              <span v-if="item.modified"></span>
            </span>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="ep-settings__no-settings panel-col panel-col--60">
      <p>{{ $t("entity.no_other_settings") }}</p>
    </div>

    <template v-if="remote && remote.options && isIRRemote">
      <AddIrCode
        ref="addCode"
        :remote-id="remoteId"
        :ir-dataset="irDataset || {}"
        :ir-emitters="irEmitters || []"
        :emitter-options="irEmittersReduced || []"
        :learn-emitter-options="irLearnEmittersReduced || []"
        @close="closedAddIrCode"
      />
      <ImportIrCode
        ref="importCode"
        :ir-dataset="irDataset || {}"
        @reload-ir-dataset="loadData"
      />
      <AppDialog
        ref="dialogReset"
        :title="
          codeToReset && (isCustomDatasetType || codeToReset.custom)
            ? $t('remote.ir_code.delete.title')
            : $t('remote.ir_code.reset.title')
        "
        :text="
          codeToReset && (isCustomDatasetType || codeToReset.custom)
            ? $t('remote.ir_code.delete.question')
            : $t('remote.ir_code.reset.question')
        "
        :submit-text="
          codeToReset && (isCustomDatasetType || codeToReset.custom)
            ? $t('ui.delete')
            : $t('ui.reset')
        "
        :cancel-text="$t('ui.cancel')"
        @submit="resetCode"
      />
      <AppDialog
        ref="dialogDeleteAssigned"
        :title="
          assignedCodes.length > 1
            ? $t('remote.ir_code.delete_codes.title')
            : $t('remote.ir_code.delete.title')
        "
        :text="
          assignedCodes.length > 1
            ? $t('remote.ir_code.delete_codes.question')
            : $t('remote.ir_code.delete.question')
        "
        :submit-text="$t('ui.delete')"
        :cancel-text="$t('ui.cancel')"
        @submit="deleteAssignedCodes"
      />
      <Teleport to="body">
        <ModalMinimal
          :show="itemToModify != null"
          :name="'modal-ir-code-options'"
          class="modal-minimal--item-options"
          @close="closeItemModify"
        >
          <div v-if="itemToModify != null" class="modal-minimal__list">
            <button @click="openAddCode(itemToModify)">
              <i class="fa-light fa-pencil"></i>
              <span>{{ $t("ui.edit") }}</span>
            </button>
            <button
              v-if="hasIrEmitterReduced && hasActiveEmitterReduced"
              @click="testCommand(itemToModify)"
            >
              <i class="fa-light fa-play"></i>
              <span>{{ $t("ui.send") }}</span>
            </button>
            <button
              v-if="
                isCustomDatasetType ||
                itemToModify.custom ||
                itemToModify.modified
              "
              @click="startResetCode(itemToModify)"
            >
              <i
                v-if="isCustomDatasetType || itemToModify.custom"
                class="fa-light fa-trash"
              ></i>
              <i v-else class="fa-light fa-arrow-rotate-left"></i>
              <span>
                <template v-if="isCustomDatasetType || itemToModify.custom">{{
                  $t("ui.delete")
                }}</template>
                <template v-else>{{ $t("ui.reset") }}</template>
              </span>
            </button>
          </div>
        </ModalMinimal>
      </Teleport>
    </template>
    <template v-if="remote && remote.options && isBTRemote">
      <Teleport to="body">
        <ModalSecondary
          ref="modalDeviceProfile"
          :show="showDeviceProfileModal"
          :width="'28.75rem'"
          :name="'modal-change-device-profile'"
          class="change-device-profile"
          @close="closedDeviceProfileModal"
        >
          <template #header>
            {{ $t("remote.change_device_profile.title") }}
          </template>
          <p class="change-device-profile__message">
            {{ $t("remote.change_device_profile.message") }}
          </p>

          <UCToggle
            v-model="resetButtonMapping"
            :label="$t('remote.change_device_profile.reset_button_mapping')"
            :full-w="true"
          />

          <UCToggle
            v-model="resetUiConfiguration"
            :label="$t('remote.change_device_profile.reset_ui_configuration')"
            :full-w="true"
          />

          <template #footer>
            <button class="button button--secondary" @click="updateBtProfile">
              {{ $t("ui.confirm") }}
            </button>
            <button
              class="button button--tertiary"
              @click="modalDeviceProfile?.triggerClose()"
            >
              {{ $t("ui.cancel") }}
            </button>
          </template>
        </ModalSecondary>
      </Teleport>

      <AppDialog
        ref="dialogBtUnpair"
        :title="$t('remote.bluetooth.forget_device.title')"
        :text="$t('remote.bluetooth.forget_device.question')"
        :text-center="true"
        :icon="'fa-thin fa-trash-can'"
        :icon-type="'red'"
        :submit-text="$t('ui.confirm')"
        :cancel-text="$t('ui.cancel')"
        @submit="btUnpair"
      />

      <AddRemoteBt
        ref="elAddRemoteBt"
        :only-pairing="true"
        @close="closePairing"
      />
    </template>
  </div>
</template>
