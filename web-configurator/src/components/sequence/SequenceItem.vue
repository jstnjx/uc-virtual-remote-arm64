<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { asyncComputed } from "@vueuse/core";
import { useTranslation } from "i18next-vue";
import { storeToRefs } from "pinia";

import type {
  CommandSequenceListItem,
  EntityCmdParam,
  EntityCmdParamChange,
  EntityCommandMetadataParamBase,
} from "@/types/activity";

import type { ColorPickerValue } from "@/types/ui";

type ParamDisplayItem = {
  value: string | number | boolean;
  unit?: string;
  showSeparator: boolean;
};

import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";

import { getSelectionParamOptions } from "@/composables/activities";
import translatedProperty from "@/composables/translatedProperty";
import { getIconName } from "@/composables/icon";

import SetupMs from "@/components/ui/setup/SetupMs.vue";
import SequenceCommandParam from "@/components/sequence/SequenceCommandParam.vue";
import ColorPicker from "@/components/ui/ColorPicker.vue";

const { i18next } = useTranslation();

const integrationStorage = integrationsStore();

const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
  selected: {
    type: Boolean,
    default: false,
  },
  status: {
    type: Object || null,
    default: null,
  },
});

const { configuredEntities: allEntities } = storeToRefs(integrationStorage);

const selectionOptions = ref<Record<string, any>>({});
const itemSelected = ref(props.selected);
const showAllParameters = ref(false);
const optionalParamsStatus = ref<Record<string, any>>({});
const changed = ref(false);

const emit = defineEmits(["delete", "change", "toggleCheckbox"]);

watch(
  () => props.item,
  (val, oldVal) => {
    if (changed.value && val != oldVal) {
      setOptionalParamsStatus();
    }
    changed.value = false;
  },
);

watch(
  () => props.selected,
  (val) => {
    itemSelected.value = val;
  },
);

watch(
  () => props.status,
  (val) => {
    if (val != null) {
      showAllParameters.value = false;
    }
  },
);

const iconDrag = asyncComputed(async () => {
  return await getIconName("fa-grip-vertical");
});

const title = computed(() => {
  if (props.item.type === "delay") {
    return "__DELAY";
  }
  if (translatedProperty(props.item.cmd?.name)) {
    return translatedProperty(props.item.cmd?.name);
  }

  if (props.item.sequence?.command?.cmd_id) {
    return props.item.sequence?.command?.cmd_id;
  }

  return "";
});

const entity = computed(() => {
  return translatedProperty(props.item.entity?.name);
});

const firstParamName = computed(() => {
  if (
    !props.item.cmd.params ||
    props.item.cmd.params.length > 1 ||
    props.item.cmd.params[0].param == "color_temperature" ||
    hasColorPicker.value
  ) {
    return "";
  }

  const pName = `${entity.value ? " - " : ""}${translatedProperty(
    props.item.cmd.params[0].name,
  )}`;

  return pName;
});

const hueAndSaturation = computed(() => {
  if (!props.item.cmd?.params || !Array.isArray(props.item.cmd.params)) {
    return [];
  }

  const paramHue = props.item.cmd.params.find(
    (p: EntityCmdParam) => p.param == "hue",
  );
  const paramSaturation = props.item.cmd.params.find(
    (p: EntityCmdParam) => p.param == "saturation",
  );

  if (paramHue && paramSaturation) {
    return [
      props.item.sequence?.command?.params?.["hue"] ?? paramHue.min,
      props.item.sequence?.command?.params?.["saturation"] ??
        paramSaturation.min,
    ];
  }

  return [];
});

const mainClasses = computed(() => {
  let classList = "";

  classList +=
    props.item.cmd?.params && props.item.cmd.params.length > 1
      ? "sequence-item--more-params "
      : "";
  classList +=
    props.item.cmd?.params &&
    props.item.cmd.params.length > 0 &&
    showAllParameters.value
      ? "sequence-item--more-params--open "
      : "";
  classList +=
    props.status != null && props.status.state && props.status.state === "ERROR"
      ? "sequence-item--error "
      : "";
  return classList;
});

const hasStatus = computed(() => {
  return props.status != null;
});

const hasColorPicker = computed(() => {
  const params = props.item.cmd?.params;

  if (!params || params.length < 2) {
    return false;
  }

  const colorParams = ["hue", "saturation"];

  return (
    colorParams.includes(params[0]?.param) &&
    colorParams.includes(params[1]?.param)
  );
});

const hasOptional = computed(() => {
  return Object.keys(optionalParamsStatus.value).length > 0;
});

const paramsExcluded = computed(() => {
  return Object.keys(optionalParamsStatus.value).filter(
    (key) => !optionalParamsStatus.value[key],
  );
});

const paramDisplay = computed<ParamDisplayItem[]>(() => {
  const params = props.item.cmd?.params;
  if (!params || !Array.isArray(params)) return [];

  return params.map((p, index) => {
    const currentValue =
      props.item.sequence?.command?.params?.[p.param] ??
      p.default ??
      p.min ??
      "";

    let hasNextValue = false;

    for (let i = index + 1; i < params.length; i++) {
      const nextParam = params[i];
      const nextValue =
        props.item.sequence?.command?.params?.[nextParam.param] ??
        nextParam.default ??
        nextParam.min ??
        "";

      if (String(nextValue).length > 0) {
        hasNextValue = true;
        break;
      }
    }

    return {
      value: currentValue as string | number | boolean,
      unit: p.unit,
      showSeparator: String(currentValue).length > 0 && hasNextValue,
    };
  });
});

function colorChanged(message: ColorPickerValue) {
  const m = [
    {
      paramName: "hue",
      paramValue: message.hsl[0],
    },
    {
      paramName: "saturation",
      paramValue: message.hsl[1],
    },
  ] as EntityCmdParamChange[];

  emitChange(m);
}

function isValidParam(param: any): param is EntityCmdParamChange {
  return (
    param &&
    (typeof param.paramValue === "string" ||
      typeof param.paramValue === "number" ||
      typeof param.paramValue === "boolean")
  );
}

function emitChange(params: EntityCmdParamChange | EntityCmdParamChange[]) {
  const paramArray = Array.isArray(params) ? params : [params];
  const paramsStatusKeys = Object.keys(optionalParamsStatus.value ?? {});

  // Enable disabled fields with value
  paramArray.forEach((p) => {
    if (!p.paramName) return;
    const pIndex = paramsStatusKeys.indexOf(p.paramName);

    if (pIndex > -1) {
      if (
        optionalParamsStatus.value[p.paramName] === false &&
        p.paramValue !== null
      ) {
        updateOptionalParamStatus(p.paramName);
      }
    }
  });

  if (Array.isArray(params)) {
    const validParams = params.filter((param) => {
      const valid = isValidParam(param);
      if (!valid) {
        console.error(
          "SequenceItem::emitChange got an invalid paramValue object! Ignoring it...",
          param,
        );
      }
      return valid;
    });

    if (!validParams.length) return;

    emit("change", props.item, validParams, paramsExcluded.value);
    changed.value = true;
  } else {
    if (!isValidParam(params)) {
      console.error(
        "SequenceItem::emitChange got an invalid paramValue object! Ignoring it...",
        params,
      );
      return;
    }

    if (params.paramName) {
      emit("change", props.item, params, paramsExcluded.value);
    } else {
      emit("change", props.item, params.paramValue);
    }

    changed.value = true;
  }
}

async function getIntegrationData() {
  try {
    await integrationStorage.getConfiguredEntities(null, false);
  } catch (e) {
    addErrorBottom(e);
  }
}

async function setSelectionParamOptions(params: any[]) {
  if (allEntities.value.length < 1) {
    await getIntegrationData();
  }

  const currentEntity = allEntities.value.find(
    (ent) => ent.entity_id === props.item?.entity?.entity_id,
  );
  if (!currentEntity) {
    return;
  }

  selectionOptions.value = getSelectionParamOptions(
    params,
    currentEntity,
  ).value;
}

function checkParamsType() {
  if (
    props.item?.cmd == null ||
    props.item?.cmd?.params == null ||
    typeof props.item?.cmd === "undefined" ||
    typeof props.item?.cmd?.params === "undefined"
  ) {
    return false;
  }

  if (props.item.cmd.params.length > 0) {
    const selectionParams = props.item.cmd.params.filter(
      (p: { type: string }) => p.type === "selection",
    );

    if (selectionParams && selectionParams.length > 0) {
      setSelectionParamOptions(selectionParams);
    }
  }
}

function setOptionalParamsStatus() {
  props.item?.cmd?.params?.forEach((p: EntityCommandMetadataParamBase) => {
    if (p.optional && p.optional === true) {
      const pValue = props.item.sequence?.command?.params[p.param];
      optionalParamsStatus.value[p.param] =
        pValue == undefined || pValue == null || pValue.length < 1
          ? false
          : true;
    }
  });
}

function updateOptionalParamStatus(p: string) {
  if (optionalParamsStatus.value[p] === true) {
    optionalParamsStatus.value[p] = false;
    // Delete param
    emit(
      "change",
      props.item,
      { paramName: p, paramValue: null },
      paramsExcluded.value,
    );
  } else if (optionalParamsStatus.value[p] === false) {
    optionalParamsStatus.value[p] = true;
  }
}

function displayParameter(index: number) {
  const previousParam = props.item.cmd?.params[index - 1];
  if (
    previousParam &&
    (previousParam.param == "hue" || previousParam.param == "saturation")
  ) {
    return false;
  }

  return true;
}

function getParamValue(index: number) {
  if (!props.item.cmd.params[index]) return "";
  return (
    props.item.sequence?.command?.params?.[
      props.item.cmd.params[index].param
    ] ??
    props.item.cmd?.params[index].default ??
    props.item.cmd?.params[index].min ??
    ""
  );
}

function toggleItemCheckbox(item: CommandSequenceListItem) {
  emit("toggleCheckbox", item);
}

function deleteItem() {
  emit("delete", props.item);
}

onMounted(() => {
  checkParamsType();
  setOptionalParamsStatus();
});
</script>
<template>
  <div class="sequence-item" :class="mainClasses">
    <div class="sequence-item__base">
      <div v-if="hasStatus" class="sequence-item__state">
        <img
          v-if="status.state === 'WAITING'"
          src="/images/loading-indicator.png"
          alt="Waiting"
          class="img-loading img-loading--small"
        />
        <i
          v-else-if="status.state === 'DONE'"
          class="fa-regular fa-check sequence-item__state__icon"
        ></i>
        <i
          v-else-if="status.state === 'ERROR'"
          class="fa-regular fa-exclamation sequence-item__state__icon sequence-item__state__icon--error"
        ></i>
      </div>
      <div v-else class="sequence-item__select">
        <div class="form-item form-item--checkbox-tick">
          <input
            :id="`sequence-item-${item.id}-checkbox-tick`"
            type="checkbox"
            :checked="selected"
          />
          <label
            class="toggle"
            :for="`sequence-item-${item.id}-checkbox-tick`"
          />
          <button
            class="button--toggle-tick"
            @click="toggleItemCheckbox(item as CommandSequenceListItem)"
          ></button>
        </div>
      </div>
      <div
        class="sequence-item__base__label"
        :class="{
          'sequence-item__base__label--no-value': !(
            (item.type === 'delay' && item.sequence?.delay) ||
            (item.cmd?.params &&
              item.cmd.params.length > 0 &&
              item.sequence?.command?.params?.[item.cmd.params[0].param] !==
                undefined)
          ),
        }"
      >
        <span class="sequence-item__title">
          {{ title === "__DELAY" ? $t("command.delay") : title }}
        </span>
        <span
          v-if="
            status != null &&
            status.state &&
            status.state === 'ERROR' &&
            status.errorMessage
          "
          class="sequence-item__error"
        >
          <template v-if="i18next.exists(`${status.errorMessage}`)">{{
            $t(`${status.errorMessage}`)
          }}</template>
          <template v-else>{{ status.errorMessage }}</template>
        </span>
        <span v-else-if="entity" class="sequence-item__entity">
          {{ entity }}
          <template v-if="firstParamName.length > 0">
            {{ firstParamName }}
          </template>
        </span>
      </div>
      <template
        v-if="
          !hasColorPicker && item.cmd?.params && item.cmd?.params.length > 1
        "
      >
        <div v-show="!showAllParameters" class="sequence-item__display-value">
          <template v-for="(p, index) in paramDisplay" :key="index">
            {{ p.value }}

            <span
              v-if="p.value && p.unit"
              class="sequence-item__display-value__unit"
            >
              &nbsp;{{ p.unit }}
            </span>

            <span
              v-if="p.showSeparator"
              class="sequence-item__display-value__separator"
            >
              |
            </span>
          </template>
        </div>
      </template>
      <div v-if="hasStatus" class="sequence-item__value">
        <span>
          <template v-if="item.type === 'delay'">{{
            item.sequence?.delay
          }}</template>
          <ColorPicker
            v-else-if="
              item.cmd?.params &&
              item.cmd?.params.length > 1 &&
              (item.cmd.params[0].param == 'hue' ||
                item.cmd.params[0].param == 'saturation')
            "
            :hs="hueAndSaturation"
            :disabled="true"
          />
          <template v-else>
            {{
              item.cmd?.params &&
              item.cmd.params.length === 1 &&
              item.sequence?.command?.params?.[item.cmd.params[0].param] !==
                undefined
                ? item.sequence?.command?.params?.[item.cmd.params[0].param]
                : (item.cmd?.params
                    ? item.cmd?.params[0].default || item.cmd?.params[0].min
                    : "") || ""
            }}
          </template>
        </span>
        <span class="sequence-item__value__unit">
          <template v-if="item.type === 'delay'">&nbsp;ms</template>
          <template
            v-else-if="
              item.cmd?.params &&
              item.cmd.params[0].unit &&
              !(
                item.cmd.params[0].param == 'hue' ||
                item.cmd.params[0].param == 'saturation'
              )
            "
            >&nbsp;{{ item.cmd.params[0].unit }}</template
          >
        </span>
      </div>
      <template v-else>
        <div v-if="item.type === 'delay'" class="sequence-item__config">
          <SetupMs :value="item.sequence?.delay" @change="emitChange" />
        </div>
        <template
          v-else-if="
            item.cmd?.params &&
            (item.cmd?.params.length === 1 || hasColorPicker)
          "
        >
          <div class="sequence-item__config">
            <ColorPicker
              v-if="
                item.cmd.params[0].param == 'hue' ||
                item.cmd.params[0].param == 'saturation'
              "
              :hs="hueAndSaturation"
              @change="colorChanged"
            />
            <SequenceCommandParam
              v-else
              :param="item.cmd.params[0]"
              :item="item"
              :index="0"
              :options="selectionOptions[item.cmd.params[0].param] || []"
              @change="emitChange"
            />
          </div>
        </template>
      </template>
      <template
        v-if="
          !hasStatus &&
          !hasColorPicker &&
          item.cmd?.params &&
          item.cmd?.params.length > 1
        "
      >
        <button
          v-show="showAllParameters"
          class="button button--icon sequence-item__toggle-button"
          @click="showAllParameters = false"
        >
          <i class="fa-light fa-chevron-up"></i>
        </button>
        <button
          v-show="!showAllParameters"
          class="button button--icon sequence-item__toggle-button"
          @click="showAllParameters = true"
        >
          <i class="fa-light fa-chevron-down"></i>
        </button>
      </template>
      <div class="sequence-item__options">
        <button
          :disabled="hasStatus"
          class="button button--blank button--icon button--icon"
          @click="deleteItem"
        >
          <i class="fa-regular fa-trash"></i>
        </button>
      </div>
      <div
        class="sequence-item__drag"
        :class="{ 'sequence-item__drag--disabled': hasStatus }"
      >
        <i v-if="iconDrag" class="fa-regular" :class="iconDrag"></i>
      </div>
    </div>
    <template
      v-if="
        item.cmd?.params &&
        item.cmd.params.length > 1 &&
        !hasColorPicker &&
        hasStatus == false
      "
    >
      <template v-for="(param, index) in item.cmd.params" :key="index">
        <div
          v-if="displayParameter(Number(index) + 1)"
          v-show="showAllParameters"
          class="sequence-item__command"
          :class="{
            'sequence-item__command--disabled':
              optionalParamsStatus[param.param] != undefined &&
              optionalParamsStatus[param.param] == false,
          }"
        >
          <div class="sequence-item__select"></div>
          <div
            v-if="hasOptional && !hasColorPicker"
            class="sequence-item__field-optional"
          >
            <div
              v-if="param.optional && param.optional === true"
              class="form-item form-item--checkbox-tick form-item--checkbox-tick--small form-item--checkbox-tick"
            >
              <input
                :id="`params-${index}-checkbox-tick`"
                :checked="optionalParamsStatus[param.param]"
                type="checkbox"
              />
              <label class="toggle" :for="`params-${index}-checkbox-tick`" />
              <button
                class="button--toggle-tick"
                @click="updateOptionalParamStatus(param.param)"
              ></button>
            </div>
          </div>
          <span class="sequence-item__command__label">
            <template
              v-if="param.param == 'hue' || param.param == 'saturation'"
              >{{ $t("sequence.color") }}</template
            >
            <template v-else>{{ translatedProperty(param.name) }}</template>
          </span>
          <div class="sequence-item__config">
            <ColorPicker
              v-if="param.param == 'hue' || param.param == 'saturation'"
              :hs="hueAndSaturation"
              @change="colorChanged"
            />
            <SequenceCommandParam
              v-else
              :param="item.cmd.params[index]"
              :item="item"
              :index="Number(index) + 1"
              :options="selectionOptions[item.cmd.params[index].param] || []"
              :disabled="
                optionalParamsStatus[param.param] != undefined &&
                optionalParamsStatus[param.param] == false
              "
              @change="emitChange"
            />
          </div>
          <div class="sequence-item__options"></div>
          <div class="sequence-item__drag"></div>
        </div>
      </template>
    </template>
  </div>
</template>
