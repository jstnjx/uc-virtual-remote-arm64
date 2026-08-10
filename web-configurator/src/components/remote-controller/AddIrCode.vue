<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import type { PropType } from "vue";
import { useTranslation } from "i18next-vue";
import { storeToRefs } from "pinia";

import {
  IrLearningEventType,
  RemoteIrCodeFormat,
  IrActionType,
  IrAddingState,
} from "@/types/enums";
import type {
  IrEmitter,
  IrEmitterPort,
  RemoteDataSet,
  RemoteIrCode,
} from "@/types/ir";
import type { DockConfiguration } from "@/types/dock";

import ApiConnection from "@/api";

import { irStore } from "@/stores/ir";
import { remotesStore } from "@/stores/remotes";
import { docksStore } from "@/stores/docks";
import { addErrorBottom } from "@/stores/messages";

import { useTiming } from "@/composables/timing";
import { focusInput } from "@/composables/device";

import AppModal from "@/components/elements/AppModal.vue";
import UCInput from "@/components/ui/UCInput.vue";
import UCSelect from "@/components/ui/UCSelect.vue";
import DockIllustration from "@/components/dock/DockIllustration.vue";
import ErrorBox from "@/components/ui/ErrorBox.vue";
import { detectCodeFormat, irLearnReadiness } from "@/composables/irCode.ts";

const props = defineProps({
  remoteId: {
    type: String,
    required: true,
  },
  irDataset: {
    type: Object,
    required: true,
  },
  irEmitters: {
    type: Array,
    required: true,
  },
  emitterOptions: {
    type: Array as PropType<SelectOption[]>,
    required: true,
  },
  learnEmitterOptions: {
    type: Array as PropType<SelectOption[]>,
    required: true,
  },
});

const emit = defineEmits(["close"]);
const { t } = useTranslation();
const { sleep } = useTiming();

interface SelectOption {
  label: string;
  value: string;
}

// computed, not a plain array: t() only re-runs on a language change when it is
// read inside a tracked scope.
const codeFormats = computed<SelectOption[]>(() => [
  {
    value: RemoteIrCodeFormat.HEX,
    label: t("remote.ir_code.format.hex", "Hex"),
  },
  {
    value: RemoteIrCodeFormat.PRONTO,
    label: t("remote.ir_code.format.pronto", "PRONTO"),
  },
]);
const storage = remotesStore();
const irStorage = irStore();
const dockStorage = docksStore();

const { docks } = storeToRefs(dockStorage);
const showModal = ref(false);
const step = ref(IrAddingState.START);
const irDataset = ref<RemoteDataSet>(props.irDataset as RemoteDataSet);
const code = ref<RemoteIrCode | null>(null);
const learningProcessIsActive = ref(false);

const commandName = ref("");
const newCodeValue = ref("");
const newCodeFormat = ref<SelectOption>(codeFormats.value[0]);
// const codeRepeat = ref(0);

const testOutputDevice = ref<SelectOption>({ label: "", value: "" });
const testOutputPort = ref<SelectOption>({ label: "", value: "" });
const outputDevice = ref<SelectOption>({ label: "", value: "" });

const invalidNewCommandName = ref(false);
const invalidCodeFormat = ref(false);

const successMessage = ref("");
const msgError = ref({
  code: "",
  message: "",
  type: "",
});

const CMD_PATTERN = "^[a-zA-Z0-9-_.:+#*°@%/()?]{1,50}$";

const fieldErrors = ref<any[]>([]);

const editing = ref(false);
const learning = ref(false);

const customCodeStarter = {
  cmd_id: commandName.value,
  custom: true,
  modified: false,
};

defineExpose({
  open,
  closeModal,
});

// const isTestAvailable = computed(() => {
//   if (learningProcessIsActive.value) {
//     return false;
//   }
//   return Boolean(newCodeValue.value && newCodeFormat.value);
// });

const testPorts = computed(() => {
  if (!testOutputDevice.value) {
    return [];
  }

  const outDevice = ((props.irEmitters as IrEmitter[]) || []).find(
    (emitter: IrEmitter) => {
      return (
        testOutputDevice.value &&
        testOutputDevice.value.value === emitter.device_id
      );
    },
  ) as IrEmitter;

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

watch(props, () => {
  irDataset.value = props.irDataset;
});

watch(step, (val) => {
  if (
    (val === IrAddingState.LEARN || val === IrAddingState.PASTE) &&
    props.emitterOptions &&
    props.learnEmitterOptions &&
    props.irEmitters.length > 0
  ) {
    testOutputDevice.value = props.emitterOptions[0] as SelectOption;
    outputDevice.value = props.emitterOptions[0] as SelectOption;

    if (val === IrAddingState.LEARN) {
      testOutputDevice.value = props.learnEmitterOptions[0] as SelectOption;
      outputDevice.value = props.learnEmitterOptions[0] as SelectOption;
      learning.value = true;
    }

    const outDevice = ((props.irEmitters as IrEmitter[]) || []).find(
      (emitter: IrEmitter) => {
        return (
          testOutputDevice.value &&
          testOutputDevice.value.value === emitter.device_id
        );
      },
    ) as IrEmitter;

    if (outDevice && outDevice.ports && outDevice.ports.length > 0) {
      const defaultElement = outDevice.ports[outDevice.ports.length - 1];
      testOutputPort.value = {
        label: defaultElement.name,
        value: defaultElement.port_id,
      };
    }
  }

  const modalEditIrCode = document.querySelector(
    ".modal--edit-ir-code",
  ) as HTMLElement;
  if (modalEditIrCode) {
    focusInput(modalEditIrCode, true);
  }
});

watch(newCodeValue, (val) => {
  const cFormat = detectCodeFormat(val);
  if (cFormat != null) {
    newCodeFormat.value =
      codeFormats.value.find((option) => {
        return option.value === cFormat;
      }) || codeFormats.value[0];
    invalidCodeFormat.value = false;
  } else {
    invalidCodeFormat.value = true;
  }

  if (val.length < 1) {
    invalidCodeFormat.value = false;
  }
});

irStorage.$onAction(({ name, args }) => {
  if (name !== "irLearningEvent") {
    return;
  }
  if (args.length < 1) {
    return;
  }

  const { event_type, code, device_id } = args[0];
  if (event_type === IrLearningEventType.CODE && code) {
    void irStorage
      .stopLearning(device_id)
      .catch((e) => console.error("Failed to stop IR learning:", e));
    newCodeValue.value = code.value || "";
    // newCodeFormat.value =
    //   codeFormats.find((option) => {
    //     return option.value === code.format;
    //   }) || codeFormats[0];
    learningProcessIsActive.value = false;
    step.value = IrAddingState.PASTE;
    successMessage.value = t("remote.ir_code.add.successful_learning");
  } else if (
    event_type === IrLearningEventType.STOP &&
    device_id === outputDevice.value.value &&
    learningProcessIsActive.value == true
  ) {
    stopLearningProcess();
  }
});

function getSelectedDockMeta(selected?: any) {
  if (typeof selected == "undefined") {
    return;
  }

  return docks.value.find(
    (d: DockConfiguration) => d.dock_id == selected.value,
  );
}

async function checkCommandName() {
  if (!commandName.value) {
    return true;
  }
  if (!commandName.value.match(new RegExp(CMD_PATTERN))) {
    return true;
  }
  return existingCommand(commandName.value);
}

async function checkExistingCode() {
  if (code.value && code.value.cmd_id) {
    try {
      const result = await storage.getCustomCode(
        props.remoteId,
        code.value.cmd_id,
      );

      if (result.code) {
        // step.value = IrAddingState.PASTE;
        if (result.code.format) {
          newCodeFormat.value =
            codeFormats.value.find((option) => {
              return option.value === result?.code?.format;
            }) || codeFormats.value[0];
        }

        if (result.code.value) {
          newCodeValue.value = result.code.value;
        }
      }
    } catch (e) {
      addErrorBottom(e);
    }
  }
}

function existingCommand(cmd_id: string): boolean {
  const existing = ((irDataset.value as RemoteDataSet).codes || []).find(
    (code: RemoteIrCode) => {
      return code.cmd_id === cmd_id;
    },
  );
  return Boolean(existing);
}

async function submitIrForm() {
  if (!code.value || !newCodeFormat.value || !newCodeValue.value) {
    return;
  }

  const existing = existingCommand(code.value.cmd_id);
  try {
    await irStorage.saveIrCode(existing, props.remoteId, code.value.cmd_id, {
      value: newCodeValue.value,
      format: newCodeFormat.value.value as RemoteIrCodeFormat,
    });

    irDataset.value = await storage.getRemoteIrCodes(props.remoteId);
    newCodeValue.value = "";
    newCodeFormat.value = codeFormats.value[0];
    closeModal();
    await sleep(1000);
  } catch (e) {
    if (
      ApiConnection.rest().isConnectionError(e) &&
      (e as any).response?.data?.message
    ) {
      setErrors(e, IrActionType.SUBMIT);
    } else {
      setErrors(e, IrActionType.SUBMIT);
    }
  }
}

function setDefaults() {
  newCodeValue.value = "";
  newCodeFormat.value = codeFormats.value[0];
  learning.value = false;
  invalidCodeFormat.value = false;
  invalidNewCommandName.value = false;
  clearErrors();
}

function open(editCode: RemoteIrCode = customCodeStarter, isEditing = false) {
  setDefaults();
  editing.value = false;
  code.value = editCode;
  commandName.value = code.value.cmd_id;

  if (isEditing === true) {
    editing.value = true;
    checkExistingCode();
    step.value = IrAddingState.PASTE;
  }
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  step.value = IrAddingState.START;
  code.value = null;
  setDefaults();
  emit("close");
}

function getSelectedEmitter(): IrEmitter | undefined {
  if (!outputDevice.value) {
    return undefined;
  }
  return ((props.irEmitters as IrEmitter[]) || []).find(
    (emitter: IrEmitter) => outputDevice.value.value === emitter.device_id,
  );
}

// Offline (e.g. lost Wi-Fi) is distinct from not supporting learning at all and
// must not be conflated with it in the UI.
const selectedEmitterOffline = computed(
  () => irLearnReadiness(getSelectedEmitter()) === "offline",
);

function canStartLearning() {
  const outDevice = getSelectedEmitter();
  const readiness = irLearnReadiness(outDevice);

  // Temporary diagnostics: distinguish offline vs. capability-missing so we can
  // confirm which condition triggers the "does not support IR learning" box.
  console.debug("[AddIrCode] canStartLearning", {
    selectedId: outputDevice.value?.value,
    found: !!outDevice,
    active: outDevice?.active,
    hasCapabilities: typeof outDevice?.capabilities !== "undefined",
    readiness,
    capabilities: outDevice?.capabilities,
  });

  return readiness === "ready";
}

async function starLearningProcess() {
  clearErrors();
  if (!outputDevice.value) {
    return;
  }

  learningProcessIsActive.value = true;

  await sleep(1000);
  try {
    await irStorage.startLearning(outputDevice.value.value);
  } catch (e) {
    learningProcessIsActive.value = false;
    setErrors(e, IrActionType.TEST);
  }
}

function stopLearningProcess() {
  if (!outputDevice.value) {
    return;
  }
  learningProcessIsActive.value = false;
  void irStorage
    .stopLearning(outputDevice.value.value)
    .catch((e: unknown) => addErrorBottom(e));
}

async function submitTest() {
  clearErrors();
  if (
    !testOutputDevice.value ||
    !testOutputPort.value ||
    !newCodeFormat.value ||
    !newCodeValue.value
  ) {
    return;
  }
  try {
    await irStorage.testCode(
      testOutputDevice.value.value,
      testOutputPort.value.value,
      newCodeFormat.value.value as RemoteIrCodeFormat,
      newCodeValue.value,
    );
    successMessage.value = t("remote.ir_code.add.test_ok");
  } catch (e) {
    if (ApiConnection.rest().isConnectionError(e) && (e as any).message) {
      setErrors(e, IrActionType.TEST);
    }
  }
}

function setErrors(e: unknown, type: string = IrActionType.SUBMIT) {
  if ((e as any).response?.data?.code) {
    msgError.value.code = (e as any).response?.data?.code;
    msgError.value.type = type;
  } else if ((e as any).code) {
    msgError.value.code = (e as any).code;
    msgError.value.type = type;
  } else if ((e as any).message) {
    msgError.value.message = (e as any).message;
    msgError.value.type = type;
  }

  if (
    (e as any).response?.data &&
    (e as any).response?.data?.errors &&
    (e as any).response?.data?.errors.length > 0 &&
    (e as any).response?.data?.errors[0].field_errors
  ) {
    fieldErrors.value = (e as any).response?.data?.errors[0].field_errors;
    msgError.value.type = type;
  }
}

function changeTestOutputDevice(item: SelectOption) {
  testOutputDevice.value = item;

  const outDevice = ((props.irEmitters as IrEmitter[]) || []).find(
    (emitter: IrEmitter) => {
      return item.value === emitter.device_id;
    },
  ) as IrEmitter;

  if (outDevice && outDevice.ports && outDevice.ports.length > 0) {
    const defaultElement = outDevice.ports[outDevice.ports.length - 1];
    testOutputPort.value = {
      label: defaultElement.name,
      value: defaultElement.port_id,
    };
  }
}

async function selectMethod(state: IrAddingState) {
  if (!editing.value) {
    try {
      invalidNewCommandName.value = await checkCommandName();
    } catch (e) {
      addErrorBottom(e);
    }
  }

  if (invalidNewCommandName.value) {
    return false;
  }

  code.value = {
    cmd_id: commandName.value,
    custom: true,
    modified: false,
  };

  step.value = state;
}

function backToLearn() {
  setDefaults();
  step.value = IrAddingState.LEARN;
}

function clearErrors() {
  if (msgError.value.code.length > 0 || msgError.value.message.length > 0) {
    msgError.value.code = "";
    msgError.value.message = "";
  }

  msgError.value.type = "";

  if (fieldErrors.value.length > 0) {
    fieldErrors.value = [];
  }

  successMessage.value = "";
}

onMounted(async () => {
  if (docks.value.length < 1) {
    try {
      await dockStorage.getDockList(false);
    } catch (e) {
      addErrorBottom(e);
    }
  }
});
</script>
<template>
  <Teleport to="body">
    <AppModal
      :show="showModal"
      :height="'100%'"
      :cols="step === IrAddingState.PASTE"
      :width="step === IrAddingState.PASTE ? '100%' : '32.5rem'"
      name="edit-ir-code"
      class="modal--edit-ir-code edit-ir-code"
      @close="closeModal"
    >
      <template #header>
        <template v-if="editing">{{
          t("remote.ir_code.add.edit_ir_code")
        }}</template>
        <template v-else>{{ t("remote.ir_code.add.add_ir_code") }}</template>
      </template>
      <template v-if="step === IrAddingState.START">
        <span class="edit-ir-code__label edit-ir-code__label--selector">{{
          irDataset?.name
        }}</span>
        <UCInput
          v-model="commandName"
          :disabled="editing"
          :full-w="true"
          :label="$t('remote.ir_code.add.new_button_name.label')"
          :description="$t('remote.ir_code.add.new_button_name.description')"
          :error-message="
            invalidNewCommandName
              ? $t('remote.ir_code.add.error.invalid_cmd_name')
              : ''
          "
          :focus="true"
          @click="invalidNewCommandName = false"
        />
        <div class="edit-ir-code__selector">
          <button
            class="edit-ir-code__selector__item"
            @click="selectMethod(IrAddingState.PASTE)"
          >
            <i class="fa-thin fa-paste"></i>
            <span class="edit-ir-code__selector__item__title">
              {{ t("remote.ir_code.add.selector.paste_ir_code") }}
            </span>
          </button>
          <button
            class="edit-ir-code__selector__item"
            @click="selectMethod(IrAddingState.LEARN)"
          >
            <i class="fa-thin fa-wave-square"></i>
            <span class="edit-ir-code__selector__item__title">
              {{ t("remote.ir_code.add.selector.learn_ir_code") }}
            </span>
          </button>
        </div>
      </template>
      <div v-if="step === IrAddingState.LEARN" class="edit-ir-code__learning">
        <div class="edit-ir-code__learning__header">
          <template v-if="!learningProcessIsActive">
            <span class="edit-ir-code__label">{{
              $t("remote.ir_code.add.infrared_device")
            }}</span>
            <p class="edit-ir-code__instruction">
              {{ $t("remote.ir_code.add.select_device") }}
            </p>

            <UCSelect
              v-if="learnEmitterOptions && learnEmitterOptions.length > 0"
              v-model="outputDevice"
              :options="learnEmitterOptions"
              :light="true"
              :dynamic-width="true"
            />
            <ErrorBox
              v-else
              :message="$t('remote.no_output_device')"
              :width-flex="true"
              :margin-top="true"
            />
          </template>
          <template v-else-if="learningProcessIsActive">
            <div class="edit-ir-code__learning__header__progress">
              <span class="edit-ir-code__learning__header__progress__title">{{
                $t("remote.ir_code.add.infrared_learning.title")
              }}</span>
              <span
                class="edit-ir-code__learning__header__progress__description"
                >{{
                  $t("remote.ir_code.add.infrared_learning.description")
                }}</span
              >
            </div>
          </template>
        </div>

        <div class="edit-ir-code__illustration">
          <DockIllustration
            v-if="getSelectedDockMeta(outputDevice)"
            :dock="getSelectedDockMeta(outputDevice)"
          />
        </div>
      </div>
      <template v-else-if="step === IrAddingState.PASTE">
        <div
          class="modal__body__col modal__body__col-50 modal__body__col--form"
        >
          <span class="edit-ir-code__label">{{ irDataset?.name }}</span>
          <UCInput
            v-model="commandName"
            :full-w="true"
            :label="$t('remote.ir_code.add.button')"
            :disabled="true"
            :error-message="
              invalidNewCommandName
                ? $t('remote.ir_code.add.error.invalid_cmd_name')
                : ''
            "
          />

          <div class="ir-code-area">
            <UCInput
              v-model="newCodeValue"
              :type="'textarea'"
              :label="$t('remote.ir_code.add.ir_code')"
              :full-w="true"
              :error-message="msgError.type.length > 0 ? ' ' : ''"
              :focus="true"
              class="form-item--ir-code"
              @click="clearErrors"
            />
            <div class="ir-code-area__options">
              <UCSelect
                v-model="newCodeFormat"
                :options="codeFormats"
                :position="'right'"
                :compact="true"
              />
              <!-- <div class="input-simple">
                <label for="code-test-repeat" :title="$t('ui.repeat')">
                  <i class="fa-light fa-repeat"></i>
                </label>
                <input
                  v-model="codeRepeat"
                  id="code-test-repeat"
                  type="number"
                  min="0"
                  max="999"
                >
              </div> -->
            </div>

            <p
              class="edit-ir-code__response"
              :class="{
                'edit-ir-code__response--error':
                  invalidCodeFormat ||
                  msgError.code.length > 0 ||
                  msgError.message.length > 0,
                'edit-ir-code__response--success': successMessage.length > 0,
              }"
            >
              <template v-if="invalidCodeFormat">{{
                $t("remote.ir_code.add.error.invalid_code_format")
              }}</template>
              <template v-else-if="msgError.message.length > 0">{{
                msgError.message
              }}</template>
              <template v-else-if="msgError.code.length > 0">{{
                t(`error.${msgError.code}`)
              }}</template>
              <template v-else-if="successMessage">
                <i class="fa-light fa-circle-check"></i>
                {{ successMessage }}
              </template>
              <template v-else>{{
                $t("remote.ir_code.add.paste_code_placeholder")
              }}</template>
            </p>
          </div>

          <div class="edit-ir-code__buttons">
            <button
              :disabled="!newCodeValue || !newCodeFormat || invalidCodeFormat"
              class="button button--primary"
              @click="submitIrForm"
            >
              {{ $t("ui.save") }}
            </button>
            <button class="button button--secondary" @click="backToLearn">
              {{ $t("remote.ir_code.add.start_learning") }}
            </button>
          </div>
        </div>
        <div
          class="modal__body__col--test modal__body__col modal__body__col-50"
        >
          <div class="select-extra">
            <div class="select-extra__text">
              <span class="select-extra__label">
                {{ $t("remote.label.infrared_output_device") }}
              </span>
            </div>
            <UCSelect
              v-if="emitterOptions && emitterOptions.length > 0"
              v-model="testOutputDevice"
              :options="emitterOptions"
              :dynamic-width="true"
              :dynamic-position="true"
              :light="true"
              @select="changeTestOutputDevice"
            />
            <ErrorBox
              v-else
              :message="$t('remote.no_output_device')"
              :width-flex="true"
            />
          </div>
          <div
            class="select-extra"
            :class="{
              'select-extra--disabled':
                !emitterOptions || emitterOptions.length < 1,
            }"
          >
            <div class="select-extra__text">
              <span class="select-extra__label">
                {{ $t("remote.label.infrared_output_port") }}
              </span>
            </div>
            <UCSelect
              v-model="testOutputPort"
              :options="testPorts"
              :dynamic-width="true"
              :dynamic-position="true"
              :light="true"
            />
          </div>

          <div class="edit-ir-code__illustration">
            <DockIllustration
              v-if="getSelectedDockMeta(testOutputDevice)"
              :dock="getSelectedDockMeta(testOutputDevice)"
            />
          </div>

          <div class="modal__body__col--test__footer">
            <button
              :disabled="
                !newCodeValue ||
                newCodeValue.length < 1 ||
                !testOutputDevice ||
                testOutputDevice.value.length < 1 ||
                !testOutputPort ||
                testOutputPort.value.length < 1
              "
              class="button button--secondary button--min-w"
              @click="submitTest"
            >
              {{ $t("remote.ir_code.add.test_code") }}
            </button>
          </div>
        </div>
      </template>
      <template v-if="step === IrAddingState.LEARN" #footer>
        <ErrorBox
          v-if="
            msgError.type == 'TEST' &&
            outputDevice &&
            (msgError.code.length > 0 || msgError.message.length > 0)
          "
          :message="
            msgError.message.length > 0
              ? msgError.message
              : t(`error.${msgError.code}`)
          "
          :margin-bottom="true"
        />
        <ErrorBox
          v-else-if="outputDevice && selectedEmitterOffline"
          :message="$t('remote.ir_code.add.emitter_offline')"
          :margin-bottom="true"
        />
        <ErrorBox
          v-else-if="outputDevice && !canStartLearning()"
          :message="$t('remote.ir_code.add.not_support_learning')"
          :margin-bottom="true"
        />
        <template v-if="!learningProcessIsActive">
          <button
            :disabled="!canStartLearning()"
            class="button button--primary button--min-w"
            @click="starLearningProcess"
          >
            {{ $t("remote.ir_code.add.start_learning") }}
          </button>
        </template>
        <template v-else-if="learningProcessIsActive">
          <button
            class="button button--primary button--min-w"
            @click="stopLearningProcess"
          >
            {{ $t("remote.ir_code.add.stop_learning") }}
          </button>
        </template>
      </template>
    </AppModal>
  </Teleport>
</template>
