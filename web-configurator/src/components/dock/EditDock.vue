<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useTranslation } from "i18next-vue";

import { SettingTypes, DockState } from "@/types/enums";
import type { ChangeCallbackParams } from "@/types/config";
import type { DockConfiguration, DockPort } from "@/types/dock";

import { docksStore } from "@/stores/docks";
import { addErrorBottom } from "@/stores/messages";

import router from "@/composables/router";
import { deepClone, useDataHelper } from "@/composables/dataHelper";

import UCInput from "@/components/ui/UCInput.vue";
import UCRange from "@/components/ui/UCRange.vue";
// import UCToggle from "@/components/ui/UCToggle.vue";
import EditDockChangePass from "@/components/dock/edit/ChangePass.vue";
import EditDockWifiSettings from "@/components/dock/edit/WifiSettings.vue";
import EditDockEditPort from "@/components/dock/edit/EditPort.vue";
import FirmwareUpdate from "@/components/dock/edit/FirmwareUpdate.vue";
import FactoryReset from "@/components/dock/edit/FactoryReset.vue";
import DockIllustration from "@/components/dock/DockIllustration.vue";

const { t } = useTranslation();
const { updateExistingObjectKeys } = useDataHelper();

const docksStorage = docksStore();

const props = defineProps({
  dockId: {
    type: String,
    required: true,
  },
});

const dock = ref<DockConfiguration | null>(null);
const dockValues = ref<Record<string, any>>({});

const loading = ref(false);
// const microphone = ref(false);

const activePort = ref(-1);

docksStorage.$onAction(({ name, args, after }) => {
  if (name !== "socketUpdate") {
    return;
  }
  after(() => {
    const { dock_id, event_type } = args[0];
    if (dock_id !== props.dockId) {
      return;
    }
    if (event_type === "DELETE") {
      goToList();
    } else if (
      dock_id === props.dockId &&
      event_type === "CHANGE" &&
      args[0] &&
      args[0].new_state
    ) {
      const updDock = updateExistingObjectKeys(
        deepClone(dock.value!),
        args[0].new_state,
      );
      setDock(updDock);
    } else if (
      dock_id === props.dockId &&
      args[0] &&
      args[0].port &&
      dock.value &&
      dock.value.ports
    ) {
      // dock port payload → narrow the open leaf here (ADR 0002).
      const port = args[0].port as DockPort;
      const portIndex = (dock.value.ports || []).findIndex(
        (o) => port.port && o.port == port.port,
      );
      if (portIndex > -1) {
        dock.value.ports[portIndex] = port;
      }
    } else if (
      dock_id === props.dockId &&
      args[0] &&
      args[0].state &&
      dock.value &&
      dock.value.state
    ) {
      dock.value.state = args[0].state as DockState;
    }
  });
});

const brightnessSetting = computed(() => {
  return {
    name: "led_brightness",
    value: dockValues.value.brightness,
    label: t("dock.label.led_brightness"),
    type: SettingTypes.PERCENT,
  };
});

const isActive = computed(() => {
  return (
    dock.value != null &&
    (dock.value as DockConfiguration).state == DockState.ACTIVE
  );
});

const isDockTwo = computed(() => {
  return (
    (dock.value && (dock.value as DockConfiguration).model?.includes("UCD2")) ||
    false
  );
});

async function getDock() {
  try {
    const currentDock = await docksStorage.getDock(props.dockId);
    if (currentDock) {
      setDock(currentDock);
    }
  } catch (e) {
    addErrorBottom(e);
  }
}

function setDock(newValue: DockConfiguration) {
  dock.value = newValue;
  dockValues.value.name = newValue.name;
  dockValues.value.url = newValue.custom_ws_url || "";
  dockValues.value.brightness = newValue.led_brightness;
}

async function changeItemName(message: any) {
  if (dock.value == null || !dock.value.dock_id) {
    return;
  }

  try {
    const newDockData = await docksStorage.changeDockName(
      dock.value.dock_id,
      message,
    );
    setDock(newDockData);
  } catch (e) {
    addErrorBottom(e);
  }
}

async function changeItemUrl(message: any) {
  if (dock.value == null || !dock.value.dock_id) {
    return;
  }

  try {
    const newDockData = await docksStorage.changeDockUrl(
      dock.value.dock_id,
      message,
    );
    setDock(newDockData);
  } catch (e) {
    addErrorBottom(e);
  }
}

async function brightnessChanged(params: ChangeCallbackParams) {
  if (dock.value == null || !dock.value.dock_id) {
    return;
  }
  try {
    await docksStorage.setDockBrightness(
      dock.value.dock_id,
      params.value as number,
    );
  } catch (e) {
    addErrorBottom(e);
  }
}

async function identifyDock() {
  if (dock.value == null || !dock.value.dock_id) {
    return;
  }

  try {
    await docksStorage.identifyDock(dock.value.dock_id);
  } catch (e) {
    addErrorBottom(e);
  }
}

function goToList() {
  router.push({
    name: "integrations",
  });
}

function setActivePort(index: number) {
  activePort.value = index;
}

function getPortModeLabel(index: number) {
  if (
    dock.value &&
    dock.value.ports &&
    dock.value.ports[index].mode == "AUTO"
  ) {
    return dock.value.ports[index].active_mode
      ? t(
          `dock.port.mode.${dock.value.ports[index].active_mode}`,
          dock.value.ports[index].active_mode,
        )
      : t("dock.port.mode.UNKNOWN");
  }

  if (
    dock.value &&
    dock.value.ports &&
    dock.value.ports[index].mode != "AUTO"
  ) {
    if (dock.value.ports[index].mode) {
      return t(
        `dock.port.mode.${dock.value.ports[index].mode}`,
        dock.value.ports[index].mode,
      );
    } else {
      return t("dock.port.mode.UNKNOWN");
    }
  }

  return t("dock.port.mode.UNKNOWN");
}

function getPortModeIndicator(index: number) {
  if (
    isDockTwo.value ||
    (dock.value && dock.value.ports && dock.value.ports[index].mode == "NONE")
  ) {
    return "fa-light fa-ban";
  }

  if (
    dock.value &&
    dock.value.ports &&
    dock.value.ports[index].mode == "AUTO"
  ) {
    return "fa-light fa-a";
  }

  return "fa-light fa-m";
}

async function onFirmwareUpdateSuccess(newVersion?: string) {
  if (newVersion && dock.value) {
    dock.value.version = newVersion;
  }
}

function closedEditPort() {
  setActivePort(-1);
}

onMounted(async () => {
  loading.value = true;
  await getDock();
  loading.value = false;
});
</script>
<template>
  <div class="ep-settings">
    <div v-overflow-indicator class="ep-settings__form panel-col panel-col--40">
      <div class="ep-settings__form__wrapper">
        <UCInput
          v-if="dock"
          v-model="dockValues.name"
          :full-w="true"
          :label="$t('form.name')"
          :disabled="!isActive"
          @submit="changeItemName"
        />
        <!-- Custom URL stays editable when disconnected: stored on Remote, not propagated to Dock -->
        <UCInput
          v-if="dock"
          v-model="dockValues.url"
          :full-w="true"
          :label="$t('dock.form.custom_ip_or_url')"
          @submit="changeItemUrl"
        />
        <div v-if="dock" class="ep-settings__dock-config">
          <EditDockChangePass :dock="dock" />
          <EditDockWifiSettings :dock="dock" />
        </div>
        <div v-if="dock && isActive" class="ep-settings__dock-mobile-config">
          <UCRange
            v-model="dockValues.brightness"
            name="dock-led-brightness"
            :definition="brightnessSetting"
            :compact="true"
            @change="brightnessChanged"
          />
          <div
            v-for="(port, index) in dock.ports"
            :key="port.port"
            class="select-extra select-extra--divider select-extra--ports"
          >
            <div class="select-extra__text">
              <span class="select-extra__label">
                {{ $t("dock.port.title") }} {{ index + 1 }}
              </span>
            </div>
            <button
              :disabled="isDockTwo"
              class="button button--secondary"
              :class="{ 'button--hybrid button--hybrid--reversed': !isDockTwo }"
              @click="setActivePort(index)"
            >
              {{ getPortModeLabel(index) }}
              <i v-if="!isDockTwo" :class="getPortModeIndicator(index)"></i>
            </button>
          </div>
          <button
            class="button button--secondary button--min-w"
            @click="identifyDock"
          >
            {{ $t("ui.identify") }}
          </button>
        </div>
        <div class="ep-settings__form__footer">
          <FirmwareUpdate
            v-if="dock"
            :dock="dock"
            :is-active="isActive"
            @success="onFirmwareUpdateSuccess"
          />
          <div class="ep-settings__form__footer__row">
            <div class="ep-settings__form__meta">
              <span class="ep-settings__form__meta__label">{{
                $t("dock.label.state")
              }}</span>
            </div>
            <div
              class="ep-settings__form__meta ep-settings__form__meta--item-status"
              :class="`ep-settings__form__meta--${isActive ? 'green' : 'red'}`"
            >
              <template v-if="dock && dock.state">
                <i
                  class="fa-light"
                  :class="isActive ? 'fa-circle-check' : 'fa-circle-xmark'"
                ></i>
                <span>{{
                  dock.state
                    ? $t(`dock.status.${dock.state}`)
                    : $t(`dock.status.UNKNOWN`)
                }}</span>
              </template>
            </div>
          </div>
          <div
            class="ep-settings__form__footer__row ep-settings__form__footer__row--dock-factory-reset"
          >
            <div class="ep-settings__form__meta">
              <template v-if="dock && dock.dock_id">
                <span class="ep-settings__form__meta__label">{{
                  $t("dock.label.service_name")
                }}</span>
                <span class="ep-settings__form__meta__value">{{
                  dock.dock_id
                }}</span>
              </template>
            </div>
            <div class="ep-settings__form__meta">
              <FactoryReset
                v-if="dock && isActive"
                :dock="dock"
                @done="goToList"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="panel-col panel-col--60 panel-col--visual-config">
      <div class="dock-visual-config">
        <div class="dock-visual-config__image">
          <DockIllustration v-if="dock" :dock="dock" />
        </div>
        <template v-if="dock && isActive">
          <div
            class="dock-visual-config__item dock-visual-config__item--top-left dock-visual-config__item--identify"
          >
            <button class="button button--secondary" @click="identifyDock">
              {{ $t("ui.identify") }}
            </button>
          </div>
          <template v-if="dock.ports">
            <div
              v-if="dock.ports[1]"
              class="dock-visual-config__item dock-visual-config__item--top-left dock-visual-config__item--port-2"
            >
              <span class="dock-visual-config__item__label"
                >{{ $t("dock.port.title") }} 2</span
              >
              <button
                :disabled="isDockTwo"
                class="button button--secondary"
                :class="{
                  'button--hybrid button--hybrid--reversed': !isDockTwo,
                }"
                @click="setActivePort(1)"
              >
                {{ getPortModeLabel(1) }}
                <i v-if="!isDockTwo" :class="getPortModeIndicator(1)"></i>
              </button>
            </div>
            <div
              v-if="dock.ports[0]"
              class="dock-visual-config__item dock-visual-config__item--top-right dock-visual-config__item--port-1"
            >
              <span class="dock-visual-config__item__label"
                >{{ $t("dock.port.title") }} 1</span
              >
              <button
                :disabled="isDockTwo"
                class="button button--secondary"
                :class="{
                  'button--hybrid button--hybrid--reversed': !isDockTwo,
                }"
                @click="setActivePort(0)"
              >
                {{ getPortModeLabel(0) }}
                <i v-if="!isDockTwo" :class="getPortModeIndicator(0)"></i>
              </button>
            </div>

            <div
              v-if="dock.ports.length > 3"
              class="dock-visual-config__item dock-visual-config__item--top-right dock-visual-config__item--port-col-left"
            >
              <div v-if="dock.ports[3]" class="dock-visual-config__item__row">
                <span class="dock-visual-config__item__label"
                  >{{ $t("dock.port.title") }} 4</span
                >
                <button
                  :disabled="isDockTwo"
                  class="button button--secondary"
                  :class="{
                    'button--hybrid button--hybrid--reversed': !isDockTwo,
                  }"
                  @click="setActivePort(3)"
                >
                  {{ getPortModeLabel(3) }}
                  <i v-if="!isDockTwo" :class="getPortModeIndicator(3)"></i>
                </button>
              </div>
              <div v-if="dock.ports[5]" class="dock-visual-config__item__row">
                <span class="dock-visual-config__item__label"
                  >{{ $t("dock.port.title") }} 6</span
                >
                <button
                  :disabled="isDockTwo"
                  class="button button--secondary"
                  :class="{
                    'button--hybrid button--hybrid--reversed': !isDockTwo,
                  }"
                  @click="setActivePort(5)"
                >
                  {{ getPortModeLabel(5) }}
                  <i v-if="!isDockTwo" :class="getPortModeIndicator(5)"></i>
                </button>
              </div>
              <div v-if="dock.ports[7]" class="dock-visual-config__item__row">
                <span class="dock-visual-config__item__label"
                  >{{ $t("dock.port.title") }} 8</span
                >
                <button
                  :disabled="isDockTwo"
                  class="button button--secondary"
                  :class="{
                    'button--hybrid button--hybrid--reversed': !isDockTwo,
                  }"
                  @click="setActivePort(7)"
                >
                  {{ getPortModeLabel(7) }}
                  <i v-if="!isDockTwo" :class="getPortModeIndicator(7)"></i>
                </button>
              </div>
            </div>

            <div
              v-if="dock.ports.length > 2"
              class="dock-visual-config__item dock-visual-config__item--top-left dock-visual-config__item--port-col-right"
            >
              <div v-if="dock.ports[2]" class="dock-visual-config__item__row">
                <span class="dock-visual-config__item__label"
                  >{{ $t("dock.port.title") }} 3</span
                >
                <button
                  :disabled="isDockTwo"
                  class="button button--secondary"
                  :class="{
                    'button--hybrid button--hybrid--reversed': !isDockTwo,
                  }"
                  @click="setActivePort(2)"
                >
                  {{ getPortModeLabel(2) }}
                  <i v-if="!isDockTwo" :class="getPortModeIndicator(2)"></i>
                </button>
              </div>
              <div v-if="dock.ports[4]" class="dock-visual-config__item__row">
                <span class="dock-visual-config__item__label"
                  >{{ $t("dock.port.title") }} 5</span
                >
                <button
                  :disabled="isDockTwo"
                  class="button button--secondary"
                  :class="{
                    'button--hybrid button--hybrid--reversed': !isDockTwo,
                  }"
                  @click="setActivePort(4)"
                >
                  {{ getPortModeLabel(4) }}
                  <i v-if="!isDockTwo" :class="getPortModeIndicator(4)"></i>
                </button>
              </div>
              <div v-if="dock.ports[6]" class="dock-visual-config__item__row">
                <span class="dock-visual-config__item__label"
                  >{{ $t("dock.port.title") }} 7</span
                >
                <button
                  :disabled="isDockTwo"
                  class="button button--secondary"
                  :class="{
                    'button--hybrid button--hybrid--reversed': !isDockTwo,
                  }"
                  @click="setActivePort(6)"
                >
                  {{ getPortModeLabel(6) }}
                  <i v-if="!isDockTwo" :class="getPortModeIndicator(6)"></i>
                </button>
              </div>
            </div>
          </template>
          <!-- <div class="dock-visual-config__item dock-visual-config__item--bottom-left dock-visual-config__item--microphone">
            <UCToggle
              v-model="microphone"
              :label="$t('dock.label.microphone')"
              :full-w="true"
            />
          </div> -->

          <div
            class="dock-visual-config__item dock-visual-config__item--bottom dock-visual-config__item--led-brightness"
          >
            <UCRange
              v-model="dockValues.brightness"
              name="dock-led-brightness"
              :definition="brightnessSetting"
              :default-value="50"
              :compact="true"
              @change="brightnessChanged"
            />
          </div>
          <!-- <div class="dock-visual-config__item dock-visual-config__item--bottom dock-visual-config__item--speaker-volume">
            <UCRange
              v-model="dockValues.brightness"
              name="dock-led-brightness"
              :key="'dock-led-brightness-value'"
              :definition="brightnessSetting"
              :change-callback="brightnessChanged"
              :value="dockValues.brightness!"
              :compact="true"
            />
          </div> -->
        </template>
      </div>
    </div>
    <EditDockEditPort
      v-if="dock && dock.ports"
      :dock-id="dockId"
      :port="dock.ports[activePort] || null"
      @closed="closedEditPort"
      @saved="getDock"
    />
  </div>
</template>
