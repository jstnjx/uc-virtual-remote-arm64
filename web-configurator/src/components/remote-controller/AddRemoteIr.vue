<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";
import { useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import { storeToRefs } from "pinia";

import { DeviceType } from "@/types/enums";
import type { ChangeCallbackParams } from "@/types/config";
import type {
  IrEmitter,
  IrEmitterPort,
  IrEmitterOption,
  ManufacturerCodeset,
  ManufacturerInfo,
} from "@/types/ir";
import type { DockConfiguration } from "@/types/dock";

import { getCurrentLocale } from "@/composables/translatedProperty";
import { useTiming } from "@/composables/timing";
import { focusInput } from "@/composables/device";
import { asError } from "@/composables/error";
import { isTouchEnabled } from "@/composables/device";

import ApiConnection from "@/api";
import { irStore } from "@/stores/ir";
import { docksStore } from "@/stores/docks";
import { addErrorBottom } from "@/stores/messages";

import UCInput from "@/components/ui/UCInput.vue";
import UCSearch from "@/components/ui/UCSearch.vue";
import UCToggle from "@/components/ui/UCToggle.vue";
import UCSelect from "@/components/ui/UCSelect.vue";
import AppModal from "@/components/elements/AppModal.vue";
import ErrorBox from "@/components/ui/ErrorBox.vue";
import IconSelect from "@/components/elements/icon/IconSelect.vue";
import DockIllustration from "@/components/dock/DockIllustration.vue";
import { deepClone } from "@/composables/dataHelper";

interface SelectOption {
  label: string;
  value: string;
}

const { t } = useTranslation();
const { sleep } = useTiming();
const router = useRouter();
const remotesApi = ApiConnection.remotes;
const irApi = ApiConnection.ir;

const irStorage = irStore();
const dockStorage = docksStore();

defineExpose({
  open,
});

defineEmits(["close"]);

const remoteSkeleton = {
  name: "",
  icon: "fa-tower-broadcast",
  description: "",
};

const { docks } = storeToRefs(dockStorage);
const newRemote = ref(deepClone(remoteSkeleton));

const manufacturerSearch = ref("");
const manufacturerList = ref<ManufacturerInfo[]>([]);
const selectedManufacturer = ref<ManufacturerInfo>();
const allCodeSets = ref<ManufacturerCodeset[]>([]);
const codesetSearch = ref("");
const codesetList = ref<ManufacturerCodeset[]>([]);
const codesetStepElement = useTemplateRef<HTMLDivElement>("codesetStepElement");

const deviceList = ref<ManufacturerCodeset[]>([]);

const customDeviceName = ref("");
const customDeviceNameError = ref("");

const irEmitters = ref();
// computed off the raw emitters: the " - inactive" suffix is translated, and a
// list built once would keep the language it was built in.
const irEmittersReduced = computed(() => getEmitters());

const testAllCodes = ref<string[]>([]);
const testCodeSearch = ref("");
const testCodeList = ref<string[]>([]);
const selectedCodeset = ref<ManufacturerCodeset>();
const testingCommandIndex = ref(-1);

const testOutputDevice = ref<SelectOption>({ label: "", value: "" });
const testOutputPort = ref<SelectOption>({ label: "", value: "" });

const commandSent = ref(false);

const showModal = ref(false);
const activeStep = ref(1);
const slideRight = ref(false);

const createBlank = ref(false);

const focusOnManufSearch = ref(false);
const elDatasetList = ref();
const textManufSearch = ref("");
const errorMessage = ref("");

watch(showModal, async (val, oldVal) => {
  if (val == true && oldVal == false) {
    newRemote.value = deepClone(remoteSkeleton);
    activeStep.value = 1;
    customDeviceName.value = "";
    customDeviceNameError.value = "";
    manufacturerSearch.value = "";
    manufacturerList.value = [];
    // The search text outlives the input now, so it needs clearing by hand.
    textManufSearch.value = "";
    codesetSearch.value = "";
    codesetList.value = [];
  }
});

watch(manufacturerSearch, async () => {
  if (showModal.value == false) {
    return;
  }

  selectedManufacturer.value = manufacturerList.value.find((item) => {
    return item.id === manufacturerSearch.value;
  }) as ManufacturerInfo;

  if (selectedManufacturer.value) {
    codesetSearch.value = "";

    try {
      allCodeSets.value = await irApi.getManufacturerCodeSets(
        selectedManufacturer.value.id,
      );
    } catch (e) {
      addErrorBottom(e);
    }
    if (!isTouchEnabled()) {
      const container = codesetStepElement.value as HTMLDivElement;
      const firstInput = container.querySelector("input") as HTMLElement;
      await sleep(500);
      firstInput?.focus();
    }
  } else {
    allCodeSets.value = [];
  }
  codesetList.value = getCodesetList();
});

watch(codesetSearch, async (newCodeset, oldCodeset) => {
  if (selectedManufacturer.value) {
    try {
      if (newCodeset.length > 1 || newCodeset.length < oldCodeset.length) {
        allCodeSets.value = await irApi.getManufacturerCodeSets(
          selectedManufacturer.value.id,
          newCodeset || "",
        );
      }
      codesetList.value = getCodesetList();
    } catch (e) {
      addErrorBottom(e);
    }
  } else {
    allCodeSets.value = [];
  }
});

watch(testCodeSearch, () => {
  testCodeList.value = getTestCodeList();
});

const testPorts = computed(() => {
  if (!testOutputDevice.value) {
    return [];
  }

  const outDevice = ((irEmitters.value as IrEmitter[]) || []).find(
    (emitter: IrEmitter) => {
      return testOutputDevice.value.value === emitter.device_id;
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

watch(activeStep, async (val) => {
  if (val == 12) {
    try {
      await dockStorage.getDockList();
      irEmitters.value = await irStorage.getAll();
      if (hasIrEmitterReduced.value) {
        testOutputDevice.value = irEmittersReduced.value[0];
        changeTestOutputDevice();
      }
    } catch (e) {
      addErrorBottom(e);
    }
  }

  if (val == 11) {
    focusSearch();
  }

  const modalAddRemoteIr = document.querySelector(
    ".modal--add.add-remote-ir",
  ) as HTMLElement;
  if (modalAddRemoteIr) {
    focusInput(modalAddRemoteIr, true);
  }
});

const stepTransition = computed(() => {
  return slideRight.value == true ? "slide-tab-right" : "slide-tab-left";
});

const selectedDock = computed(() => {
  if (!testOutputDevice.value) return undefined;
  return docks.value.find(
    (d: DockConfiguration) => d.dock_id == testOutputDevice.value.value,
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

// UCSearch debounces the model write, so the search fires 300ms after typing.
watch(textManufSearch, async (search) => {
  if (search.length < 2) {
    manufacturerList.value = [];
    return;
  }

  try {
    manufacturerList.value = await irApi.getManufacturers(search);
  } catch (e) {
    addErrorBottom(e);
  }

  deviceList.value = [];
});

function selectManufacturer(manufacturer: ManufacturerInfo) {
  manufacturerSearch.value = manufacturer.id;
}

function resetManufacturer() {
  manufacturerList.value = [];
  textManufSearch.value = "";
  codesetList.value = [];
  deviceList.value = [];
  manufacturerSearch.value = "";
  focusSearch();
}

function getCodesetList() {
  const search = codesetSearch.value.toLowerCase();
  return allCodeSets.value.filter((item) => {
    return (
      item.name.toLowerCase().includes(search) ||
      item.id.toLowerCase().includes(search)
    );
  });
}

async function testCodeset(codeset: ManufacturerCodeset) {
  selectedCodeset.value = codeset;
  goToStep(12);

  try {
    testAllCodes.value = await irApi.getManufacturerCodeSet(
      selectedManufacturer.value?.id as string,
      codeset.id,
    );
    testCodeList.value = getTestCodeList();
  } catch (e) {
    addErrorBottom(e);
  }
}

function getEmitters() {
  if (!irEmitters.value) {
    return [];
  }

  return irEmitters.value.map((emitter: IrEmitter) => ({
    label: !emitter.active
      ? emitter.name + " - " + t("integration.driver.state_inactive")
      : emitter.name,
    value: emitter.device_id,
    active: emitter.active || false,
  }));
}

function getTestCodeList() {
  const search = testCodeSearch.value.toLowerCase();
  return testAllCodes.value.filter((item) => {
    return item.toLowerCase().includes(search);
  });
}

async function testCommand(code: string) {
  try {
    commandSent.value = await irApi.sendCodeToEmiter(
      testOutputDevice.value?.value as string,
      code,
      selectedCodeset.value?.id as string,
      testOutputPort.value?.value as string,
    );
  } catch (e) {
    addErrorBottom(e);
  }
}

function changeTestOutputDevice(item?: SelectOption) {
  if (item) {
    testOutputDevice.value = item;
  }

  const outDevice = ((irEmitters.value as IrEmitter[]) || []).find(
    (emitter: IrEmitter) => {
      return testOutputDevice.value.value === emitter.device_id;
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

function outputDeviceIsActive() {
  if (!hasIrEmitterReduced.value) return false;
  const outDevice = ((irEmitters.value as IrEmitter[]) || []).find(
    (emitter: IrEmitter) => {
      return (
        testOutputDevice.value &&
        testOutputDevice.value.value === emitter.device_id
      );
    },
  ) as IrEmitter;

  return outDevice?.active;
}

function getOutputDeviceValidPortId(item: SelectOption) {
  const outDevice = ((irEmitters.value as IrEmitter[]) || []).find(
    (emitter: IrEmitter) => {
      return item.value === emitter.device_id;
    },
  ) as IrEmitter;

  if (outDevice && outDevice.ports && outDevice.ports.length > 0) {
    const defaultElement = outDevice.ports[outDevice.ports.length - 1];
    return defaultElement.port_id;
  }

  return "0"; // Default port id
}

async function saveOutputDevice(remote_id: string) {
  if (testOutputDevice.value && testOutputDevice.value.value) {
    const portId = getOutputDeviceValidPortId(testOutputDevice.value);
    try {
      await remotesApi.update(remote_id, {
        options: {
          ir: {
            output: {
              device_id: testOutputDevice.value.value,
              port_id: portId,
            },
          },
        },
      });
    } catch (e) {
      addErrorBottom(e, "remote.update");
    }
  }
}

async function createRemoteWithPreset() {
  const deviceName =
    newRemote.value.name || (selectedCodeset.value?.name as string);
  const deviceDescr = newRemote.value.description || "";
  const iconRegex = /fa-/;
  const iconValue = newRemote.value.icon.replace(iconRegex, "uc:");

  try {
    const remote = await remotesApi.createNewRemote({
      name: {
        [getCurrentLocale()]: deviceName,
      },
      description: {
        [getCurrentLocale()]: deviceDescr,
      },
      icon: iconValue,
      codeset_id: selectedCodeset.value?.id,
    });
    await saveOutputDevice(remote.entity_id);
    closeModal();
    router.push({
      name: "remote",
      params: { remote_id: remote.entity_id },
    });
  } catch (e) {
    addErrorBottom(e);
  }
}

async function createCustomRemote() {
  if (customDeviceName.value) {
    const deviceName = newRemote.value.name || customDeviceName.value;
    const deviceDescr = newRemote.value.description || "";
    const iconRegex = /fa-/;
    const iconValue = newRemote.value.icon.replace(iconRegex, "uc:");

    try {
      const remote = await remotesApi.createNewRemote({
        name: {
          [getCurrentLocale()]: deviceName,
        },
        description: {
          [getCurrentLocale()]: deviceDescr,
        },
        icon: iconValue,
        custom_codeset: {
          device_name: customDeviceName.value,
          device_type: DeviceType.various,
        },
      });
      closeModal();
      router.push({
        name: "remote",
        params: { remote_id: remote.entity_id },
      });
    } catch (e) {
      if (e) {
        customDeviceNameError.value = asError(e).response?.data?.message ?? "";
      }
    }
  }
}

function changeActivityIcon(params: ChangeCallbackParams) {
  const { value } = params;
  if (newRemote.value) {
    newRemote.value.icon = value as string;
  }
}

function selectMode() {
  if (createBlank.value) {
    goToStep(21); // Custom
  } else {
    goToStep(11); // Manufacturer
  }
}

function goToStep(step: number) {
  slideRight.value = step < activeStep.value ? true : false;
  activeStep.value = step;
}

function clearErrors() {
  if (errorMessage.value.length > 0) {
    errorMessage.value = "";
  }
}

function open() {
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
}

function clickBack() {
  if (activeStep.value == 2) {
    activeStep.value = 1;
  } else if (activeStep.value == 11) {
    activeStep.value = 1;
  } else if (activeStep.value == 12) {
    activeStep.value = 11;
  } else if (activeStep.value == 21) {
    activeStep.value = 1;
  }
}

async function focusSearch() {
  await sleep(500);
  const searchField = document.querySelector(
    ".add-remote-ir__manufacturer-data-set input",
  ) as HTMLElement;
  if (searchField) {
    searchField.focus();
  }
}
</script>
<template>
  <Teleport to="body">
    <AppModal
      :show="showModal"
      name="add-remote-ir"
      class="modal--steps modal--add add-remote-ir"
      @close="closeModal"
    >
      <template #header>
        <button
          v-if="activeStep != 1"
          class="button button--tertiary button--icon modal--steps__back-button"
          @click="clickBack"
        >
          <i class="fa-regular fa-arrow-left"></i>
        </button>
        {{ $t("remote.add_device_ir.title") }}
      </template>
      <Transition :name="stepTransition">
        <div v-show="activeStep == 1" class="modal__body__step">
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data"
          >
            <IconSelect
              :key="
                newRemote.icon ? newRemote.icon : 'fa-thin fa-tower-broadcast'
              "
              :value="
                newRemote.icon ? newRemote.icon : 'fa-thin fa-tower-broadcast'
              "
              :change-callback="changeActivityIcon"
              :fallback="'fa-thin fa-tower-broadcast'"
            />
            <UCInput
              v-model="newRemote.name"
              :label="$t('form.name')"
              :error-message="errorMessage ? $t(errorMessage) : ''"
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
            <UCToggle
              v-model="createBlank"
              :label="$t('remote.add_device_ir.create_blank.title')"
              :description="$t('remote.add_device_ir.create_blank.description')"
              :full-w="true"
            />
          </div>
        </div>
      </Transition>
      <Transition :name="stepTransition">
        <div v-show="activeStep == 11" class="modal__body__step">
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data add-remote-ir__manufacturer-data-set"
          >
            <h2 class="add-remote-ir__manufacturer-data-set__title">
              {{ $t("remote.add_device_ir.manufacturer.title") }}
            </h2>
            <div
              v-if="selectedManufacturer && selectedManufacturer.name"
              class="add-remote-ir__manufacturer-data-set__search"
            >
              <UCInput
                v-model="selectedManufacturer.name"
                :disabled="true"
                :label="$t('form.manufacturer')"
                :full-w="true"
              />
              <button
                class="button button--secondary button--icon button-reset"
                @click="resetManufacturer"
              >
                <i class="fa-regular fa-close" />
              </button>
            </div>
            <div v-else class="add-remote-ir__manufacturer-data-set__search">
              <UCSearch
                v-model="textManufSearch"
                :debouncing="true"
                :gray="true"
                :placeholder="$t('remote.add_device_ir.manufacturer.search')"
                @focus="focusOnManufSearch = true"
                @blur="focusOnManufSearch = false"
              />
              <Transition name="opacity-fast">
                <p
                  v-show="focusOnManufSearch && textManufSearch.length < 2"
                  class="add-remote-ir__manufacturer-data-set__instruction"
                >
                  {{ $t("remote.add_device_ir.manufacturer.instruction") }}
                </p>
              </Transition>
            </div>
            <div
              v-if="!selectedManufacturer && manufacturerList.length > 0"
              v-overflow-indicator
              class="add-remote-ir__manufacturer-data-set__manufacturer-list"
            >
              <div
                v-for="item in manufacturerList"
                :key="item.id"
                class="add-remote-ir__manufacturer-data-set__manufacturer-list__item"
                @click="selectManufacturer(item)"
              >
                <span>{{ item.name }}</span>
                <i class="fa-light fa-arrow-right"></i>
              </div>
            </div>
            <Transition name="opacity-fast">
              <div
                v-show="selectedManufacturer && selectedManufacturer.name"
                ref="codesetStepElement"
                class="add-remote-ir__manufacturer-data-set__codeset"
              >
                <UCSearch
                  v-model="codesetSearch"
                  :debouncing="true"
                  :gray="true"
                />
                <div
                  v-overflow-indicator
                  class="add-remote-ir__manufacturer-data-set__codeset__list"
                >
                  <div
                    v-for="(item, index) in codesetList"
                    :key="`codeset-item${index}`"
                    class="add-remote-ir__manufacturer-data-set__codeset__item"
                    @click="testCodeset(item)"
                  >
                    <span>{{ item.name }}</span>
                    <i class="fa-light fa-arrow-right"></i>
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </div>
      </Transition>
      <Transition :name="stepTransition">
        <div v-show="activeStep == 12" class="modal__body__step">
          <div
            v-overflow-indicator
            class="modal__body__step__body add-remote-ir__test-manufacturer-data-set"
          >
            <div
              class="add-remote-ir__test-manufacturer-data-set__col add-remote-ir__test-manufacturer-data-set__col--list"
            >
              <div class="ir-code-data-set__list__header">
                <div class="ir-code-data-set__list__header__search">
                  <UCSearch
                    v-if="activeStep == 12"
                    v-model="testCodeSearch"
                    :small="true"
                    :gray="true"
                    :focus="false"
                  />
                </div>
              </div>
              <div v-overflow-indicator class="ir-code-data-set__list__body">
                <div
                  v-for="item in testCodeList"
                  :key="item"
                  class="ir-code-data-set__item"
                >
                  <span class="ir-code-data-set__item__name">
                    {{ item }}
                  </span>
                  <div class="ir-code-data-set__item__options">
                    <button
                      :tabindex="outputDeviceIsActive() ? 0 : ''"
                      :disabled="
                        !hasIrEmitterReduced || !hasActiveEmitterReduced
                      "
                      class="button button--blank button--blank--focus button--icon"
                      @click="outputDeviceIsActive() ? testCommand(item) : null"
                    >
                      <i class="fa-light fa-play"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div
              class="add-remote-ir__test-manufacturer-data-set__col add-remote-ir__test-manufacturer-data-set__col--test-device"
            >
              <h2 class="add-remote-ir__custom-data-set__title">
                {{ $t("remote.add_device_ir.test.title") }}
              </h2>
              <p class="add-remote-ir__custom-data-set__description">
                {{ $t("remote.add_device_ir.test.description1") }}<br />
                {{ $t("remote.add_device_ir.test.description2") }}
              </p>

              <div class="select-extra">
                <div class="select-extra__text">
                  <span class="select-extra__label">
                    {{ $t("remote.add_device_ir.test.output_device") }}
                  </span>
                </div>
                <UCSelect
                  v-if="hasIrEmitterReduced"
                  v-model="testOutputDevice"
                  :options="irEmittersReduced"
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
                :class="{ 'select-extra--disabled': !hasIrEmitterReduced }"
              >
                <div class="select-extra__text">
                  <span class="select-extra__label">
                    {{ $t("remote.add_device_ir.test.output_port") }}
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
              <div
                class="add-remote-ir__test-manufacturer-data-set__illustration"
              >
                <DockIllustration v-if="selectedDock" :dock="selectedDock" />
              </div>
            </div>
          </div>
        </div>
      </Transition>
      <Transition :name="stepTransition">
        <div v-show="activeStep == 21" class="modal__body__step">
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data add-remote-ir__custom-data-set"
          >
            <h2 class="add-remote-ir__custom-data-set__title">
              {{ $t("remote.add_device_ir.custom_data_set.title") }}
            </h2>
            <p class="add-remote-ir__custom-data-set__description">
              {{ $t("remote.add_device_ir.custom_data_set.description") }}
            </p>
            <UCInput
              v-model="customDeviceName"
              :label="$t('remote.add_device_ir.custom_data_set.input_label')"
              :error-message="
                customDeviceNameError ? customDeviceNameError : ''
              "
              :full-w="true"
              @click="clearErrors"
              @submit="createCustomRemote"
            />
          </div>
        </div>
      </Transition>
      <template
        v-if="activeStep == 1 || activeStep == 12 || activeStep == 21"
        #footer
      >
        <button
          v-if="activeStep == 1"
          class="button button--primary button--min-w"
          @click="selectMode"
        >
          {{ $t("ui.next") }}
        </button>
        <button
          v-else-if="activeStep == 12"
          class="button button--primary button--min-w"
          @click="createRemoteWithPreset"
        >
          {{ $t("ui.done") }}
        </button>
        <button
          v-else-if="activeStep == 21"
          :disabled="customDeviceName.length < 1"
          class="button button--primary button--min-w"
          @click="createCustomRemote"
        >
          {{ $t("ui.create") }}
        </button>
      </template>
    </AppModal>
  </Teleport>
</template>
