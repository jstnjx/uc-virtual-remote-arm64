<script setup lang="ts">
import { computed, ref } from "vue";

import type {
  DriverConnectionTestResult,
  IntegrationDriver,
} from "@/types/integrationInstance";
import { IntegrationSetupScreen } from "@/types/enums";

import { integrationsStore } from "@/stores/integrations";
import translatedProperty from "@/composables/translatedProperty";
import { getErrorMessage, asError } from "@/composables/error";

import UCInput from "@/components/ui/UCInput.vue";
import { addErrorFull } from "@/stores/messages";

const props = defineProps({
  driver: {
    type: Object,
    required: true,
  },
  modeAdvanced: {
    type: Boolean,
    required: false,
  },
  screen: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["connection-ok", "connection-failed"]);
const store = integrationsStore();

enum TEST_STATE {
  NONE = "NONE",
  TESTING = "TESTING",
  OK = "OK",
  FAILED = "FAILED",
}

const driver = ref(props.driver as IntegrationDriver);
const url = ref(driver.value.driver_url);
const token = ref("");
const testState = ref<TEST_STATE>(TEST_STATE.NONE);
const testResult = ref<DriverConnectionTestResult | null>(null);

const isValidPass = computed(() => {
  if (driver.value.pwd_protected) {
    return Boolean(token.value);
  }
  return true;
});

const isValidUrl = computed(() => {
  return Boolean(url.value);
});

const validForSubmit = computed(() => {
  return isValidPass.value && isValidUrl.value;
});

async function registerIntegration() {
  if (!validForSubmit.value) {
    return;
  }
  try {
    const result = await store.registerIntegration(
      driver.value.driver_id,
      url.value,
      token.value || undefined,
    );
    emit("connection-ok", result);
  } catch (e) {
    addErrorFull(e);
    emit("connection-failed");
  }
}

function resetTest() {
  testState.value = TEST_STATE.NONE;
  testResult.value = null;
}

async function testConnection() {
  if (!validForSubmit.value || testState.value === TEST_STATE.TESTING) {
    return;
  }

  testState.value = TEST_STATE.TESTING;
  try {
    testResult.value = await store.testConnection(
      driver.value.driver_id,
      url.value,
      token.value || undefined,
    );
    testState.value = testResult.value.result
      ? TEST_STATE.OK
      : TEST_STATE.FAILED;
  } catch (e) {
    testState.value = TEST_STATE.FAILED;
    // let key_status = `integration.add.connect_external.test_failed.e_${args.status}`;
    // if (!i18next.exists(key_status)) {
    //   key_status = `integration.add.connect_external.test_failed.UNKNOWN`;
    // }
    testResult.value = {
      code: asError(e).response?.status || 500,
      result: false,
      message: getErrorMessage(
        e,
        "integration.add.connect_external.test_connection",
      )?.message,
    };
  }
}
</script>
<template>
  <div class="modal__body">
    <Transition :name="'slide-tab-left'">
      <div
        v-show="screen === IntegrationSetupScreen.CONNECT_EXTERNAL"
        class="modal__body__step add-integration__step add-integration__step--connect-external"
      >
        <div
          v-overflow-indicator
          class="modal__body__step__body modal--add__base-data"
        >
          <div class="add-integration__configuration-form">
            <span class="add-integration__step__title">
              {{ $t("integration.add.connect_external.title") }}
            </span>

            <UCInput
              v-model="url"
              :label="$t('integration.add.connect_external.driver_url')"
              :type="'url'"
              :full-w="true"
              :invalid="!isValidUrl"
              @click="resetTest"
            />

            <UCInput
              v-model="token"
              :label="$t('integration.add.connect_external.access_token')"
              :description="!driver.pwd_protected ? $t('form.optional') : ''"
              :type="'password'"
              :full-w="true"
              :invalid="!isValidPass"
              @click="resetTest"
            />

            <Transition name="opacity-fast">
              <div
                v-if="testState === TEST_STATE.FAILED"
                class="add-integration__step__error"
              >
                <i class="fa-light fa-exclamation"></i>
                {{ $t("integration.add.connect_external.failed") }}
                <template v-if="testResult?.message">{{
                  testResult.message
                }}</template>
              </div>
            </Transition>

            <Transition name="opacity-fast">
              <div
                v-if="testState === TEST_STATE.OK && testResult?.driver"
                class="databoard"
              >
                <div class="databoard__row">
                  <div class="databoard__item">
                    <span class="databoard__item__label">{{
                      $t("integration.add.label.connection_test")
                    }}</span>
                  </div>
                  <div class="databoard__item">
                    <span
                      class="databoard__item__value databoard__item__value--status databoard__item__value--green"
                    >
                      <i class="fa-light fa-circle-check"></i>
                      <span>{{ $t("form.successful") }}</span>
                    </span>
                  </div>
                </div>
                <div class="databoard__row">
                  <div class="databoard__item">
                    <span class="databoard__item__label">{{
                      $t("integration.add.label.version")
                    }}</span>
                    <span class="databoard__item__value">{{
                      testResult?.driver.version
                    }}</span>
                  </div>
                  <div
                    v-if="testResult?.driver?.developer?.name"
                    class="databoard__item"
                  >
                    <span class="databoard__item__label">{{
                      $t("integration.add.label.developer")
                    }}</span>
                    <span class="databoard__item__value">{{
                      testResult?.driver?.developer?.name
                    }}</span>
                  </div>
                </div>
                <div class="databoard__row">
                  <div
                    v-if="
                      testResult?.driver?.developer?.url ||
                      testResult?.driver?.home_page
                    "
                    class="databoard__item"
                  >
                    <span class="databoard__item__label">{{
                      $t("integration.add.label.developer_website")
                    }}</span>
                    <a
                      class="databoard__item__value databoard__item__value--url"
                      :href="
                        testResult?.driver?.developer?.url ||
                        testResult?.driver?.home_page
                      "
                      :title="
                        testResult?.driver?.developer?.url ||
                        testResult?.driver?.home_page
                      "
                      target="_blank"
                    >
                      {{
                        testResult?.driver?.developer?.url ||
                        testResult?.driver?.home_page
                      }}
                    </a>
                  </div>
                </div>
                <div
                  v-if="
                    testResult?.driver &&
                    testResult?.driver?.description &&
                    translatedProperty(testResult?.driver?.description).length >
                      0
                  "
                  class="databoard__row"
                >
                  <span class="databoard__text">{{
                    translatedProperty(testResult?.driver?.description)
                  }}</span>
                </div>
                <div v-else-if="driver.name" class="databoard__row">
                  <span class="databoard__text">
                    {{
                      $t("integration.add.connect_external.instruction", {
                        name: translatedProperty(driver.name),
                      })
                    }}
                  </span>
                </div>
              </div>
            </Transition>
          </div>

          <div
            v-if="testState !== TEST_STATE.OK"
            class="add-integration__step__buttons"
          >
            <button
              :disabled="!validForSubmit"
              class="button button--tertiary"
              @click="testConnection"
            >
              {{ $t("integration.add.connect_external.test_connection.title") }}
            </button>
            <button
              :disabled="!validForSubmit"
              class="button button--primary"
              @click="registerIntegration"
            >
              {{ $t("ui.next") }}
            </button>
          </div>
          <button
            v-else
            :disabled="!validForSubmit"
            class="button button--primary button--min-w"
            @click="registerIntegration"
          >
            {{ $t("ui.next") }}
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
