<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";
import { useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import ApiConnection from "@/api";

import {
  CfgGroups,
  RemoteBluetoothSetup,
  RemoteKind,
  FlashMessageInfoStatus,
} from "@/types/enums";
import type {
  BluetoothRemote,
  BluetoothProfile,
  BluetoothRemoteNewData,
} from "@/types/bluetooth";
import type { Remote } from "@/types/remote";

import { configStore } from "@/stores/config";
import type { ChangeCallbackParams } from "@/types/config";
import { bluetoothStore } from "@/stores/bluetooth";
import { remotesStore } from "@/stores/remotes";
import {
  addInfoFull,
  addErrorFull,
  addErrorBottom,
  hideMessage,
} from "@/stores/messages";

import { errorOnChange } from "@/composables/error";
import translatedProperty, {
  getCurrentLocale,
} from "@/composables/translatedProperty";
import { useTiming } from "@/composables/timing";
import { focusInput } from "@/composables/device";

import AppModal from "@/components/elements/AppModal.vue";
import UCInput from "@/components/ui/UCInput.vue";
import UCSelect from "@/components/ui/UCSelect.vue";
import UCCodeInput from "@/components/ui/UCCodeInput.vue";
import IconSelect from "@/components/elements/icon/IconSelect.vue";
import { deepClone } from "@/composables/dataHelper";

const { t } = useTranslation();
const { sleep } = useTiming();
const router = useRouter();

defineExpose({
  startPairing,
  open,
});

const props = defineProps({
  value: {
    type: String,
    default: null,
  },
  changeCallback: {
    type: Function,
    default: null,
  },
  onlyPairing: {
    type: Boolean,
    default: false,
  },
});
const emit = defineEmits(["close"]);

const remoteSkeleton = {
  name: "",
  icon: "fa-bluetooth",
  description: "",
};

const remotesApi = ApiConnection.remotes;

const newRemote = ref(deepClone(remoteSkeleton));

const config = configStore();
const bluetoothStorage = bluetoothStore();
const remotesStorage = remotesStore();

const deviceProfiles = ref();
const remote = ref<BluetoothRemote | Remote | null>(null);
const activeStep = ref("");
const slideRight = ref(false);
const deviceProfile = ref({
  value: "default",
  label: t("remote.add_device_bt.device_profile.default"),
});
const pin = ref("");
const peripheralConnections = ref(5);
const createdRemoteNumber = ref(0);
const pairingKind = ref("");
const btPairingData = ref();
const btPiaringID = ref<number | null>(null);
const peerAddress = ref<string | null>("");

const messageFail = ref("");
const saving = ref(false);
const emptyName = ref(false);
const btEnabled = ref(false);

const pinInput = useTemplateRef<InstanceType<typeof UCCodeInput>>("pinInput");

/**
 * Gates the add-step button. Same predicate as `startPairing`, so the two cannot
 * disagree — and inert in pairing-only mode, which renders no name field at all.
 */
const isNameValid = computed(
  () => props.onlyPairing == true || newRemote.value.name.trim().length > 0,
);

watch(
  () => bluetoothStorage.pairingEvent,
  (pairingEvent) => {
    if (activeStep.value && activeStep.value.length < 1) {
      return;
    }

    if (pairingEvent) {
      if (
        pairingEvent.msg == "bt_pairing_auth_request" &&
        pairingEvent.msg_data.kind
      ) {
        pairingKind.value = pairingEvent.msg_data.kind;
        btPiaringID.value = pairingEvent.msg_data.id;
        peerAddress.value = pairingEvent.msg_data.peer?.address || null;
        goToStep(RemoteBluetoothSetup.CODE_INPUT);
        messageFail.value = "";
      } else if (
        activeStep.value.length > 0 &&
        pairingEvent.msg == "bt_pairing_complete"
      ) {
        if (pairingEvent.msg_data.success) {
          goToStep(RemoteBluetoothSetup.SUCCESS);
        } else {
          goToStep(RemoteBluetoothSetup.FAIL);
          messageFail.value = pairingEvent.msg_data.reason
            ? t(`remote.add_device_bt.message.${pairingEvent.msg_data.reason}`)
            : "";
        }
      }
    }
  },
);

watch(activeStep, async () => {
  if (activeStep.value == RemoteBluetoothSetup.ADD) {
    btEnabled.value = config.config?.network?.bt_enabled ?? false;

    if (btEnabled.value == false) {
      goToStep(RemoteBluetoothSetup.DISABLED_BT);
      return false;
    }

    if (config.config && config.config?.bt?.peripheral_connections) {
      peripheralConnections.value = config.config?.bt?.peripheral_connections;
      getCreatedRemoteNumber();
      getDeviceProfiles();
    }
  }

  if (activeStep.value == RemoteBluetoothSetup.CODE_INPUT) {
    await sleep(500);
    if (pinInput.value) {
      pinInput.value.resetValues();
    }
  }

  if (activeStep.value.length < 1) {
    fetchRemoteBtList();
  }

  const modalAddRemoteBt = document.querySelector(
    ".modal--add.add-remote-bt",
  ) as HTMLElement;
  if (modalAddRemoteBt) {
    focusInput(modalAddRemoteBt, true);
  }
});

const deviceProfilesList = computed(() => {
  if (!deviceProfiles.value || deviceProfiles.value.length < 1) {
    return [];
  }

  return deviceProfiles.value.map((item: BluetoothProfile) => ({
    value: item.id,
    label: translatedProperty(item.name),
  }));
});

async function fetchRemoteBtList() {
  try {
    await remotesStorage.getAll(RemoteKind.BT);
  } catch (e) {
    addErrorFull(e);
  }
}

const stepTransition = computed(() => {
  return slideRight.value == true ? "slide-tab-right" : "slide-tab-left";
});

async function getCreatedRemoteNumber() {
  try {
    createdRemoteNumber.value = await remotesApi.getItemNumber(RemoteKind.BT);

    if (createdRemoteNumber.value >= peripheralConnections.value) {
      goToStep(RemoteBluetoothSetup.NO_SLOT);
    }
  } catch (e) {
    addErrorFull(e);
  }
}

async function getDeviceProfiles() {
  try {
    deviceProfiles.value = await bluetoothStorage.getProfiles();
  } catch (e) {
    addErrorFull(e);
  }
}

async function startPairing(currentRemote: Remote | null = null) {
  if (currentRemote && currentRemote != null) {
    remote.value = currentRemote;
  }

  // The add-step button is disabled while this holds; kept for the paths that
  // reach here without it.
  if (!isNameValid.value) {
    return (emptyName.value = true);
  }

  if (props.onlyPairing == false) {
    try {
      await createRemote();
    } catch (e) {
      addErrorFull(e);
    }
  }

  if (remote.value == null || remote.value.entity_id.length < 1) {
    return false;
  }

  try {
    btPairingData.value = await bluetoothStorage.getBtPairing(
      remote.value.entity_id,
    );
  } catch (e) {
    addErrorFull(e);
  }

  if (!btPairingData.value) {
    return false;
  }

  try {
    await bluetoothStorage.changeBtPairing(remote.value.entity_id, true);
    goToStep(RemoteBluetoothSetup.WAITING);
  } catch (e) {
    addErrorFull(e);
  }
}

async function createRemote() {
  saving.value = true;

  const deviceName = newRemote.value.name || "";
  const deviceDescr = newRemote.value.description || "";
  const iconRegex = /fa-/;
  const iconValue = newRemote.value.icon.replace(iconRegex, "uc:");

  const newData = {
    name: {
      [getCurrentLocale()]: deviceName,
    },
    description: {
      [getCurrentLocale()]: deviceDescr,
    },
    icon: iconValue,
    kind: RemoteKind.BT,
    bt: {
      dev_profile_id: deviceProfile.value.value,
    },
  } as BluetoothRemoteNewData;

  try {
    remote.value = await bluetoothStorage.create(newData);
  } catch (e) {
    addErrorFull(e);
  }
  saving.value = false;
}

function clearErrors() {
  if (emptyName.value === true) {
    emptyName.value = false;
  }
}

async function deleteRemote() {
  if (props.onlyPairing == true || remote.value == null) {
    return false;
  }

  try {
    await remotesStorage.delete(remote.value);
  } catch (e) {
    errorOnChange(e);
  }
}

async function cancel() {
  if (saving.value) {
    return false;
  }

  if (
    remote.value &&
    remote.value.entity_id &&
    remote.value.entity_id?.length > 1
  ) {
    addInfoFull(FlashMessageInfoStatus.SAVING, t("notification.cancelling"));

    if (btPiaringID.value && btPiaringID.value != null) {
      try {
        const data = {
          id: btPiaringID.value,
          confirm: false,
          decline: true,
        };
        await bluetoothStorage.updateBtPairing(remote.value.entity_id, data);
      } catch (e) {
        errorOnChange(e);
      }
    }

    try {
      await bluetoothStorage.removeBtPairing(remote.value.entity_id);
    } catch (e) {
      errorOnChange(e);
    }
    await deleteRemote();
    hideMessage();

    closeModal();
  } else {
    closeModal();
  }
}

function clickClose() {
  if (activeStep.value == RemoteBluetoothSetup.SUCCESS) {
    closeModal();
  } else {
    cancel();
  }
}

async function confirm() {
  if (btPiaringID.value == null || remote.value == null) {
    return false;
  }

  let data;
  if (pairingKind.value == "PASSKEY_INPUT") {
    data = {
      id: btPiaringID.value,
      passkey: pin.value,
    };
  } else {
    data = {
      id: btPiaringID.value,
      confirm: true,
    };
  }

  try {
    await bluetoothStorage.updateBtPairing(remote.value.entity_id, data);
  } catch (e) {
    errorOnChange(e);
  }
}

function customise() {
  if (remote.value && remote.value?.entity_id) {
    router.push({
      name: "remote",
      params: { remote_id: remote.value.entity_id },
    });
    closeModal();
  }
}

function changeActivityIcon(params: ChangeCallbackParams) {
  const { value } = params;
  if (newRemote.value) {
    newRemote.value.icon = value as string;
  }
}

function onPinChanges(val: string) {
  pin.value = val;
}

function submitCodeInput() {
  if (pin.value.length > 5) {
    confirm();
  }
}

async function turnOnBt() {
  const params: ChangeCallbackParams = {
    group: CfgGroups.network,
    name: "bt_enabled",
    value: true,
  };
  try {
    await config.update(
      params.group as string,
      params.name as string,
      params.value,
    );
    goToStep(RemoteBluetoothSetup.ADD);
  } catch (e) {
    addErrorBottom(e);
  }
  btEnabled.value = config.$state.config?.network?.bt_enabled ?? false;
}

function goToStep(step: string) {
  const stepList = Object.keys(RemoteBluetoothSetup);
  slideRight.value =
    stepList.indexOf(step) < stepList.indexOf(activeStep.value) ? true : false;
  activeStep.value = step;
}

function open() {
  activeStep.value = RemoteBluetoothSetup.ADD;
}

async function closeModal() {
  deviceProfile.value = {
    value: "default",
    label: t("remote.device_profile.default"),
  };
  pin.value = "";
  pairingKind.value = "";
  btPiaringID.value = null;
  messageFail.value = "";
  newRemote.value = deepClone(remoteSkeleton);
  remote.value = null;
  bluetoothStorage.resetPairingEvent();
  activeStep.value = "";
  peerAddress.value = null;
  emit("close");
}
</script>
<template>
  <Teleport to="body">
    <AppModal
      :show="activeStep.length > 0"
      name="add-remote-bt"
      class="modal--steps modal--add add-remote-bt"
      @closing="clickClose"
    >
      <template #header>
        {{ $t("remote.add_device_bt.title") }}
      </template>

      <!-- ADD -->
      <Transition :name="stepTransition">
        <div
          v-show="activeStep == RemoteBluetoothSetup.ADD"
          class="modal__body__step add-remote-bt__step add-remote-bt__step--add"
        >
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data"
          >
            <IconSelect
              :key="newRemote.icon ? newRemote.icon : 'fa-thin fa-bluetooth'"
              :value="newRemote.icon ? newRemote.icon : 'fa-thin fa-bluetooth'"
              :change-callback="changeActivityIcon"
              :fallback="'fa-thin fa-bluetooth'"
            />
            <UCInput
              v-model="newRemote.name"
              :label="$t('form.name')"
              :error-message="
                emptyName ? $t('remote.add_device_bt.error.empty_name') : ''
              "
              :full-w="true"
              :focus="true"
              @click="clearErrors"
            />
            <UCInput
              v-model="newRemote.description as string"
              :type="'textarea'"
              :label="$t('form.description')"
              :full-w="true"
              @click="clearErrors"
            />

            <div class="select-extra select-extra--device-profile">
              <div class="select-extra__text">
                <span class="select-extra__label">
                  {{ $t("remote.add_device_bt.device_profile.label") }}
                </span>
              </div>
              <UCSelect
                v-model="deviceProfile"
                :options="deviceProfilesList"
                :dynamic-width="true"
                :dynamic-position="true"
                :light="true"
              />
            </div>

            <p class="add-remote-bt__info">
              {{ $t("remote.add_device_bt.device_profile.info") }}
              <a
                href="https://support.unfoldedcircle.com/hc/en-us/articles/14696263809436-Device-profiles"
                target="_blank"
                >{{ $t("remote.add_device_bt.device_profile.learn_more") }}</a
              >
            </p>
          </div>
        </div>
      </Transition>

      <!-- DISABLED BT -->
      <Transition :name="stepTransition">
        <div
          v-show="activeStep == RemoteBluetoothSetup.DISABLED_BT"
          class="modal__body__step add-remote-bt__step add-remote-bt__step--disabled-bt"
        >
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data"
          >
            <span
              class="add-remote-bt__step__icon add-remote-bt__step__icon--red"
            >
              <i class="fa-light fa-warning"></i>
            </span>
            <span class="add-remote-bt__step__title">{{
              $t("remote.add_device_bt.disabled_bt.title")
            }}</span>
            <p class="add-remote-bt__step__description">
              {{ $t("remote.add_device_bt.disabled_bt.description") }}
            </p>
          </div>
        </div>
      </Transition>

      <!-- NO_SLOT -->
      <Transition :name="stepTransition">
        <div
          v-show="activeStep == RemoteBluetoothSetup.NO_SLOT"
          class="modal__body__step add-remote-bt__step add-remote-bt__step--no-slot"
        >
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data"
          >
            <span
              class="add-remote-bt__step__icon add-remote-bt__step__icon--red"
            >
              <i class="fa-light fa-warning"></i>
            </span>
            <span class="add-remote-bt__step__title">{{
              $t("remote.add_device_bt.no_slot.title")
            }}</span>
            <p class="add-remote-bt__step__description">
              {{ $t("remote.add_device_bt.no_slot.description") }}
            </p>

            <button
              class="button button--secondary button--min-w"
              @click="closeModal"
            >
              {{ $t("ui.close") }}
            </button>
          </div>
        </div>
      </Transition>

      <!-- WAITING -->
      <Transition :name="stepTransition">
        <div
          v-show="activeStep == RemoteBluetoothSetup.WAITING"
          class="modal__body__step add-remote-bt__step add-remote-bt__step--waiting"
        >
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data"
          >
            <div class="add-remote-bt__step__loading">
              <img
                src="/images/loading-indicator.png"
                alt="Loading"
                class="img-loading"
              />
            </div>
            <span class="add-remote-bt__step__title">{{
              $t("remote.add_device_bt.waiting.title")
            }}</span>
            <p class="add-remote-bt__step__description">
              {{ $t("remote.add_device_bt.waiting.description") }}
            </p>
            <div
              v-if="btPairingData && btPairingData.advertisement_name"
              class="add-remote-bt__step__row"
            >
              <div class="add-remote-bt__step__row__label">
                {{ $t("remote.add_device_bt.waiting.advertisement_name") }}
              </div>
              <div class="add-remote-bt__step__row__value">
                {{ btPairingData.advertisement_name }}
              </div>
            </div>
          </div>
        </div>
      </Transition>

      <!-- CODE_INPUT -->
      <Transition :name="stepTransition">
        <div
          v-show="activeStep == RemoteBluetoothSetup.CODE_INPUT"
          class="modal__body__step add-remote-bt__step add-remote-bt__step--code-input"
        >
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data"
          >
            <span class="add-remote-bt__step__title">{{
              $t("remote.add_device_bt.code_input.title")
            }}</span>
            <p class="add-remote-bt__step__description">
              <template v-if="pairingKind == 'PASSKEY_INPUT'">{{
                $t("remote.add_device_bt.code_input.description.code")
              }}</template>
              <template v-else>{{
                $t("remote.add_device_bt.code_input.description.simple")
              }}</template>
            </p>
            <div
              v-if="btPairingData && btPairingData.advertisement_name"
              class="add-remote-bt__step__row"
            >
              <div class="add-remote-bt__step__row__label">
                {{ $t("remote.add_device_bt.waiting.advertisement_name") }}
              </div>
              <div class="add-remote-bt__step__row__value">
                {{ btPairingData.advertisement_name }}
              </div>
            </div>

            <UCCodeInput
              v-if="pairingKind == 'PASSKEY_INPUT'"
              ref="pinInput"
              :fields="6"
              :hide-code="false"
              @change="onPinChanges"
              @submit="submitCodeInput"
            />
          </div>
        </div>
      </Transition>

      <!-- PROGRESS -->
      <Transition :name="stepTransition">
        <div
          v-show="activeStep == RemoteBluetoothSetup.PROGRESS"
          class="modal__body__step add-remote-bt__step add-remote-bt__step--progress"
        >
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data"
          >
            <div class="add-remote-bt__step__loading">
              <img
                src="/images/loading-indicator.png"
                alt="Loading"
                class="img-loading"
              />
            </div>
            <span class="add-remote-bt__step__title">{{
              $t("remote.add_device_bt.progress.title")
            }}</span>
          </div>
        </div>
      </Transition>

      <!-- SUCCESS -->
      <Transition :name="stepTransition">
        <div
          v-show="activeStep == RemoteBluetoothSetup.SUCCESS"
          class="modal__body__step add-remote-bt__step add-remote-bt__step--success"
        >
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data"
          >
            <span
              class="add-remote-bt__step__icon add-remote-bt__step__icon--green"
            >
              <i class="fa-light fa-circle-check"></i>
            </span>
            <span class="add-remote-bt__step__title">{{
              $t("remote.add_device_bt.success.title")
            }}</span>
            <p class="add-remote-bt__step__description">
              {{ $t("remote.add_device_bt.success.description") }}
            </p>
          </div>
        </div>
      </Transition>

      <!-- FAIL -->
      <Transition :name="stepTransition">
        <div
          v-show="activeStep == RemoteBluetoothSetup.FAIL"
          class="modal__body__step add-remote-bt__step add-remote-bt__step--fail"
        >
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data"
          >
            <span
              class="add-remote-bt__step__icon add-remote-bt__step__icon--red"
            >
              <i class="fa-light fa-warning"></i>
            </span>
            <span class="add-remote-bt__step__title">{{
              $t("remote.add_device_bt.fail.title")
            }}</span>
            <p
              v-if="messageFail && messageFail.length > 0"
              class="add-remote-bt__step__error"
            >
              {{ messageFail }}
            </p>
          </div>
        </div>
      </Transition>

      <template v-if="activeStep != RemoteBluetoothSetup.NO_SLOT" #footer>
        <button
          v-if="activeStep == RemoteBluetoothSetup.ADD"
          :disabled="saving || !isNameValid"
          class="button button--primary button--min-w"
          @click="startPairing(null)"
        >
          {{ $t("remote.add_device_bt.enable_pairing") }}
        </button>

        <button
          v-else-if="activeStep == RemoteBluetoothSetup.WAITING"
          class="button button--tertiary button--min-w"
          @click="cancel"
        >
          {{ $t("ui.cancel") }}
        </button>

        <div
          v-else-if="activeStep == RemoteBluetoothSetup.DISABLED_BT"
          class="add-remote-bt__footer-buttons"
        >
          <button class="button button--tertiary" @click="cancel">
            {{ $t("ui.cancel") }}
          </button>
          <button class="button button--primary" @click="turnOnBt">
            {{ $t("ui.enable") }}
          </button>
        </div>

        <div
          v-else-if="activeStep == RemoteBluetoothSetup.CODE_INPUT"
          class="add-remote-bt__footer-buttons"
        >
          <button class="button button--tertiary" @click="cancel">
            {{ $t("ui.cancel") }}
          </button>
          <button
            :disabled="
              (pin.length < 6 && pairingKind == 'PASSKEY_INPUT') ||
              btPiaringID == null
            "
            class="button button--secondary"
            @click="confirm"
          >
            {{ $t("ui.confirm") }}
          </button>
        </div>
        <button
          v-else-if="activeStep == RemoteBluetoothSetup.PROGRESS"
          class="button button--tertiary button--min-w"
          @click="cancel"
        >
          {{ $t("ui.cancel") }}
        </button>
        <template v-else-if="activeStep == RemoteBluetoothSetup.SUCCESS">
          <div
            v-if="onlyPairing == false"
            class="add-remote-bt__footer-buttons"
          >
            <button class="button button--secondary" @click="closeModal">
              {{ $t("ui.done") }}
            </button>
            <button class="button button--primary" @click="customise">
              {{ $t("ui.customise") }}
            </button>
          </div>
          <button
            v-else
            class="button button--secondary button--min-w button-done"
            @click="closeModal"
          >
            {{ $t("ui.done") }}
          </button>
        </template>
        <div
          v-else-if="activeStep == RemoteBluetoothSetup.FAIL"
          class="add-remote-bt__footer-fail"
        >
          <p class="add-remote-bt__step__description">
            {{ $t("remote.add_device_bt.fail.description") }}
          </p>
          <button class="button button--tertiary button--min-w" @click="cancel">
            {{ $t("ui.cancel") }}
          </button>
        </div>
      </template>
    </AppModal>
  </Teleport>
  <!-- <Loader ref="loader" /> -->
</template>
