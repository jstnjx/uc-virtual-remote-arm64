<script setup lang="ts">
import { ref, watch, computed, onMounted, useTemplateRef } from "vue";

import type {
  ActivityFull,
  EntityCommandListItem,
  EntityCmdParam,
  EntityCmdParamChange,
  CommandParameter,
  DeviceButtonMapping,
  DeviceButtonMappingChange,
  EntityCommandMetadata,
} from "@/types/activity";

import type { ButtonMappingPressType } from "@/types/enums";
import type { ConfiguredEntity } from "@/types/integrationInstance";
import type { ColorPickerValue } from "@/types/ui";

import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";

import {
  getAvailableCommandsForActivity,
  getSelectionParamOptions,
} from "@/composables/activities";
import translatedProperty from "@/composables/translatedProperty";
import { useTiming } from "@/composables/timing";
import { isTouchEnabled } from "@/composables/device";

import CommandSelect from "@/components/ui/CommandSelect.vue";
import RemoteCommandSelect from "@/components/ui/RemoteCommandSelect.vue";
import CommandField from "@/components/ui/CommandField.vue";
import ButtonPress from "@/components/configure-button/ButtonPress.vue";
import CommandParam from "@/components/ui/CommandParam.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import ColorPicker from "@/components/ui/ColorPicker.vue";

const { sleep } = useTiming();

const integrationStorage = integrationsStore();

const props = defineProps({
  settings: {
    type: Object,
    required: true,
  },
  entity: {
    type: Object,
    required: true,
  },
  entityType: {
    type: String,
    default: "activity",
  },
  button: {
    type: Object,
    required: false,
  },
  dangling: {
    type: Boolean,
    default: false,
  },
});
const emit = defineEmits(["change", "close", "reset"]);

const allEntities = computed<ConfiguredEntity[]>(
  () => integrationStorage.configuredEntities,
);
const selectionOptions = ref<Record<string, any>>({});

const commandMetadata = ref<EntityCommandMetadata[]>([]);
const allCommands = ref<EntityCommandListItem[]>([]);

const optionalParamsStatus = ref<Record<string, any>>({});
const changed = ref(false);

const dialogConfirmReset =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogConfirmReset");
const elCommandSelect =
  useTemplateRef<InstanceType<typeof CommandSelect>>("elCommandSelect");
const elRemoteCommandSelect = useTemplateRef<
  InstanceType<typeof RemoteCommandSelect>
>("elRemoteCommandSelect");

watch(
  () => props.settings,
  () => {
    localSettings.value = { ...(elementSettings.value as DeviceButtonMapping) };
    checkParamsType();
    if (changed.value) {
      setOptionalParamsStatus();
      changed.value = false;
    }
  },
);

const elementSettings = computed(() => {
  if (!props.settings.element) {
    return {};
  }
  return props.settings.element;
});

const settingsValue = { ...(elementSettings.value as DeviceButtonMapping) };
const localSettings = ref<DeviceButtonMapping>(settingsValue);
const showCommandSelect = ref(false);

const pressType = computed<ButtonMappingPressType>(() => {
  if (!props.settings.pressType) {
    throw new Error("Property 'props.settings.pressType' is required.");
  }

  return props.settings.pressType;
});

const settingsByPressType = computed(() => {
  return localSettings.value[pressType.value] || {};
});

const selectedCommandParams = computed(() => {
  if (
    elementSettings.value[pressType.value] &&
    elementSettings.value[pressType.value].entity_id &&
    elementSettings.value[pressType.value].cmd_id
  ) {
    return allCommands.value.find(
      (command) =>
        command.id ===
        `${elementSettings.value[pressType.value].entity_id}:${
          elementSettings.value[pressType.value].cmd_id
        }`,
    )?.cmd.params as CommandParameter[];
  } else {
    //Empty command
    return [] as CommandParameter[];
  }
});

const hueAndSaturation = computed(() => {
  if (
    settingsByPressType.value?.params &&
    Object.keys(settingsByPressType.value?.params).length === 2 &&
    "hue" in settingsByPressType.value.params &&
    "saturation" in settingsByPressType.value.params
  ) {
    const paramHue = getParamMetaByKey("hue");
    const paramSaturation = getParamMetaByKey("saturation");
    if (paramHue && paramSaturation) {
      return [
        settingsByPressType.value?.params["hue"] ?? paramHue.min,
        settingsByPressType.value?.params["saturation"] ?? paramSaturation.min,
      ];
    }
  }
  return [];
});

const hasColorPicker = computed(() => {
  const params = Object.keys(settingsByPressType.value?.params ?? {});

  if (!params || params.length < 2) {
    return false;
  }

  return params.includes("hue") && params.includes("saturation");
});

const hasOptional = computed(() => {
  return Object.keys(optionalParamsStatus.value).length > 0;
});

function getParamMetaByKey(key: string) {
  return selectedCommandParams.value.find((param) => param.param === key);
}

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

  setParamValue(m);
}

async function doCommandSelect(command: EntityCommandListItem) {
  const params = (command.cmd?.params ?? {}) as Record<
    string,
    EntityCmdParam | CommandParameter
  >;
  const initParams: { [key: string]: any } = {};

  if (command.cmd && params) {
    Object.keys(params).forEach((key) => {
      const param = params[key];
      let fallbackValue: boolean | string | number =
        param.type === "bool" ? false : "";

      if (param.type === "number") {
        if ("min" in param || "max" in param) {
          fallbackValue = param.min ?? param.max ?? 0;
        } else {
          fallbackValue = 0;
        }
      }

      if (!param.optional || param.optional === false) {
        if ("default" in param) {
          initParams[key] = param.default ?? fallbackValue;
        } else {
          initParams[key] = fallbackValue;
        }
      }
    });
  }

  if (Object.keys(initParams).length > 0) {
    showCommandSelect.value = false;
    await sleep(100);
  }

  emit("change", {
    button: localSettings?.value,
    cmd: {
      entity_id: command.entity?.entity_id,
      cmd_id: command.cmd.id,
      params: initParams,
    },
    pressType: pressType.value,
  } as DeviceButtonMappingChange);
  changed.value = true;

  if (Object.keys(initParams).length < 1) {
    emit("close");
  } else {
    setOptionalParamsStatus();
  }
}

function doShortCommandSelect(command: EntityCommandListItem) {
  emit("change", {
    button: localSettings?.value,
    cmd: {
      cmd_id: command,
    },
    pressType: pressType.value,
  });
  changed.value = true;
}

// Handling other input update only on blur
function setParamValue(param: EntityCmdParamChange | EntityCmdParamChange[]) {
  const paramArray = Array.isArray(param) ? param : [param];
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

  const paramsExcluded = Object.keys(optionalParamsStatus.value).filter(
    (key) => !optionalParamsStatus.value[key],
  );

  const settingsValue = elementSettings.value[pressType.value];
  if (!settingsValue) return;

  paramArray.forEach((p) => {
    const newValue = p.paramValue;

    if (p?.paramName) {
      if (!settingsValue.params) {
        settingsValue.params = {};
      }

      if (newValue !== undefined && newValue !== null) {
        settingsValue.params[p.paramName] = newValue;
      }
    }
  });

  if (paramsExcluded.length > 0) {
    paramsExcluded.forEach((key) => {
      delete settingsValue.params[key];
    });
  }

  if (
    settingsValue.entity_id !== undefined &&
    settingsValue.cmd_id !== undefined &&
    settingsValue.params !== undefined
  ) {
    emit("change", {
      button: localSettings?.value,
      cmd: {
        entity_id: settingsValue.entity_id,
        cmd_id: settingsValue.cmd_id,
        params: settingsValue.params,
      },
      pressType: pressType.value,
    });

    changed.value = true;
  }
}

function getCommandNameById(command_id: string | Record<string, any>) {
  const selected_command = commandMetadata.value.find((command) => {
    return command.id === command_id;
  });
  return translatedProperty(selected_command?.name);
}

function getEntityNameById(entity_id: string | Record<string, any>) {
  const selected_command = allCommands.value.find((command) => {
    return command.entity?.entity_id === entity_id;
  });
  return translatedProperty(selected_command?.entity?.name);
}

function startResetButton() {
  dialogConfirmReset.value?.open();
}

function resetButton() {
  emit("reset", {
    button: localSettings?.value,
    pressType: pressType.value,
  } as DeviceButtonMappingChange);
}

function triggerClose() {
  if (document) {
    document?.querySelector("body")?.click();
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
    (ent) => ent.entity_id === elementSettings.value[pressType.value].entity_id,
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
    elementSettings.value[pressType.value] == null ||
    elementSettings.value[pressType.value]?.params == null ||
    typeof elementSettings.value[pressType.value] === "undefined" ||
    typeof elementSettings.value[pressType.value]?.params === "undefined"
  ) {
    return false;
  }

  const paramsArray = Object.keys(
    elementSettings.value[pressType.value]?.params,
  ).map((key) => getParamMetaByKey(key));

  if (paramsArray && paramsArray.length > 0) {
    const selectionParams = paramsArray.filter(
      (p) => p && p.type === "selection",
    );

    if (selectionParams && selectionParams.length > 0) {
      setSelectionParamOptions(selectionParams);
    }
  }
}

async function openRemoteCommandSelect() {
  if (props.entityType != "remote") {
    return false;
  }

  showCommandSelect.value = true;

  await sleep(300);
  if (!isTouchEnabled() && elRemoteCommandSelect.value) {
    elRemoteCommandSelect.value.focusSearch();
  }
}

function setOptionalParamsStatus() {
  if (!selectedCommandParams.value) return false;

  selectedCommandParams.value.forEach((p: any) => {
    if (p && p.optional && p.optional === true) {
      const pValue = settingsByPressType.value?.params?.[p.param];
      optionalParamsStatus.value[p.param] =
        pValue == undefined || pValue == null || pValue.length < 1
          ? false
          : true;
    }
  });
}

function updateOptionalParamStatus(p: string) {
  console.trace("updateOptionalParamStatus", p);
  if (optionalParamsStatus.value[p] === true) {
    optionalParamsStatus.value[p] = false;
    // Delete param
    setParamValue({ paramName: p, paramValue: null });
  } else if (optionalParamsStatus.value[p] === false) {
    optionalParamsStatus.value[p] = true;
  }
}

function displayParameter(index: number) {
  if (!settingsByPressType.value?.params) {
    return true;
  }

  const previousParam = Object.keys(settingsByPressType.value?.params)[
    index - 1
  ];
  if (
    previousParam &&
    (previousParam == "hue" || previousParam == "saturation")
  ) {
    return false;
  }

  return true;
}

function openCommandSelect() {
  if (elCommandSelect.value) {
    elCommandSelect.value.open();
  }
}

onMounted(async () => {
  try {
    commandMetadata.value = await integrationStorage.getCommandMetadata();
    allCommands.value = getAvailableCommandsForActivity(
      props.entity as ActivityFull,
      commandMetadata.value,
    ) as EntityCommandListItem[];
  } catch (e) {
    addErrorBottom(e);
  }

  checkParamsType();
  if (
    Object.keys(settingsByPressType.value).length === 0 &&
    settingsByPressType.value.constructor === Object
  ) {
    openRemoteCommandSelect();
  }

  setOptionalParamsStatus();
});
</script>
<template>
  <div class="edit-button-li">
    <div class="edit-button-li__header">
      <div class="edit-button-li__header__main">
        <ButtonPress
          :type="pressType.split('_')[0]"
          :data="localSettings[pressType]"
          :dangling="dangling"
          :only-indicator="true"
        />
        <span v-if="button" class="edit-button-li__title">{{
          translatedProperty(button.name)
        }}</span>
      </div>
      <button
        class="button button--secondary button--icon button--icon--small edit-button-li__close"
        @click="triggerClose"
      >
        <i class="fa-regular fa-close"></i>
      </button>
    </div>
    <div class="edit-button-li__body">
      <div
        v-if="elementSettings.type !== 'numpad'"
        class="edit-button-li__command-wrapper"
        :class="[
          {
            'edit-button-li__command-wrapper--minimal':
              !settingsByPressType?.entity_id,
          },
          { 'edit-button-li__command-wrapper--open': showCommandSelect },
        ]"
      >
        <CommandField
          :id="settingsByPressType?.cmd_id || ''"
          :entity-type="entityType"
          :name="getCommandNameById(settingsByPressType?.cmd_id || '')"
          :entity="getEntityNameById(settingsByPressType?.entity_id ?? '')"
          :show-command-select="showCommandSelect"
          :extended-command-select="entityType === 'activity'"
          @open-command-select="openCommandSelect"
          @toggle-command-select="showCommandSelect = !showCommandSelect"
        />
        <template v-if="elementSettings.type !== 'numpad'">
          <Transition name="collapse-command">
            <div
              v-if="entityType === 'remote'"
              v-show="showCommandSelect"
              class="command-select-wrapper"
            >
              <RemoteCommandSelect
                ref="elRemoteCommandSelect"
                :key="settingsByPressType?.cmd_id || $t('ui.none')"
                :value="settingsByPressType?.cmd_id || ''"
                :button="elementSettings"
                :remote="entity"
                @select="doShortCommandSelect"
              />
            </div>
          </Transition>
          <CommandSelect
            v-if="entityType === 'activity'"
            ref="elCommandSelect"
            :key="settingsByPressType?.cmd_id || $t('ui.none')"
            :value="settingsByPressType?.cmd_id || ''"
            :button="elementSettings"
            :activity="entity"
            :label-text="button ? translatedProperty(button.name) : ''"
            @select="doCommandSelect"
          />
        </template>
      </div>
      <template v-if="selectedCommandParams">
        <div class="edit-button-li__params">
          <template
            v-for="(param, index) in selectedCommandParams"
            :key="param.param"
          >
            <div
              v-if="displayParameter(index)"
              class="edit-button-li__param-wrapper"
              :class="{
                'edit-button-li__param-wrapper--custom': hasColorPicker,
              }"
            >
              <div
                v-if="hasOptional && !hasColorPicker"
                class="edit-button-li__params__field-optional"
              >
                <div
                  v-if="optionalParamsStatus[param.param] != undefined"
                  class="form-item form-item--checkbox-tick form-item--checkbox-tick--small form-item--checkbox-tick"
                >
                  <input
                    :id="`edit-button-li__params-${index}-checkbox-tick`"
                    :checked="optionalParamsStatus[param.param]"
                    type="checkbox"
                  />
                  <label
                    class="toggle"
                    :for="`edit-button-li__params-${index}-checkbox-tick`"
                  />
                  <button
                    class="button--toggle-tick"
                    @click="updateOptionalParamStatus(param.param)"
                  ></button>
                </div>
              </div>
              <template v-if="hasColorPicker">
                <span class="edit-button-li__param-wrapper__label">{{
                  $t("button_mapping.command.color")
                }}</span>
                <ColorPicker :hs="hueAndSaturation" @change="colorChanged" />
              </template>
              <CommandParam
                v-else
                :value="settingsByPressType?.params?.[param.param]"
                :meta="getParamMetaByKey(param.param)"
                :command="settingsByPressType"
                :index="index"
                :selection-options="
                  selectionOptions[getParamMetaByKey(param.param)?.param] || []
                "
                :disabled="
                  optionalParamsStatus[param.param] != undefined &&
                  optionalParamsStatus[param.param] == false
                "
                @change-param-value="setParamValue"
              />
            </div>
          </template>
        </div>
      </template>
      <div class="edit-button-li__reset">
        <span class="edit-button-li__reset__button" @click="startResetButton">
          <button class="button button--tertiary button--icon">
            <i class="fa-regular fa-arrow-rotate-left"></i>
          </button>
          <span>{{ $t("ui.reset_to_defaults") }}</span>
        </span>
      </div>
    </div>
    <AppDialog
      ref="dialogConfirmReset"
      :title="$t('button_mapping.reset.title')"
      :text="$t('button_mapping.reset.question')"
      :submit-text="$t('ui.accept')"
      :cancel-text="$t('ui.cancel')"
      @submit="resetButton"
    />
  </div>
</template>
