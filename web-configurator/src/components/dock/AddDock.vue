<script setup lang="ts">
import { ref, watch, computed } from "vue";

import type {
  DockDiscovery,
  DockSetup,
  DockSetupChangeMessage,
  DockDiscoveryList,
} from "@/types/dock";
import {
  CfgGroups,
  DockDiscoveryType,
  DockSetupScreen,
  DockSetupState,
} from "@/types/enums";
import type { ChangeCallbackParams } from "@/types/config";

import { docksStore } from "@/stores/docks";
import { configStore } from "@/stores/config";
import { addErrorBottom } from "@/stores/messages";

import { focusInput } from "@/composables/device";

import VueMarkdown from "vue-markdown-render";
import AppModal from "@/components/elements/AppModal.vue";
import UCInput from "@/components/ui/UCInput.vue";
import UCToggle from "@/components/ui/UCToggle.vue";
import UCSearch from "@/components/ui/UCSearch.vue";

defineExpose({
  open,
});

const store = docksStore();
const config = configStore();

const formDataSkeleton = {
  name: "",
  password: "",
  address: "",
  wifiOn: false,
  wifiSSID: "",
  wifiPassword: "",
};

const showModal = ref(false);
const activeStep = ref<DockSetupScreen>(DockSetupScreen.START);
const slideRight = ref(false);
const processActive = ref(false);
const setupManual = ref(false);
const discovered = ref<DockDiscovery | null>(null);
const hasError = ref<unknown>(null);
const setupProcessDock = ref<DockSetup | null>(null);
const setupProcessDiscovered = ref<DockDiscovery | null>(null);
const lastChangeMessage = ref<DockSetupChangeMessage | null>(null);
const manual = ref(false);

const discoveryActive = ref(false);
const discoveredDocks = ref<DockDiscoveryList>({} as DockDiscoveryList);
const searchText = ref("");
const btDockSelected = ref<DockDiscovery | null>(null);

// Keep JSON clone: `structuredClone` would type `formData` to the skeleton's
// shape, surfacing a pre-existing under-typed field (`wifiOn` holds an object
// at runtime) that is out of scope for this cloning sweep.
const formData = ref(JSON.parse(JSON.stringify(formDataSkeleton)));
const btEnabled = ref(false);
const startingSetupProcess = ref(false);

store.$onAction(({ name, args }) => {
  if (name === "setupChange" && showModal.value == true) {
    lastChangeMessage.value = args[0] || {};
    setupProcessResult(lastChangeMessage.value.state);
  }
});

// deep: the store adds discovered docks to the same object in place,
// so a reference-only watch would miss new entries.
watch(
  () => [store.discoverActive, store.discovered] as const,
  ([discoverActive, discovered]) => {
    if (showModal.value == true) {
      discoveryActive.value = discoverActive;
      discoveredDocks.value = discovered;
    }
  },
  { deep: true },
);

watch(activeStep, (val) => {
  if (
    val == DockSetupScreen.ADD_MANUALLY ||
    val == DockSetupScreen.ADD_DISCOVERED_BT ||
    val == DockSetupScreen.ADD_DISCOVERED_NET
  ) {
    createDefaults();
  }

  if (val == DockSetupScreen.ADD_MANUALLY) {
    manual.value = true;
  } else {
    manual.value = false;
  }

  if (
    val == DockSetupScreen.RESULT_SUCCESS ||
    val == DockSetupScreen.RESULT_ERROR
  ) {
    processActive.value = false;
  }

  const modalAddDock = document.querySelector(
    ".modal--add.add-dock",
  ) as HTMLElement;
  if (modalAddDock) {
    focusInput(modalAddDock, true);
  }
});

watch(showModal, (val) => {
  if (val) {
    setDefaults();
    store.init();
    btEnabled.value = config.$state.config?.network?.bt_enabled ?? false;
  }
});

const isDock3 = computed(() => {
  return (
    (discovered.value &&
      (discovered.value as DockDiscovery).model?.includes("UCD3")) ||
    false
  );
});

const isProcessScreenActive = computed(() => {
  return processActive.value;
});

const isModalCloseable = computed(() => {
  return !isProcessScreenActive.value;
});

const btStatus = computed(() => {
  return config.$state.config?.network?.bt_enabled ?? false;
});

const stepTransition = computed(() => {
  return slideRight.value == true ? "slide-tab-right" : "slide-tab-left";
});

const isBt = computed(() => {
  return discovered.value?.discovery_type === DockDiscoveryType.BT;
});

const wifiCredentials = computed(() => {
  if (isBt.value) {
    return true;
  }
  return formData.value.wifiOn;
});

const isSetupValid = computed(() => {
  let valid = true;

  if (!formData.value.name || (!formData.value.address && manual.value)) {
    valid = false;
  }

  if (
    wifiCredentials.value &&
    (!formData.value.wifiPassword || !formData.value.wifiSSID)
  ) {
    valid = false;
  }
  return valid;
});

const dockSetup = computed<DockSetup>(() => {
  const setup: DockSetup = {
    name: formData.value.name,
  };
  if (formData.value.password) {
    setup.token = formData.value.password;
  }
  if (manual.value && formData.value.address) {
    setup.custom_ws_url = formData.value.address;
  }
  if (wifiCredentials.value) {
    setup.wifi = {
      ssid: formData.value.wifiSSID,
      password: formData.value.wifiPassword,
    };
  }

  return setup;
});

const discoveredList = computed(() => {
  const search = searchText.value.toLowerCase();
  return Object.keys(discoveredDocks.value)
    .map((key: string) => {
      return discoveredDocks.value[key];
    })
    .filter((dock: DockDiscovery) => {
      return (
        dock.id.toLowerCase().includes(search) ||
        (dock.friendly_name || "").toLowerCase().includes(search) ||
        (dock.address || "").toLowerCase().includes(search)
      );
    })
    .sort((a, b) => {
      return a.id.localeCompare(b.id);
    });
});

function createDefaults() {
  formData.value.name =
    setupProcessDock.value && setupProcessDock.value.name
      ? setupProcessDock.value.name
      : discovered.value?.friendly_name || "";
  formData.value.address =
    setupProcessDock.value && setupProcessDock.value.custom_ws_url
      ? setupProcessDock.value.custom_ws_url
      : "";
  formData.value.wifiOn =
    setupProcessDock.value && setupProcessDock.value.wifi
      ? setupProcessDock.value.wifi
      : false;
  formData.value.wifiSSID =
    setupProcessDock.value &&
    setupProcessDock.value.wifi &&
    setupProcessDock.value.wifi?.ssid
      ? setupProcessDock.value.wifi?.ssid
      : "";
}

function setDefaults() {
  discovered.value = null;
  activeStep.value = DockSetupScreen.START;
  manual.value = false;
  setupManual.value = false;
  lastChangeMessage.value = null;
  discovered.value = null;
  hasError.value = null;
  startingSetupProcess.value = false;
  setupProcessDock.value = null;
  setupProcessDiscovered.value = null;
  processActive.value = false;
  // Keep JSON clone: see the `formData` initialiser above.
  formData.value = JSON.parse(JSON.stringify(formDataSkeleton));
}

async function closeAddWorkflow() {
  setDefaults();
  showModal.value = false;
  if (discoveryActive.value == true) {
    discoveryActive.value = false;
    try {
      await store.stopDiscovery();
    } catch (e) {
      addErrorBottom(e);
    }
  }
}

function startManualSetup() {
  goToStep(DockSetupScreen.ADD_MANUALLY);
  setupManual.value = true;
}

function doStartDiscovery() {
  startDiscovery();
  goToStep(DockSetupScreen.DISCOVERY);
  setupManual.value = false;
}

async function startDiscovery() {
  btDockSelected.value = null;
  try {
    discoveryActive.value = true;
    await store.startDiscovery();
  } catch (e) {
    addErrorBottom(e);
  }
}

async function cancelDiscovery() {
  try {
    await store.stopDiscovery();
  } catch (e) {
    addErrorBottom(e);
  }
  goToStep(DockSetupScreen.START);
}

async function startSetup(discovered: DockDiscovery) {
  if (discovered.discovery_type === DockDiscoveryType.BT) {
    btDockSelected.value = discovered;
  } else {
    doStartSetup(discovered);
  }
}

async function doBtStartSetup() {
  if (btDockSelected.value) {
    doStartSetup(btDockSelected.value);
  }
}

function doStartSetup(discovered: DockDiscovery) {
  startDiscoveredSetup(discovered);
}

async function startDiscoveredSetup(discoveredDock: DockDiscovery) {
  setupManual.value = false;
  discovered.value = discoveredDock;

  goToStep(
    discoveredDock.discovery_type === DockDiscoveryType.BT
      ? DockSetupScreen.ADD_DISCOVERED_BT
      : DockSetupScreen.ADD_DISCOVERED_NET,
  );
  try {
    await store.stopDiscovery();
  } catch (e) {
    addErrorBottom(e);
  }
}

async function startDiscoveredSetupProcess(
  dock_setup: DockSetup,
  dock_discovered: DockDiscovery | null = null,
  start_process = true,
) {
  if (start_process) {
    processActive.value = true;
  }
  setupProcessDiscovered.value = dock_discovered;
  setupProcessDock.value = dock_setup;
  if (discovered.value) {
    goToStep(
      discovered.value.discovery_type === DockDiscoveryType.BT
        ? DockSetupScreen.ADD_DISCOVERED_BT
        : DockSetupScreen.ADD_DISCOVERED_NET,
    );
  } else {
    goToStep(DockSetupScreen.ADD_DISCOVERED_NET);
  }
}

async function tryAgainDiscoveredSetupProcess() {
  hasError.value = null;
  processActive.value = false;
  if (manual.value) {
    startManualSetup();
  } else if (setupProcessDock.value != null) {
    startDiscoveredSetupProcess(
      setupProcessDock.value,
      setupProcessDiscovered.value,
      false,
    );
  } else {
    goToStep(DockSetupScreen.START);
  }
}

function setupProcessResult(result: DockSetupState) {
  if (result === DockSetupState.CONFIGURING) {
    goToStep(DockSetupScreen.CONFIGURING);
  }

  if (result === DockSetupState.ERROR) {
    goToStep(DockSetupScreen.RESULT_ERROR);
  }

  if (result === DockSetupState.OK) {
    goToStep(DockSetupScreen.RESULT_SUCCESS);
  }
}

function changedBt() {
  const params: ChangeCallbackParams = {
    group: CfgGroups.network,
    name: "bt_enabled",
    value: btEnabled.value,
  };

  void onItemChange(params);
}

async function onItemChange(params: ChangeCallbackParams) {
  try {
    await config.update(
      params.group as string,
      params.name as string,
      params.value,
    );
  } catch (e) {
    addErrorBottom(e);
    btEnabled.value = config.$state.config?.network?.bt_enabled ?? false;
  }
}

async function startSetupProcess() {
  startingSetupProcess.value = true;
  try {
    if (discoveryActive.value == true) {
      discoveryActive.value = false;
      await store.stopDiscovery();
    }
    if (manual.value) {
      await store.startSetupManualSetup(dockSetup.value);
    } else if (discovered.value != null) {
      await store.startSetupDiscoveredSetup(discovered.value, dockSetup.value);
    }
  } catch (e) {
    addErrorBottom(e);
  }
  startingSetupProcess.value = false;
}

function goToStep(step: DockSetupScreen) {
  const stepList = Object.keys(DockSetupScreen);
  slideRight.value =
    stepList.indexOf(step) < stepList.indexOf(activeStep.value) ? true : false;
  activeStep.value = step;
}

function open() {
  showModal.value = true;
}

function keyupEsc() {
  if (
    activeStep.value == DockSetupScreen.RESULT_ERROR ||
    activeStep.value == DockSetupScreen.RESULT_SUCCESS
  ) {
    closeAddWorkflow();
  }
}
</script>
<template>
  <Teleport to="body">
    <AppModal
      :show="showModal"
      :height="'100%'"
      class="modal--steps modal--add add-dock"
      name="add-dock"
      :closeable="isModalCloseable"
      @close="closeAddWorkflow"
      @keyup.esc.stop="keyupEsc"
    >
      <template #header>
        {{ $t("dock.add.title") }}
      </template>

      <Transition :name="stepTransition">
        <div
          v-show="activeStep == DockSetupScreen.START"
          class="modal__body__step add-dock__step add-dock__step--start"
        >
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data"
          >
            <p class="add-dock__step__description">
              {{ $t("dock.add.start.instruction1") }}<br /><br />
              {{ $t("dock.add.start.instruction2") }}
            </p>

            <UCToggle
              v-model="btEnabled"
              :label="$t('dock.add.start.bluetooth.label', 'Bluetooth')"
              :full-w="true"
              @change="changedBt"
            />

            <Transition name="opacity-fast">
              <div v-show="!btStatus" class="add-dock__step__error">
                <i class="fa-light fa-exclamation"></i>
                {{ $t("dock.add.start.bluetooth.warning") }}
              </div>
            </Transition>
          </div>
        </div>
      </Transition>

      <Transition :name="stepTransition">
        <div
          v-show="activeStep == DockSetupScreen.DISCOVERY"
          class="modal__body__step add-dock__step add-dock__step--discovery"
        >
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data"
          >
            <template v-if="!btDockSelected">
              <div class="add-dock__discover">
                <div
                  v-if="discoveryActive"
                  class="add-dock__discover__discovering"
                >
                  <img
                    src="/images/loading-indicator.png"
                    alt="Loading"
                    class="img-loading"
                  />
                  <span>{{ $t("dock.add.discover.discovering") }}</span>
                </div>
                <div
                  v-else-if="
                    discoveredDocks && Object.keys(discoveredDocks).length > 0
                  "
                  class="add-dock__discover__idle"
                >
                  <i class="fa-light fa-circle-check"></i>
                  <span>
                    {{
                      $t("dock.add.discover.discovered_dock", {
                        count: Object.keys(discoveredDocks).length,
                      })
                    }}
                  </span>
                </div>
                <div v-else class="add-dock__discover__no-dock">
                  <span>{{
                    $t("dock.add.discover.no_dock_discovered.title")
                  }}</span>
                  <div v-markdown-tools class="markdown-wrapper">
                    <vue-markdown
                      :source="$t('dock.add.discover.no_dock_discovered.help')"
                      class="vue-markdown"
                    />
                  </div>
                  <div class="link-box">
                    <span class="link-box__title">{{
                      $t(
                        "dock.add.discover.no_dock_discovered.support_articles.title",
                      )
                    }}</span>
                    <ul>
                      <li>
                        <a
                          href="https://support.unfoldedcircle.com/hc/en-us/articles/20081754782876-Dock-3-Bluetooth-LE-setup"
                          target="_blank"
                        >
                          <i class="fa-light fa-circle-info"></i>
                          {{
                            $t(
                              "dock.add.discover.no_dock_discovered.support_articles.article_1",
                            )
                          }}
                        </a>
                      </li>
                      <li>
                        <a
                          href="https://support.unfoldedcircle.com/hc/en-us/articles/20018666460956-Add-a-new-Dock-in-the-Web-Configurator"
                          target="_blank"
                        >
                          <i class="fa-light fa-circle-info"></i>
                          {{
                            $t(
                              "dock.add.discover.no_dock_discovered.support_articles.article_2",
                            )
                          }}
                        </a>
                      </li>
                      <li>
                        <a
                          href="https://support.unfoldedcircle.com/hc/en-us/articles/20018912602524-Manually-add-a-Dock-in-the-Web-Configurator"
                          target="_blank"
                        >
                          <i class="fa-light fa-circle-info"></i>
                          {{
                            $t(
                              "dock.add.discover.no_dock_discovered.support_articles.article_3",
                            )
                          }}
                        </a>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              <UCSearch
                v-if="
                  discoveredDocks && Object.keys(discoveredDocks).length > 0
                "
                v-model="searchText"
                :gray="true"
              />

              <div
                v-if="discoveredList && discoveredList.length > 0"
                v-overflow-indicator
                class="add-dock__list"
              >
                <div
                  v-for="option in discoveredList"
                  :key="option.id"
                  class="add-dock__item"
                  @click="startSetup(option)"
                >
                  <div class="add-dock__item__icon">
                    <i
                      v-if="option.discovery_type == DockDiscoveryType.BT"
                      class="fa-thin fa-bluetooth"
                    ></i>
                    <i v-else class="fa-thin fa-ethernet"></i>
                  </div>
                  <div class="add-dock__item__text">
                    <h4 class="add-dock__item__id">
                      {{ option.friendly_name || option.id }}
                    </h4>
                    <p class="add-dock__item__address">{{ option.address }}</p>
                  </div>
                  <div class="add-dock__item__date">
                    <span v-if="option.bt?.last_seen_sec">
                      {{
                        $t("dock.add.discover.last_seen", {
                          sec: option.bt?.last_seen_sec,
                        })
                      }}
                    </span>
                  </div>
                </div>
              </div>
            </template>

            <div v-if="btDockSelected" class="add-dock__pre-warn">
              <p class="add-dock__step__description">
                {{ $t("dock.add.discover.bt_pre_warn") }}
              </p>
            </div>
          </div>
        </div>
      </Transition>

      <Transition :name="stepTransition">
        <div
          v-show="
            activeStep == DockSetupScreen.ADD_MANUALLY ||
            activeStep == DockSetupScreen.ADD_DISCOVERED_NET ||
            activeStep == DockSetupScreen.ADD_DISCOVERED_BT
          "
          class="modal__body__step add-dock__step add-dock__step--data-form"
        >
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data"
          >
            <div v-if="discovered != null" class="add-dock__step__discovered">
              <div class="add-dock__step__discovered__card">
                <div class="add-dock__step__discovered__card__icon">
                  <i
                    v-if="discovered.discovery_type == DockDiscoveryType.BT"
                    class="fa-thin fa-bluetooth"
                  ></i>
                  <i v-else class="fa-thin fa-ethernet"></i>
                </div>

                <div class="add-dock__step__discovered__card__text">
                  <h4 class="add-dock__step__discovered__card__id">
                    {{ discovered.friendly_name || discovered.id }}
                  </h4>
                  <p class="add-dock__step__discovered__card__address">
                    {{ discovered.address }}
                  </p>
                </div>

                <div class="add-dock__step__discovered__card__state">
                  <span v-if="discovered.bt?.last_seen_sec">
                    {{
                      $t("dock.add.discover.last_seen", {
                        sec: discovered.bt?.last_seen_sec,
                      })
                    }}
                  </span>
                  <div
                    v-if="discovered.configured"
                    class="add-dock__step__discovered__card__state__configured"
                  >
                    <i class="fa-regular fa-check"></i>
                  </div>
                </div>
              </div>
            </div>

            <p v-if="discovered != null" class="add-dock__step__description">
              {{ $t("dock.add.add_discovered.instruction") }}
            </p>

            <template v-else>
              <span class="add-dock__step__title">{{
                $t("dock.add.add_manually.title")
              }}</span>
              <p class="add-dock__step__description">
                {{ $t("dock.add.add_manually.instruction") }}
              </p>
            </template>

            <UCInput
              v-model="formData.name"
              :label="$t('form.name')"
              :full-w="true"
            />
            <UCInput
              v-model="formData.password"
              :label="$t('form.password')"
              :description="$t('dock.add.form.password_description')"
              :type="'password'"
              :full-w="true"
            />
            <UCInput
              v-if="manual"
              v-model="formData.address"
              :label="$t('dock.add.form.ip_address')"
              :description="$t('dock.add.form.ip_address_description')"
              :type="'url'"
              :full-w="true"
            />
            <UCToggle
              v-if="!isBt"
              v-model="formData.wifiOn"
              :label="$t('dock.add.form.setup_wifi')"
              :full-w="true"
            />
            <Transition name="opacity-fast">
              <UCInput
                v-if="formData.wifiOn || wifiCredentials"
                v-model="formData.wifiSSID"
                :label="$t('dock.add.form.wifi_ssid')"
                :full-w="true"
              />
            </Transition>
            <Transition name="opacity-fast">
              <UCInput
                v-if="formData.wifiOn || wifiCredentials"
                v-model="formData.wifiPassword"
                :label="$t('dock.add.form.wifi_password')"
                :type="'password'"
                :full-w="true"
              />
            </Transition>
          </div>
        </div>
      </Transition>

      <Transition :name="stepTransition">
        <div
          v-show="activeStep == DockSetupScreen.CONFIGURING"
          class="modal__body__step add-dock__step add-dock__step--configuring"
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
            <p class="add-dock__step__description">
              {{ $t("dock.add.setup_process.configuring") }}
            </p>
            <span
              v-if="
                isDock3 &&
                discovered != null &&
                discovered.discovery_type == DockDiscoveryType.BT
              "
              class="add-dock__step__instruction"
            >
              {{ $t("dock.add.setup_process.press_control_button") }}
            </span>
          </div>
        </div>
      </Transition>

      <Transition :name="stepTransition">
        <div
          v-show="activeStep == DockSetupScreen.RESULT_ERROR"
          class="modal__body__step add-dock__step add-dock__step--error"
        >
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data"
          >
            <div v-if="discovered != null" class="add-dock__step__discovered">
              <div
                class="add-dock__step__discovered__card add-dock__step__discovered__card--fail"
              >
                <div class="add-dock__step__discovered__card__icon">
                  <i
                    v-if="discovered.discovery_type == DockDiscoveryType.BT"
                    class="fa-thin fa-bluetooth"
                  ></i>
                  <i v-else class="fa-thin fa-ethernet"></i>
                </div>

                <div class="add-dock__step__discovered__card__text">
                  <h4 class="add-dock__step__discovered__card__id">
                    {{ discovered.friendly_name || discovered.id }}
                  </h4>
                  <p class="add-dock__step__discovered__card__address">
                    {{ discovered.address }}
                  </p>
                </div>

                <div class="add-dock__step__discovered__card__state">
                  <div class="add-dock__step__discovered__card__state__fail">
                    <i class="fa-light fa-circle-xmark"></i>
                  </div>
                </div>
              </div>
            </div>

            <span class="add-dock__step__title">{{
              $t("dock.add.error.title")
            }}</span>
            <p class="add-dock__step__description">
              {{ $t("dock.add.error.description") }}
            </p>
            <p
              v-if="lastChangeMessage && lastChangeMessage.error"
              class="add-dock__step__error"
            >
              {{
                $t(`dock.add.setup_process.error.${lastChangeMessage.error}`)
              }}
            </p>
          </div>
        </div>
      </Transition>

      <Transition :name="stepTransition">
        <div
          v-show="activeStep == DockSetupScreen.RESULT_SUCCESS"
          class="modal__body__step add-dock__step add-dock__step--success"
        >
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data"
          >
            <div v-if="discovered != null" class="add-dock__step__discovered">
              <div class="add-dock__step__discovered__card">
                <div class="add-dock__step__discovered__card__icon">
                  <i
                    v-if="discovered.discovery_type == DockDiscoveryType.BT"
                    class="fa-thin fa-bluetooth"
                  ></i>
                  <i v-else class="fa-thin fa-ethernet"></i>
                </div>

                <div class="add-dock__step__discovered__card__text">
                  <h4 class="add-dock__step__discovered__card__id">
                    {{ discovered.friendly_name || discovered.id }}
                  </h4>
                  <p class="add-dock__step__discovered__card__address">
                    {{ discovered.address }}
                  </p>
                </div>

                <div class="add-dock__step__discovered__card__state">
                  <div class="add-dock__step__discovered__card__state__success">
                    <i class="fa-light fa-circle-check"></i>
                  </div>
                </div>
              </div>
            </div>

            <span class="add-dock__step__title">{{
              $t("dock.add.success.title")
            }}</span>
            <p
              v-if="
                (discovered != null &&
                  (discovered.friendly_name || discovered.id)) ||
                (formData && formData.name)
              "
              class="add-dock__step__description"
            >
              {{ $t("dock.add.success.description1") }}<br /><br />
              <span>
                {{
                  $t("dock.add.success.description2", {
                    name:
                      discovered != null &&
                      (discovered.friendly_name || discovered.id)
                        ? discovered.friendly_name || discovered.id
                        : formData.name,
                  })
                }}
              </span>
            </p>
          </div>
        </div>
      </Transition>
      <template v-if="activeStep != DockSetupScreen.CONFIGURING" #footer>
        <div
          v-if="activeStep == DockSetupScreen.START"
          class="add-dock__footer-buttons"
        >
          <button class="button button--tertiary" @click="startManualSetup">
            {{ $t("dock.add.start.manual_setup") }}
          </button>
          <button class="button button--primary" @click="doStartDiscovery">
            {{ $t("dock.add.start.discover") }}
          </button>
        </div>
        <template v-else-if="activeStep == DockSetupScreen.DISCOVERY">
          <div v-if="btDockSelected" class="add-dock__footer-buttons">
            <button class="button button--tertiary" @click="cancelDiscovery">
              {{ $t("ui.cancel") }}
            </button>
            <button class="button button--primary" @click="doBtStartSetup">
              {{ $t("ui.next") }}
            </button>
          </div>
          <div
            v-else-if="
              !btDockSelected &&
              !discoveryActive &&
              (!discoveredDocks || Object.keys(discoveredDocks).length < 1)
            "
            class="add-dock__footer-buttons"
          >
            <button class="button button--tertiary" @click="cancelDiscovery">
              {{ $t("ui.cancel") }}
            </button>
            <button class="button button--secondary" @click="startDiscovery">
              {{ $t("dock.add.start.discover") }}
            </button>
          </div>
          <button
            v-else
            class="button button--tertiary button--min-w"
            @click="cancelDiscovery"
          >
            {{ $t("ui.cancel") }}
          </button>
        </template>
        <button
          v-else-if="
            activeStep == DockSetupScreen.ADD_MANUALLY ||
            activeStep == DockSetupScreen.ADD_DISCOVERED_NET ||
            activeStep == DockSetupScreen.ADD_DISCOVERED_BT
          "
          :disabled="!isSetupValid || startingSetupProcess"
          class="button button--secondary button--min-w"
          @click.stop="startSetupProcess"
        >
          {{ $t("ui.next") }}
        </button>
        <div
          v-else-if="activeStep == DockSetupScreen.RESULT_ERROR"
          class="add-dock__footer-buttons"
        >
          <button class="button button--tertiary" @click="closeAddWorkflow">
            {{ $t("ui.cancel") }}
          </button>
          <button
            class="button button--secondary"
            @click="tryAgainDiscoveredSetupProcess"
          >
            {{ $t("ui.try_again") }}
          </button>
        </div>
        <button
          v-else-if="activeStep == DockSetupScreen.RESULT_SUCCESS"
          class="button button--secondary button--min-w"
          @click="closeAddWorkflow"
        >
          {{ $t("ui.done") }}
        </button>
      </template>
    </AppModal>
  </Teleport>
</template>
