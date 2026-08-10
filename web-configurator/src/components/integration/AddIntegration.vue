<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";

import { DriverType, IntegrationSetupScreen } from "@/types/enums";
import type {
  IntegrationDriver,
  IntegrationInstance,
} from "@/types/integrationInstance";

import { integrationsStore } from "@/stores/integrations";

import translatedProperty from "@/composables/translatedProperty";

import AppModal from "@/components/elements/AppModal.vue";
import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";
import ConnectExternalScreen from "@/components/integration/add/ConnectExternalScreen.vue";
import SetupScreen from "@/components/integration/add/SetupScreen.vue";
import { addErrorFull, addErrorBottom } from "@/stores/messages";

const store = integrationsStore();

const props = defineProps({
  modeAdvanced: {
    type: Boolean,
    default: false,
  },
});

defineExpose({
  startSetup,
  doStartRegisterExternal,
  startNotConfiguredDriverSetup,
});

const emit = defineEmits(["close"]);

const showModal = ref(false);
const screen = ref<IntegrationSetupScreen>(IntegrationSetupScreen.START);
const selectedDriver = ref<IntegrationDriver | null>(null);
const setupScreen =
  useTemplateRef<InstanceType<typeof SetupScreen>>("setupScreen");
const reconfigure = ref(false);
const configuredIntId = ref("");
const configuredIntegration = ref<IntegrationInstance | null>(null);

const configured = ref(false);

const isSetupScreen = computed(() => {
  return screen.value === IntegrationSetupScreen.SETUP;
});

function closeAddWorkflow() {
  showModal.value = false;
  setDefaults();
  setupScreen.value?.clickCancel();
  emit("close");
}

function doStartRegisterExternal(driver: IntegrationDriver) {
  showModal.value = true;
  if (props.modeAdvanced == true) {
    screen.value = IntegrationSetupScreen.CONNECT_EXTERNAL;
    selectedDriver.value = driver;
  } else {
    registerIntegration(driver);
  }
}

async function startSetup(
  driver: IntegrationDriver,
  reconf = false,
  integrationId?: string,
) {
  if (
    typeof driver.instance_count != "undefined" &&
    driver.instance_count > 0
  ) {
    configured.value = true;
  }

  reconfigure.value = reconf;
  if (integrationId) {
    configuredIntId.value = integrationId;
  }

  showModal.value = true;
  screen.value = IntegrationSetupScreen.SETUP;
  selectedDriver.value = driver;

  if (integrationId) {
    try {
      const intData = await store.getIntegration(integrationId, false);

      if (intData.inst) {
        configuredIntegration.value = intData.inst;
      }
    } catch (e) {
      addErrorBottom(e);
    }
  }
}

function startNotConfiguredDriverSetup(driver: IntegrationDriver) {
  startSetup(driver);
}

async function setupDone() {
  closeAddWorkflow();
}

async function registerIntegration(driver: IntegrationDriver) {
  try {
    const result = await store.registerIntegration(
      driver.driver_id,
      driver.driver_url,
      undefined,
    );
    startSetup(result);
  } catch (e) {
    addErrorFull(e);
    closeAddWorkflow();
  }
}

function setDefaults() {
  reconfigure.value = false;
  configuredIntId.value = "";
  configuredIntegration.value = null;
  configured.value = false;
  screen.value = IntegrationSetupScreen.START;
  selectedDriver.value = null;
}

function keyupEsc() {
  if (
    screen.value == IntegrationSetupScreen.RESULT_ERROR ||
    screen.value == IntegrationSetupScreen.RESULT_SUCCESS
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
      :body-cover="false"
      class="modal--steps modal--add add-integration"
      name="add-integration"
      @close="closeAddWorkflow"
      @keyup.esc.stop="keyupEsc"
    >
      <template #header>
        <template v-if="configuredIntegration != null">
          <SelectedIcon
            :icon="
              configuredIntegration.icon
                ? configuredIntegration.icon
                : 'uc:puzzle'
            "
          />
          <span
            v-if="configuredIntegration.name"
            class="add-integration__header__name"
            >{{ translatedProperty(configuredIntegration.name) }}</span
          >
        </template>
        <template v-else>
          <SelectedIcon
            :icon="
              selectedDriver && selectedDriver.icon
                ? selectedDriver.icon
                : 'uc:puzzle'
            "
          />
          <span
            v-if="selectedDriver && selectedDriver.name"
            class="add-integration__header__name"
            >{{ translatedProperty(selectedDriver.name) }}</span
          >
          <span
            v-if="
              selectedDriver &&
              selectedDriver.driver_type === DriverType.EXTERNAL
            "
            class="add-integration__header__badge"
            >{{ $t("integration.driver_type.external") }}</span
          >
        </template>
      </template>

      <ConnectExternalScreen
        v-if="
          selectedDriver && screen === IntegrationSetupScreen.CONNECT_EXTERNAL
        "
        :driver="selectedDriver"
        :screen="screen"
        :mode-advanced="modeAdvanced"
        @connection-ok="startSetup"
      />

      <SetupScreen
        v-if="isSetupScreen && selectedDriver"
        ref="setupScreen"
        :driver="selectedDriver"
        :instance-id="configuredIntId"
        :reconfigure="reconfigure"
        :configured="configured"
        @cancel="closeAddWorkflow"
        @done="setupDone"
      />
    </AppModal>
  </Teleport>
</template>
