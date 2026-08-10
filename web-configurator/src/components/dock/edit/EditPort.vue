<script setup lang="ts">
import { computed, ref, type PropType, useTemplateRef, watch } from "vue";
import { useTranslation } from "i18next-vue";

import type { DockPort, DockPortChange } from "@/types/dock";
import type { SelectOption } from "@/types/ui";
import { FlashMessageInfoStatus, DockPortMode } from "@/types/enums";

import { docksStore } from "@/stores/docks";
import { addErrorBottom } from "@/stores/messages";
import { addInfoFull, hideMessage } from "@/stores/messages";

import { useTiming } from "@/composables/timing";

import UCSelect from "@/components/ui/UCSelect.vue";
import ModalSecondary from "@/components/elements/ModalSecondary.vue";
import InfoPanel from "@/components/ui/InfoPanel.vue";
import { deepClone } from "@/composables/dataHelper";

const { t } = useTranslation();
const { sleep } = useTiming();

const props = defineProps({
  dockId: {
    type: String,
    required: true,
  },
  port: {
    type: Object as PropType<Record<string, any> | null>,
    default: null,
  },
});

const emit = defineEmits(["closed", "saved"]);

const dockStorage = docksStore();

const baudRateOptions = [
  300, 600, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200,
].map((n) => ({ label: n.toString(), value: n }));
const dataBitsOptions = [5, 6, 7, 8].map((n) => ({
  label: n.toString(),
  value: n,
}));
const stopBitsOptions = ["1", "1.5", "2"].map((n) => ({ label: n, value: n }));
// computed, not a plain array: t() only re-runs on a language change when it is
// read inside a tracked scope.
const parityOptions = computed(() => [
  { label: t("dock.port.labels.parity.none"), value: "none" },
  { label: t("dock.port.labels.parity.even"), value: "even" },
  { label: t("dock.port.labels.parity.odd"), value: "odd" },
]);

const port = ref<DockPort | null>(props.port as DockPort);
const showModal = ref(false);

const optionManual = computed(() => ({
  label: t("dock.port.mode.MANUAL"),
  value: DockPortMode.MANUAL,
}));
const baseModeOptions = computed(() => {
  let list = <{ label: string; value: string }[]>[];

  if (
    port.value &&
    (port.value?.supported_modes || []).indexOf(DockPortMode.AUTO) > -1
  ) {
    list = list.concat([
      { label: t("dock.port.mode.AUTO"), value: DockPortMode.AUTO },
    ]);
  }

  list = list.concat([optionManual.value]);

  return list;
});

const defaultBaudRateOption = computed(() => {
  const option = baudRateOptions.find((o) => o.value == 9600);
  return option ?? baudRateOptions[0];
});

const defaultDataBitsOption = computed(() => {
  const option = dataBitsOptions.find((o) => o.value == 8);
  return option ?? dataBitsOptions[0];
});

const defaultStopBitsOption = computed(() => {
  const option = stopBitsOptions.find((o) => o.value == "1");
  return option ?? { label: "", value: "" };
});

const defaultParityOption = computed(() => {
  const option = parityOptions.value.find((o) => o.value == "none");
  return option ?? { label: "", value: "" };
});

const mode = ref(baseModeOptions.value[1]);
const supportedMode = ref({ label: "", value: "" });

const baudRate = ref(defaultBaudRateOption.value);
const dataBits = ref(defaultDataBitsOption.value);
const stopBits = ref(defaultStopBitsOption.value);
const parity = ref(defaultParityOption.value);

const modalEditPort =
  useTemplateRef<InstanceType<typeof ModalSecondary>>("modalEditPort");

watch(props, () => {
  if (props.port && Object.keys(props.port).length > 0) {
    if (port.value == null || Object.keys(port.value).length < 1) {
      showModal.value = true;
    }
  }
  setPort(props.port as DockPort);
});

const isAutoMode = computed(() => {
  return port.value && port.value.mode && port.value.mode == DockPortMode.AUTO;
});

const disableSave = computed(() => {
  if (!mode.value || !mode.value.value) {
    return true;
  }

  if (mode.value.value != DockPortMode.AUTO && !supportedMode.value.value) {
    return true;
  }

  return !port.value || !port.value.port;
});

const supportedModeOptions = computed(() => {
  return (
    (port.value?.supported_modes || [])
      .filter(function (mode) {
        return mode !== DockPortMode.AUTO;
      })
      .map((mode) => ({
        label: t(`dock.port.mode.${mode}`, mode),
        value: mode,
      })) || []
  );
});

function closedModal() {
  showModal.value = false;
  resetData();
  emit("closed");
}

function changePortMode(value: SelectOption<string>) {
  mode.value = value;
  if (port.value) {
    port.value.mode = value.value as DockPortMode;
  }
}

function setPort(newPort: DockPort) {
  port.value = deepClone(newPort);

  if (port.value && port.value.mode) {
    const m = baseModeOptions.value.find(
      (o) => port.value && o.value == port.value.mode,
    );
    const supM = supportedModeOptions.value.find(
      (o) => port.value && o.value == port.value.mode,
    );

    if (m && m.value == DockPortMode.AUTO) {
      mode.value = m;
    } else if (supM) {
      mode.value = optionManual.value;
      supportedMode.value = supM;
    }
  }

  if (port.value && port.value.uart) {
    if ("baud_rate" in port.value.uart) {
      const val = baudRateOptions.find(
        (o) => port.value && o.value == port.value.uart?.baud_rate,
      );

      if (val) {
        baudRate.value = val;
      }
    }

    if ("data_bits" in port.value.uart) {
      const val = dataBitsOptions.find(
        (o) => port.value && o.value == port.value.uart?.data_bits,
      );

      if (val) {
        dataBits.value = val;
      }
    }

    if ("stop_bits" in port.value.uart) {
      const val = stopBitsOptions.find(
        (o) => port.value && o.value == port.value.uart?.stop_bits,
      );

      if (val) {
        stopBits.value = val;
      }
    }

    if ("parity" in port.value.uart) {
      const val = parityOptions.value.find(
        (o) => port.value && o.value == port.value.uart?.parity,
      );

      if (val) {
        parity.value = val;
      }
    }
  }
}

async function savePort() {
  if (!port.value?.port) {
    return false;
  }

  const message = {
    mode:
      mode.value.value == DockPortMode.AUTO
        ? mode.value.value
        : supportedMode.value.value,
  } as DockPortChange;

  if (message.mode == DockPortMode.RS232) {
    const additional = {
      ...(baudRate.value?.value != null && { baud_rate: baudRate.value.value }),
      ...(dataBits.value?.value != null && { data_bits: dataBits.value.value }),
      ...(stopBits.value?.value != null &&
        stopBits.value?.value.length > 0 && {
          stop_bits: stopBits.value.value,
        }),
      ...(parity.value?.value != null &&
        parity.value?.value.length > 0 && { parity: parity.value.value }),
    };

    Object.assign(message, { uart: additional });
  }

  addInfoFull(FlashMessageInfoStatus.SAVING, t("ui.saving_settings"));
  try {
    await dockStorage.changeDockPort(props.dockId, port.value?.port, message);
    emit("saved");
    closedModal();
    hideMessage();
  } catch (e) {
    addErrorBottom(e);
  }
}

async function resetData() {
  await sleep(50);
  mode.value = baseModeOptions.value[1];
  supportedMode.value = { label: "", value: "" };

  baudRate.value = defaultBaudRateOption.value;
  dataBits.value = defaultDataBitsOption.value;
  stopBits.value = defaultStopBitsOption.value;
  parity.value = defaultParityOption.value;
}
</script>
<template>
  <Teleport to="body">
    <ModalSecondary
      ref="modalEditPort"
      :show="showModal"
      :width="'24.25rem'"
      :button-close="false"
      :name="'dock-edit-port'"
      class="dock-edit-port-modal"
      @close="closedModal"
    >
      <template #header>
        Port <template v-if="port?.port">{{ port.port }}</template>
      </template>

      <div
        class="form-item form-item--select form-item--select--pb-min form-item--select--no-border"
      >
        <span class="form-item--select__label">{{
          $t("dock.edit_port.mode")
        }}</span>
        <UCSelect
          v-if="mode"
          v-model="mode"
          :options="baseModeOptions"
          :light="true"
          :dynamic-position="true"
          @select="changePortMode"
        />
      </div>

      <div v-if="isAutoMode" class="form-data">
        <span>Detected</span>

        <span
          v-if="port?.active_mode && port?.active_mode == DockPortMode.ERROR"
          class="form-data__value form-data__value--error"
        >
          <i class="fa-light fa-exclamation"></i>{{ t("dock.port.mode.ERROR") }}
        </span>
        <span v-else class="form-data__value">
          {{
            t(`dock.port.mode.${port?.active_mode}`, "dock.port.mode.UNKNOWN")
          }}
        </span>
      </div>

      <template v-else>
        <div
          class="form-item form-item--select form-item--select--pb-min form-item--select--no-border"
        >
          <span class="form-item--select__label">{{
            $t("dock.port.labels.peripheral")
          }}</span>
          <UCSelect
            v-model="supportedMode"
            :options="supportedModeOptions"
            :light="true"
            :dynamic-width="true"
            :dynamic-position="true"
          />
        </div>
        <template v-if="supportedMode.value == DockPortMode.RS232">
          <div
            class="form-item form-item--select form-item--select--pb-min form-item--select--no-border"
          >
            <span class="form-item--select__label">{{
              $t("dock.port.labels.baud_rate")
            }}</span>
            <UCSelect
              v-model="baudRate"
              :options="baudRateOptions"
              :light="true"
              :dynamic-position="true"
            />
          </div>
          <div
            class="form-item form-item--select form-item--select--pb-min form-item--select--no-border"
          >
            <span class="form-item--select__label">{{
              $t("dock.port.labels.data_bits")
            }}</span>
            <UCSelect
              v-model="dataBits"
              :options="dataBitsOptions"
              :light="true"
              :dynamic-position="true"
            />
          </div>
          <div
            class="form-item form-item--select form-item--select--pb-min form-item--select--no-border"
          >
            <span class="form-item--select__label">{{
              $t("dock.port.labels.stop_bits")
            }}</span>
            <UCSelect
              v-model="stopBits"
              :options="stopBitsOptions"
              :light="true"
              :dynamic-position="true"
            />
          </div>
          <div
            class="form-item form-item--select form-item--select--pb-min form-item--select--no-border"
          >
            <span class="form-item--select__label">{{
              $t("dock.port.labels.parity.title")
            }}</span>
            <UCSelect
              v-model="parity"
              :options="parityOptions"
              :light="true"
              :dynamic-position="true"
            />
          </div>
        </template>
      </template>

      <template #footer>
        <div class="modal-secondary__footer__buttons">
          <button
            class="button button--tertiary"
            @click="modalEditPort?.triggerClose()"
          >
            {{ $t("ui.cancel") }}
          </button>
          <button
            :disabled="disableSave"
            class="button button--secondary"
            @click="savePort"
          >
            {{ $t("ui.save") }}
          </button>
        </div>
        <a
          href="https://support.unfoldedcircle.com/hc/en-us/articles/20028572717084"
          target="_blank"
        >
          <InfoPanel :text="$t('dock.edit_port.warning')"></InfoPanel>
        </a>
      </template>
    </ModalSecondary>
  </Teleport>
</template>
