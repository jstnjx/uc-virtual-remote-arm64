<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { storeToRefs } from "pinia";
import { useTranslation } from "i18next-vue";

import type {
  ActivityFull,
  ActivityUserInterfaceItem,
  EntityCommandListItem,
  EntityCmdParam,
  EntityCmdParamChange,
  CommandParameter,
  IncludedEntity,
  EntityCommandMetadata,
} from "@/types/activity";
import type { ChangeCallbackParams } from "@/types/config";
import { EntityType } from "@/types/enums";

import type { ConfiguredEntity } from "@/types/integrationInstance";
import type { ColorPickerValue } from "@/types/ui";

import {
  getAvailableCommandsForActivity,
  getSelectionParamOptions,
} from "@/composables/activities";
import { addErrorBottom } from "@/stores/messages";

import { integrationsStore } from "@/stores/integrations";

import translatedProperty from "@/composables/translatedProperty";
import { useTiming } from "@/composables/timing";
import { isTouchEnabled } from "@/composables/device";

import IconSelect from "@/components/elements/icon/IconSelect.vue";
import UCInput from "@/components/ui/UCInput.vue";
import UCStepper from "@/components/ui/UCStepper.vue";
import ColorPicker from "@/components/ui/ColorPicker.vue";
import UCToggle from "@/components/ui/UCToggle.vue";

import CommandSelect from "@/components/ui/CommandSelect.vue";
import RemoteCommandSelect from "@/components/ui/RemoteCommandSelect.vue";
import CommandField from "@/components/ui/CommandField.vue";
import CommandParam from "@/components/ui/CommandParam.vue";
import WidgetEntitySelect from "@/components/ui/WidgetEntitySelect.vue";
import WidgetOptionSelect from "@/components/ui/WidgetOptionSelect.vue";
import {
  NUMBER_DISPLAY_MODES,
  SLIDER_COLORS,
  SLIDER_FILLS,
  SLIDER_STYLES,
  SLIDER_UPDATE_MODES,
  defaultSliderFeature,
  numberEntityData,
  sliderFeaturesOf,
} from "@/composables/numberEntity";

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
  activePage: {
    type: Object,
    required: true,
  },
  validateSize: {
    type: Function,
    default: () => {},
  },
  addItem: {
    type: Boolean,
    default: false,
  },
  gridDimensions: {
    type: Object,
    required: true,
  },
  saving: {
    type: Boolean,
    default: false,
  },
});
const emit = defineEmits(["close", "delete", "change", "copy"]);

const { t } = useTranslation();

const {
  configuredSensorEntities,
  configuredSelectEntities,
  configuredSliderEntities,
  configuredNumberEntities,
} = storeToRefs(integrationStorage);

const settingsValue = { ...(props.settings as ActivityUserInterfaceItem) };
if (!settingsValue.size) {
  settingsValue.size = { width: 1, height: 1 };
}
if (!settingsValue.size?.width) {
  settingsValue.size.width = 1;
}
if (!settingsValue.size?.height) {
  settingsValue.size.height = 1;
}

const commandMetadata = ref<EntityCommandMetadata[]>([]);
const allCommands = ref<EntityCommandListItem[]>([]);

const localSettings = ref<ActivityUserInterfaceItem>(settingsValue);
const text = ref(
  props.settings.text ||
    (props.settings.type === "text" ? t("widget.type.text.default_text") : ""),
);
const sensorShowLabel = ref(props.settings.sensor?.show_label ?? false);
const sensorShowUnit = ref(props.settings.sensor?.show_unit ?? false);
const entSelectShowName = ref(props.settings.select?.show_name ?? false);
const sliderShowName = ref(props.settings.slider?.show_name ?? false);
const sliderShowValue = ref(props.settings.slider?.show_value ?? true);
const sliderMin = ref<string | number>(props.settings.slider?.min ?? "");
const sliderMax = ref<string | number>(props.settings.slider?.max ?? "");
const numberShowName = ref(props.settings.number?.show_name ?? false);
const numberStep = ref<string | number>(props.settings.number?.step ?? "");

const optionalParamsStatus = ref<Record<string, any>>({});

const defaultLimits = {
  width: { min: 1, max: props.activePage.grid.width },
  height: { min: 1, max: props.activePage.grid.height },
};

const elCommandSelect =
  useTemplateRef<InstanceType<typeof CommandSelect>>("elCommandSelect");
const elMediaPlayerSelect = useTemplateRef<
  InstanceType<typeof WidgetEntitySelect>
>("elMediaPlayerSelect");
const elSensorSelect =
  useTemplateRef<InstanceType<typeof WidgetEntitySelect>>("elSensorSelect");
const elEntSelectSelect =
  useTemplateRef<InstanceType<typeof WidgetEntitySelect>>("elEntSelectSelect");
const elSliderSelect =
  useTemplateRef<InstanceType<typeof WidgetEntitySelect>>("elSliderSelect");
const elNumberSelect =
  useTemplateRef<InstanceType<typeof WidgetEntitySelect>>("elNumberSelect");
const elRemoteCommandSelect = useTemplateRef<
  InstanceType<typeof RemoteCommandSelect>
>("elRemoteCommandSelect");

const limits = computed(() => {
  return {
    width: {
      min: 1,
      max: props.activePage.grid.width - localSettings.value.location.x,
    },
    height: {
      min: 1,
      max: props.activePage.grid.height - localSettings.value.location.y,
    },
  };
});

const allEntities = computed<ConfiguredEntity[]>(
  () => integrationStorage.configuredEntities ?? [],
);
const selectionOptions = ref<Record<string, any>>({});

const showCommandSelect = ref(false);
const sizeError = ref(false);

const selectedCommandParams = computed(() => {
  if (
    props.settings.command &&
    props.settings.command.entity_id &&
    props.settings.command.cmd_id
  ) {
    return allCommands.value.find(
      (command: EntityCommandListItem) =>
        command.id ===
        `${props.settings.command.entity_id}:${props.settings.command.cmd_id}`,
    )?.cmd.params as CommandParameter[];
  } else {
    //Empty command
    return [] as CommandParameter[];
  }
});

const maxButtonWidth = computed(() => {
  return validWith(localSettings.value.size.width + 1)
    ? null
    : localSettings.value.size.width;
});

const minButtonHeight = computed(() => {
  if (props.settings.type === "media_player") {
    const mediaMinHeight = Math.ceil(
      props.gridDimensions.widgetMeta.mediaPlayerMinHeight /
        (props.gridDimensions.height / props.activePage.grid.height),
    );
    return mediaMinHeight || 3;
  }

  return 1;
});

const showPopupBody = computed(() => {
  const { type, media_player_id, sensor, select } = props.settings;

  if (type === "media_player") {
    return props.addItem || media_player_id?.length > 0;
  }

  if (type === "sensor") {
    return props.addItem || Object.keys(sensor).length > 0;
  }

  if (type === "select") {
    return props.addItem || Object.keys(select).length > 0;
  }

  if (type === "slider") {
    return props.addItem || Boolean(props.settings.slider);
  }

  if (type === "number") {
    return props.addItem || Boolean(props.settings.number);
  }

  return true;
});

// Slider and number widgets (UC Virtual Remote implementation).
const selectedSliderEntity = computed(() => {
  const id = localSettings.value.slider?.entity_id;
  if (!id) return null;
  return (
    configuredSliderEntities.value.list.find((e) => e.entity_id === id) ??
    integrationStorage.findCachedEntity(id) ??
    null
  );
});

const sliderFeatureOptions = computed(() =>
  sliderFeaturesOf(selectedSliderEntity.value).map((feature) => ({
    label: t(`entity.features.${feature}`, feature),
    value: feature,
  })),
);

const selectedNumberEntity = computed(() => {
  const id = localSettings.value.number?.number_id;
  if (!id) return null;
  return (
    configuredNumberEntities.value.list.find((e) => e.entity_id === id) ??
    integrationStorage.findCachedEntity(id) ??
    null
  );
});

const numberIsBounded = computed(
  () => numberEntityData(selectedNumberEntity.value).bounded,
);

function optionList(values: string[], prefix: string) {
  return values.map((value) => ({
    label: t(`${prefix}.${value}`, value),
    value,
  }));
}

const sliderStyleOptions = computed(() =>
  optionList(SLIDER_STYLES, "widget.popup.slider.style_option"),
);
const sliderUpdateModeOptions = computed(() =>
  optionList(SLIDER_UPDATE_MODES, "widget.popup.slider.update_mode_option"),
);
const sliderColorOptions = computed(() =>
  optionList(SLIDER_COLORS, "widget.popup.slider.color_option"),
);
const sliderFillOptions = computed(() =>
  optionList(SLIDER_FILLS, "widget.popup.slider.fill_option"),
);
const numberDisplayModeOptions = computed(() =>
  optionList(NUMBER_DISPLAY_MODES, "widget.popup.number.display_mode_option"),
);

function sliderEntityName(id: string) {
  const entity =
    configuredSliderEntities.value.list.find((e) => e.entity_id === id) ??
    integrationStorage.findCachedEntity(id);
  return entity ? translatedProperty(entity.name) : getNameById(id);
}

function numberEntityName(id: string) {
  const entity =
    configuredNumberEntities.value.list.find((e) => e.entity_id === id) ??
    integrationStorage.findCachedEntity(id);
  return entity ? translatedProperty(entity.name) : getNameById(id);
}

function doSliderEntitySelect(entity: IncludedEntity) {
  if (!localSettings.value.slider || !entity.entity_id) return;
  localSettings.value.slider.entity_id = entity.entity_id;
  const features = sliderFeaturesOf(entity as ConfiguredEntity);
  const current = localSettings.value.slider.feature;
  if (!current || !features.includes(current)) {
    // The default feature of the entity type is used without `feature`.
    const fallback = features[0];
    if (fallback && fallback !== defaultSliderFeature(entity.entity_type)) {
      localSettings.value.slider.feature = fallback;
    } else {
      delete localSettings.value.slider.feature;
    }
  }
  emitChange();
}

function changeSliderOption(key: string, value: unknown) {
  if (!localSettings.value.slider) return;
  const slider = localSettings.value.slider as Record<string, unknown>;
  if (value === undefined || value === null || value === "") {
    delete slider[key];
  } else {
    slider[key] = value;
  }
  emitChange();
}

function changeSliderFeature(feature: string) {
  changeSliderOption(
    "feature",
    feature === defaultSliderFeature(selectedSliderEntity.value?.entity_type)
      ? undefined
      : feature,
  );
}

function changeSliderLimit(key: "min" | "max", value: unknown) {
  const number = value === "" || value == null ? null : Number(value);
  changeSliderOption(
    key,
    number !== null && Number.isFinite(number) ? number : undefined,
  );
}

function doNumberEntitySelect(entity: IncludedEntity) {
  if (!localSettings.value.number || !entity.entity_id) return;
  localSettings.value.number.number_id = entity.entity_id;
  emitChange();
}

function changeNumberOption(key: string, value: unknown) {
  if (!localSettings.value.number) return;
  const number = localSettings.value.number as Record<string, unknown>;
  if (value === undefined || value === null || value === "") {
    delete number[key];
  } else {
    number[key] = value;
  }
  emitChange();
}

function changeNumberStep(value: unknown) {
  const step = value === "" || value == null ? null : Number(value);
  changeNumberOption(
    "step",
    step !== null && Number.isFinite(step) && step >= 0.000001
      ? step
      : undefined,
  );
}

function openSliderSelect() {
  elSliderSelect.value?.open();
}

function openNumberSelect() {
  elNumberSelect.value?.open();
}

const maxButtonHeight = computed(() => {
  return validHeight(localSettings.value.size.height + 1)
    ? null
    : localSettings.value.size.height;
});

const hueAndSaturation = computed(() => {
  if (
    localSettings.value.command?.params &&
    Object.keys(localSettings.value.command?.params).length === 2 &&
    "hue" in localSettings.value.command.params &&
    "saturation" in localSettings.value.command.params
  ) {
    const paramHue = getParamMetaByKey("hue");
    const paramSaturation = getParamMetaByKey("saturation");

    if (paramHue && paramSaturation) {
      return [
        localSettings.value.command?.params["hue"] ?? paramHue.min,
        localSettings.value.command?.params["saturation"] ??
          paramSaturation.min,
      ];
    }
  }

  return [];
});

const danglingEntities = computed(() => {
  if (!props.entity || props.entityType != EntityType.activity) return [];
  return (props.entity.options?.included_entities ?? [])
    .filter((e: IncludedEntity) => e.available === false)
    .map((e: IncludedEntity) => {
      return e.entity_id;
    });
});

const disableCopy = computed(() => {
  if (!localSettings.value.command?.entity_id) {
    return false;
  }

  return danglingEntities.value.includes(
    localSettings.value.command?.entity_id,
  );
});

const selectedSensorEntity = computed(() => {
  if (!props.settings.sensor || !props.settings.sensor.sensor_id) {
    return null;
  }

  return configuredSensorEntities.value.list.find(
    (e) => e.entity_id === props.settings.sensor.sensor_id,
  );
});

const hasColorPicker = computed(() => {
  const params = Object.keys(props.settings.command?.params ?? {});

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

function emitChange() {
  const paramsExcluded = Object.keys(optionalParamsStatus.value).filter(
    (key) => !optionalParamsStatus.value[key],
  );
  // Keep JSON clone: strips `undefined` fields so the emitted payload matches
  // the JSON wire shape (`structuredClone` would retain them).
  const message = JSON.parse(JSON.stringify(localSettings.value));

  if (paramsExcluded.length > 0) {
    paramsExcluded.forEach((key) => {
      delete message?.command?.params[key];
    });
  }

  if (
    (message.type === EntityType.sensor ||
      message.type === EntityType.select ||
      message.type === "slider" ||
      message.type === EntityType.number) &&
    typeof message.text != "undefined" &&
    message.text.length < 1
  ) {
    delete message.text;
  }

  emit("change", message);
}

function doCommandSelect(command: EntityCommandListItem) {
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

  localSettings.value.command = {
    entity_id: command.entity?.entity_id,
    cmd_id: command.cmd.id,
    params: initParams,
  };
  emitChange();
}

function doMediaPlayerEntitySelect(entity: IncludedEntity) {
  if (
    Object.prototype.hasOwnProperty.call(
      localSettings.value,
      "media_player_id",
    ) &&
    entity.entity_id
  ) {
    localSettings.value.media_player_id = entity.entity_id;
  }
  emitChange();
}

function doSensorEntitySelect(entity: IncludedEntity) {
  if (localSettings.value && localSettings.value.sensor && entity.entity_id) {
    localSettings.value.sensor.sensor_id = entity.entity_id;
  }

  emitChange();
}

function doSelectEntitySelect(entity: IncludedEntity) {
  if (localSettings.value && localSettings.value.select && entity.entity_id) {
    localSettings.value.select.select_id = entity.entity_id;
  }

  emitChange();
}

function doShortCommandSelect(command: string) {
  localSettings.value.command = {
    cmd_id: command,
  };
  emitChange();
}

function updateText() {
  if (
    (text.value && text.value.length > 0) ||
    localSettings.value.type === EntityType.sensor ||
    localSettings.value.type === EntityType.select ||
    localSettings.value.type === "slider" ||
    localSettings.value.type === EntityType.number
  ) {
    localSettings.value.text = text.value;
    emitChange();
  } else {
    text.value = localSettings.value.text;
  }
}

function changedSensorShowLabel() {
  if (localSettings.value && localSettings.value.sensor) {
    localSettings.value.sensor.show_label = sensorShowLabel.value;
    emitChange();
  }
}

function changedSensorShowUnit() {
  if (localSettings.value && localSettings.value.sensor) {
    localSettings.value.sensor.show_unit = sensorShowUnit.value;
    emitChange();
  }
}

function changedSelectShowName() {
  if (localSettings.value && localSettings.value.select) {
    localSettings.value.select.show_name = entSelectShowName.value;
    emitChange();
  }
}

function deleteButton() {
  emit("delete");
}

function setIcon(change: ChangeCallbackParams) {
  localSettings.value.icon = change.value as string;
  emitChange();
}

function validWith(newWidth: number) {
  if (props.addItem) {
    return true;
  }

  return (
    newWidth >= 1 &&
    newWidth <= defaultLimits.width.max &&
    localSettings.value.location.x + newWidth <= defaultLimits.width.max &&
    props.validateSize({
      size: {
        ...localSettings.value.size,
        width: newWidth,
      },
    })
  );
}

function validHeight(newHeight: number) {
  if (props.addItem) {
    return true;
  }

  return (
    newHeight >= 1 &&
    newHeight <= defaultLimits.height.max &&
    localSettings.value.location.y + newHeight <= defaultLimits.height.max &&
    props.validateSize({
      size: {
        ...localSettings.value.size,
        height: newHeight,
      },
    })
  );
}

function changeButtonWidth(newValue: number) {
  sizeError.value = false;
  if (!validWith(newValue)) {
    activetSizeError();
    return false;
  }

  localSettings.value.size.width = newValue;
  emitChange();
}

function changeButtonHeight(newValue: number) {
  sizeError.value = false;
  if (!validHeight(newValue)) {
    activetSizeError();
    return false;
  }

  localSettings.value.size.height = newValue;
  emitChange();
}

async function activetSizeError() {
  sizeError.value = true;

  await sleep(3000);
}

function changeType(newType: "icon" | "text" | "numpad" = "text") {
  if (newType === "icon") {
    localSettings.value.icon = "uc:tv";
    localSettings.value.text = "";
  } else if (newType === "text") {
    localSettings.value.text = t("widget.type.text.default_text");
  }

  localSettings.value.type = newType;
  emitChange();
}

// Handling number input update only on blur
// function setNumericParamValue(event: Event, param: EntityCmdParamNumber) {
//   let newValue = 0;
//   const target = event.target;

//   if (target instanceof HTMLInputElement) {
//     newValue = parseInt(target.value, 10);
//   }

//   if (param !== undefined && param.min !== undefined && param.min > newValue) {
//     newValue = param.min;
//   } else if (
//     param !== undefined &&
//     param.max !== undefined &&
//     param.max < newValue
//   ) {
//     newValue = param.max;
//   }

//   if (localSettings.value.command && localSettings.value.command.params) {
//     localSettings.value.command.params[param.param] = newValue;
//   }
//   emitChange();
// }

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

  paramArray.forEach((p) => {
    const newValue = p.paramValue;

    if (
      localSettings.value.command &&
      p?.paramName &&
      newValue !== undefined &&
      newValue !== null
    ) {
      if (!localSettings.value.command.params) {
        localSettings.value.command.params = {};
      }

      localSettings.value.command.params[p.paramName] = newValue;
    }
  });

  emitChange();
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

function getNameById(entity_id: string | Record<string, any>) {
  const selected_entity = (
    (props.entity.options?.included_entities ?? []) as IncludedEntity[]
  ).find((entity) => {
    return entity.entity_id === entity_id;
  });

  if (!selected_entity) return "";
  return translatedProperty(selected_entity?.name);
}

function getSensorNameById(entity_id: string | Record<string, any>) {
  const selected_entity = (
    configuredSensorEntities.value.list as ConfiguredEntity[]
  ).find((entity) => {
    return entity.entity_id === entity_id;
  });
  return translatedProperty(selected_entity?.name);
}

function getSelectNameById(entity_id: string | Record<string, any>) {
  const selected_entity = (
    configuredSelectEntities.value.list as ConfiguredEntity[]
  ).find((entity) => {
    return entity.entity_id === entity_id;
  });
  return translatedProperty(selected_entity?.name);
}

function getEntSelectAttributesById(entity_id: string | Record<string, any>) {
  const selected_entity = (
    configuredSelectEntities.value.list as ConfiguredEntity[]
  ).find((entity) => {
    return entity.entity_id === entity_id;
  });
  return selected_entity?.attributes;
}

function getIntegrationNameById(entity_id: string | Record<string, any>) {
  const selected_entity = (
    (props.entity.options?.included_entities ?? []) as IncludedEntity[]
  ).find((entity) => {
    return entity.entity_id === entity_id;
  });

  if (!selected_entity) return "";
  return translatedProperty(selected_entity?.integration?.name);
}

function closePopup() {
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
    (ent) => ent.entity_id === props.settings.command.entity_id,
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
    props.settings?.command == null ||
    props.settings?.command?.params == null ||
    typeof props.settings?.command === "undefined" ||
    typeof props.settings?.command?.params === "undefined"
  ) {
    return false;
  }

  const paramsArray = Object.keys(props.settings?.command?.params).map((key) =>
    getParamMetaByKey(key),
  );

  if (paramsArray && paramsArray.length > 0) {
    // TODO(#254) use a constant / enum for the magic text "selection"
    const selectionParams = paramsArray.filter(
      (p) => p && p.type === "selection",
    );

    if (selectionParams && selectionParams.length > 0) {
      setSelectionParamOptions(selectionParams);
    }
  }
}

function setOptionalParamsStatus() {
  if (!selectedCommandParams.value) return false;

  selectedCommandParams.value.forEach((p: any) => {
    if (p && p.optional && p.optional === true) {
      const pValue = props.settings?.command?.params[p.param];
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
    emitChange();
  } else if (optionalParamsStatus.value[p] === false) {
    optionalParamsStatus.value[p] = true;
  }
}

function displayParameter(index: number) {
  if (!localSettings.value.command?.params) {
    return true;
  }

  const previousParam = Object.keys(localSettings.value.command?.params)[
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

function openMediaPlayerSelect() {
  if (elMediaPlayerSelect.value) {
    elMediaPlayerSelect.value.open();
  }
}

function openSensorSelect() {
  if (elSensorSelect.value) {
    elSensorSelect.value.open();
  }
}

function openEntSelectSelect() {
  if (elEntSelectSelect.value) {
    elEntSelectSelect.value.open();
  }
}

function copyItem() {
  emit("copy");
}

function deleteItem() {
  emit("delete");
}

function triggerClose() {
  emit("close");
}

onMounted(async () => {
  commandMetadata.value = await integrationStorage.getCommandMetadata();

  allCommands.value = getAvailableCommandsForActivity(
    props.entity as ActivityFull,
    commandMetadata.value,
  ) as EntityCommandListItem[];

  checkParamsType();
  if (
    props.addItem &&
    props.entityType != "activity" &&
    selectedCommandParams.value &&
    selectedCommandParams.value.length < 1
  ) {
    showCommandSelect.value = true;
    await sleep(500);

    if (!isTouchEnabled() && elRemoteCommandSelect.value) {
      elRemoteCommandSelect.value.focusSearch();
    }
  }

  if (
    props.addItem &&
    props.entityType === "activity" &&
    props.settings.type === EntityType.sensor &&
    (!props.settings.sensor.sensor_id ||
      props.settings.sensor.sensor_id.length < 1)
  ) {
    openSensorSelect();
  }

  if (
    props.addItem &&
    props.entityType === "activity" &&
    props.settings.type === EntityType.select &&
    (!props.settings.select.select_id ||
      props.settings.select.select_id.length < 1)
  ) {
    openEntSelectSelect();
  }

  if (
    props.addItem &&
    props.entityType === "activity" &&
    props.settings.type === "slider" &&
    !props.settings.slider?.entity_id
  ) {
    openSliderSelect();
  }

  if (
    props.addItem &&
    props.entityType === "activity" &&
    props.settings.type === EntityType.number &&
    !props.settings.number?.number_id
  ) {
    openNumberSelect();
  }

  if (
    props.settings.type === "slider" &&
    configuredSliderEntities.value.list.length < 1 &&
    !configuredSliderEntities.value.fetching
  ) {
    integrationStorage.getConfiguredSliderEntities(false).catch(console.error);
  }

  if (
    props.settings.type === EntityType.number &&
    configuredNumberEntities.value.list.length < 1 &&
    !configuredNumberEntities.value.fetching
  ) {
    integrationStorage.getConfiguredNumberEntities(false).catch(console.error);
  }

  if (
    configuredSensorEntities.value.list.length < 1 &&
    !configuredSensorEntities.value.fetching
  ) {
    try {
      await integrationStorage.getConfiguredSensorEntities(false);
    } catch (e) {
      console.error(e);
    }
  }

  if (
    configuredSelectEntities.value.list.length < 1 &&
    !configuredSelectEntities.value.fetching
  ) {
    try {
      await integrationStorage.getConfiguredSelectEntities(false);
    } catch (e) {
      console.error(e);
    }
  }

  setOptionalParamsStatus();
});
</script>
<template>
  <div
    class="widget-popup"
    :class="{
      'widget-popup--add-item': addItem,
      'widget-popup--saving': saving,
    }"
  >
    <div v-if="!addItem" class="widget-popup__header">
      <div class="widget-popup__header__title">
        {{ $t("widget.edit_widget") }}
      </div>
      <Transition name="opacity-fast">
        <button
          v-show="!saving"
          class="button button--secondary button--icon button--icon--small"
          @click="triggerClose"
        >
          <i class="fa-regular fa-close"></i>
        </button>
      </Transition>
      <Transition name="opacity-fast">
        <div v-show="saving" class="widget-popup__loader">
          <img
            src="/images/loading-indicator.png"
            alt="Loading"
            class="img-loading"
          />
        </div>
      </Transition>
    </div>
    <div class="widget-popup__body">
      <div v-if="showPopupBody" class="widget-popup__fields">
        <div
          v-if="localSettings.type === 'icon'"
          class="widget-popup__field widget-popup__field--icon"
        >
          <label for="icon">
            {{ $t("widget.popup.icon") }}
          </label>
          <div class="widget-setting widget-setting--icon">
            <IconSelect
              :key="localSettings.icon ? localSettings.icon : 'fa-light fa-tv'"
              :value="
                localSettings.icon ? localSettings.icon : 'fa-light fa-tv'
              "
              :fallback="'fa-light fa-tv'"
              :change-callback="setIcon"
              :has-tv-channel="true"
            />
          </div>
        </div>
        <template
          v-if="localSettings.type === 'select' && localSettings.select"
        >
          <UCToggle
            v-if="localSettings.select.select_id"
            v-model="entSelectShowName"
            :label="$t('widget.popup.select.show_entity_name')"
            :full-w="true"
            @change="changedSelectShowName"
          />
        </template>
        <div
          v-if="
            localSettings.type === 'text' ||
            (localSettings.type === 'sensor' &&
              localSettings.sensor?.sensor_id) ||
            (localSettings.type === 'select' &&
              localSettings.select?.select_id &&
              !entSelectShowName) ||
            (localSettings.type === 'slider' &&
              localSettings.slider?.entity_id &&
              !sliderShowName) ||
            (localSettings.type === 'number' &&
              localSettings.number?.number_id &&
              !numberShowName)
          "
          class="widget-popup__field widget-popup__field--text"
        >
          <UCInput
            v-model="text"
            :full-w="true"
            :focus="localSettings.type === 'text'"
            :select-on-focus="localSettings.type === 'text'"
            :label="
              localSettings.type === 'sensor'
                ? $t('form.name')
                : $t('form.label')
            "
            @submit="updateText"
          />
        </div>
        <div
          v-if="localSettings.type === 'media_player'"
          class="widget-popup__command-wrapper"
          :class="[
            {
              'widget-popup__command-wrapper--minimal':
                !localSettings.media_player_id,
            },
            {
              'widget-popup__command-wrapper--open':
                showCommandSelect && entityType != 'activity',
            },
          ]"
        >
          <CommandField
            :id="localSettings.media_player_id"
            :entity-type="entityType"
            :name="getNameById(localSettings.media_player_id || '')"
            :entity="
              localSettings.media_player_id
                ? getIntegrationNameById(localSettings.media_player_id)
                : ''
            "
            :extended-command-select="entityType === 'activity'"
            :label="$t('ui.label')"
            @open-command-select="openMediaPlayerSelect"
          />
          <WidgetEntitySelect
            v-if="entityType === 'activity'"
            :key="localSettings.media_player_id || $t('ui.none')"
            ref="elMediaPlayerSelect"
            :value="localSettings.media_player_id || ''"
            :activity="entity"
            :entity-type="EntityType.media_player"
            @select="doMediaPlayerEntitySelect"
          />
        </div>
        <template
          v-else-if="localSettings.type === 'sensor' && localSettings.sensor"
        >
          <div
            class="widget-popup__command-wrapper"
            :class="[
              {
                'widget-popup__command-wrapper--minimal':
                  !localSettings.media_player_id,
              },
              {
                'widget-popup__command-wrapper--open':
                  showCommandSelect && entityType != 'activity',
              },
            ]"
          >
            <CommandField
              :id="localSettings.sensor.sensor_id"
              :entity-type="entityType"
              :name="getSensorNameById(localSettings.sensor.sensor_id || '')"
              :entity="
                localSettings.sensor.sensor_id
                  ? getIntegrationNameById(localSettings.sensor.sensor_id)
                  : ''
              "
              :extended-command-select="entityType === 'activity'"
              :label="$t('widget.popup.sensor.label')"
              @open-command-select="openSensorSelect"
            />
            <WidgetEntitySelect
              v-if="entityType === 'activity'"
              :key="localSettings.sensor.sensor_id || $t('ui.none')"
              ref="elSensorSelect"
              :value="localSettings.sensor.sensor_id || ''"
              :activity="entity"
              :entity-type="EntityType.sensor"
              @select="doSensorEntitySelect"
            />
          </div>

          <UCToggle
            v-if="localSettings.sensor.sensor_id"
            v-model="sensorShowLabel"
            :label="$t('widget.popup.sensor.show_label')"
            :full-w="true"
            :disabled="text.length > 1"
            @change="changedSensorShowLabel"
          />

          <UCToggle
            v-if="
              localSettings.sensor.sensor_id &&
              selectedSensorEntity != null &&
              selectedSensorEntity.device_class &&
              selectedSensorEntity.device_class != 'binary'
            "
            v-model="sensorShowUnit"
            :label="$t('widget.popup.sensor.show_unit')"
            :full-w="true"
            @change="changedSensorShowUnit"
          />
        </template>
        <template
          v-else-if="localSettings.type === 'select' && localSettings.select"
        >
          <div
            class="widget-popup__command-wrapper"
            :class="[
              {
                'widget-popup__command-wrapper--minimal':
                  !localSettings.media_player_id,
              },
              {
                'widget-popup__command-wrapper--open':
                  showCommandSelect && entityType != 'activity',
              },
            ]"
          >
            <CommandField
              :id="localSettings.select.select_id"
              :entity-type="entityType"
              :name="getSelectNameById(localSettings.select.select_id || '')"
              :entity="
                localSettings.select.select_id
                  ? getIntegrationNameById(localSettings.select.select_id)
                  : ''
              "
              :extended-command-select="entityType === 'activity'"
              :label="$t('widget.popup.select.label')"
              @open-command-select="openEntSelectSelect"
            />
            <WidgetEntitySelect
              v-if="entityType === 'activity'"
              :key="localSettings.select.select_id || $t('ui.none')"
              ref="elEntSelectSelect"
              :value="localSettings.select.select_id || ''"
              :activity="entity"
              :entity-type="EntityType.select"
              @select="doSelectEntitySelect"
            />
          </div>

          <div class="command-meta">
            <span class="command-meta__label">{{ $t("form.option") }}</span>
            <div class="command-meta__value">
              <template
                v-if="
                  getEntSelectAttributesById(
                    localSettings.select.select_id || '',
                  )?.current_option
                "
              >
                {{
                  getEntSelectAttributesById(
                    localSettings.select.select_id || "",
                  )?.current_option
                }}
              </template>
              <span v-else class="command-meta__value__none">{{
                $t("ui.none")
              }}</span>
            </div>
          </div>
        </template>
        <template
          v-else-if="localSettings.type === 'slider' && localSettings.slider"
        >
          <div
            class="widget-popup__command-wrapper"
            :class="{
              'widget-popup__command-wrapper--minimal':
                !localSettings.slider.entity_id,
            }"
          >
            <CommandField
              :id="localSettings.slider.entity_id"
              :entity-type="entityType"
              :name="sliderEntityName(localSettings.slider.entity_id || '')"
              :entity="
                localSettings.slider.entity_id
                  ? getIntegrationNameById(localSettings.slider.entity_id)
                  : ''
              "
              :extended-command-select="entityType === 'activity'"
              :label="$t('widget.popup.slider.label')"
              @open-command-select="openSliderSelect"
            />
            <WidgetEntitySelect
              v-if="entityType === 'activity'"
              :key="localSettings.slider.entity_id || $t('ui.none')"
              ref="elSliderSelect"
              :value="localSettings.slider.entity_id || ''"
              :activity="entity"
              :entity-type="'slider'"
              @select="doSliderEntitySelect"
            />
          </div>
          <template v-if="localSettings.slider.entity_id">
            <WidgetOptionSelect
              v-if="sliderFeatureOptions.length > 1"
              :label="$t('ui.feature')"
              :value="
                localSettings.slider.feature ||
                sliderFeatureOptions[0]?.value ||
                ''
              "
              :options="sliderFeatureOptions"
              @change="changeSliderFeature"
            />
            <UCToggle
              v-model="sliderShowName"
              :label="$t('widget.popup.select.show_entity_name')"
              :full-w="true"
              @change="changeSliderOption('show_name', sliderShowName)"
            />
            <UCToggle
              v-model="sliderShowValue"
              :label="$t('widget.popup.slider.show_value')"
              :full-w="true"
              @change="changeSliderOption('show_value', sliderShowValue)"
            />
            <WidgetOptionSelect
              :label="$t('widget.popup.slider.style')"
              :value="localSettings.slider.style || 'default'"
              :options="sliderStyleOptions"
              @change="(value: string) => changeSliderOption('style', value)"
            />
            <template v-if="localSettings.slider.style !== 'buttons'">
              <WidgetOptionSelect
                :label="$t('widget.popup.slider.update_mode')"
                :value="localSettings.slider.update_mode || 'on_release'"
                :options="sliderUpdateModeOptions"
                @change="
                  (value: string) => changeSliderOption('update_mode', value)
                "
              />
              <WidgetOptionSelect
                :label="$t('widget.popup.slider.color')"
                :value="localSettings.slider.color || 'auto'"
                :options="sliderColorOptions"
                @change="(value: string) => changeSliderOption('color', value)"
              />
              <WidgetOptionSelect
                :label="$t('widget.popup.slider.fill')"
                :value="localSettings.slider.fill || 'auto'"
                :options="sliderFillOptions"
                @change="(value: string) => changeSliderOption('fill', value)"
              />
              <div class="widget-popup__field widget-popup__field--icon">
                <label>{{ $t("widget.popup.slider.icon_min") }}</label>
                <div class="widget-setting widget-setting--icon">
                  <IconSelect
                    :key="`min-${localSettings.slider.icon_min || ''}`"
                    :value="localSettings.slider.icon_min || ''"
                    :fallback="'fa-light fa-minus'"
                    :change-callback="
                      (change: ChangeCallbackParams) =>
                        changeSliderOption('icon_min', change.value)
                    "
                  />
                </div>
              </div>
              <div class="widget-popup__field widget-popup__field--icon">
                <label>{{ $t("widget.popup.slider.icon_max") }}</label>
                <div class="widget-setting widget-setting--icon">
                  <IconSelect
                    :key="`max-${localSettings.slider.icon_max || ''}`"
                    :value="localSettings.slider.icon_max || ''"
                    :fallback="'fa-light fa-plus'"
                    :change-callback="
                      (change: ChangeCallbackParams) =>
                        changeSliderOption('icon_max', change.value)
                    "
                  />
                </div>
              </div>
            </template>
            <UCInput
              v-model="sliderMin"
              :type="'number'"
              :full-w="true"
              :label="$t('widget.popup.slider.min')"
              :description="$t('widget.popup.slider.limit_description')"
              @submit="changeSliderLimit('min', sliderMin)"
            />
            <UCInput
              v-model="sliderMax"
              :type="'number'"
              :full-w="true"
              :label="$t('widget.popup.slider.max')"
              @submit="changeSliderLimit('max', sliderMax)"
            />
          </template>
        </template>
        <template
          v-else-if="localSettings.type === 'number' && localSettings.number"
        >
          <div
            class="widget-popup__command-wrapper"
            :class="{
              'widget-popup__command-wrapper--minimal':
                !localSettings.number.number_id,
            }"
          >
            <CommandField
              :id="localSettings.number.number_id"
              :entity-type="entityType"
              :name="numberEntityName(localSettings.number.number_id || '')"
              :entity="
                localSettings.number.number_id
                  ? getIntegrationNameById(localSettings.number.number_id)
                  : ''
              "
              :extended-command-select="entityType === 'activity'"
              :label="$t('widget.popup.number.label')"
              @open-command-select="openNumberSelect"
            />
            <WidgetEntitySelect
              v-if="entityType === 'activity'"
              :key="localSettings.number.number_id || $t('ui.none')"
              ref="elNumberSelect"
              :value="localSettings.number.number_id || ''"
              :activity="entity"
              :entity-type="EntityType.number"
              @select="doNumberEntitySelect"
            />
          </div>
          <template v-if="localSettings.number.number_id">
            <UCToggle
              v-model="numberShowName"
              :label="$t('widget.popup.select.show_entity_name')"
              :full-w="true"
              @change="changeNumberOption('show_name', numberShowName)"
            />
            <WidgetOptionSelect
              :label="$t('widget.popup.number.display_mode')"
              :value="localSettings.number.display_mode || 'auto'"
              :options="numberDisplayModeOptions"
              :disabled="!numberIsBounded"
              @change="
                (value: string) => changeNumberOption('display_mode', value)
              "
            />
            <UCInput
              v-model="numberStep"
              :type="'number'"
              :full-w="true"
              :label="$t('widget.popup.number.step')"
              :description="$t('widget.popup.number.step_description')"
              @submit="changeNumberStep(numberStep)"
            />
          </template>
        </template>
        <div
          v-else-if="localSettings.type !== 'numpad'"
          class="widget-popup__command-wrapper"
          :class="[
            {
              'widget-popup__command-wrapper--minimal':
                !localSettings.command?.entity_id,
            },
            {
              'widget-popup__command-wrapper--open':
                showCommandSelect && entityType != 'activity',
            },
          ]"
        >
          <CommandField
            :id="localSettings.command?.cmd_id || ''"
            :entity-type="entityType"
            :name="getCommandNameById(localSettings.command?.cmd_id || '')"
            :entity="
              localSettings.command?.entity_id
                ? getEntityNameById(localSettings.command?.entity_id)
                : ''
            "
            :show-command-select="showCommandSelect"
            :extended-command-select="entityType === 'activity'"
            @open-command-select="openCommandSelect"
            @toggle-command-select="showCommandSelect = !showCommandSelect"
          />
          <Transition name="collapse">
            <div v-show="showCommandSelect" class="command-select-wrapper">
              <RemoteCommandSelect
                v-if="entityType === 'remote'"
                ref="elRemoteCommandSelect"
                :key="localSettings.command?.cmd_id || $t('ui.none')"
                :value="localSettings.command?.cmd_id || ''"
                :button="localSettings"
                :remote="entity"
                @select="doShortCommandSelect"
              />
            </div>
          </Transition>
          <CommandSelect
            v-if="entityType === 'activity'"
            ref="elCommandSelect"
            :key="localSettings.command?.cmd_id || $t('ui.none')"
            :value="localSettings.command?.cmd_id || ''"
            :button="localSettings"
            :activity="entity"
            :label-text="localSettings.type === 'text' ? text : ''"
            :label-icon="
              localSettings.type === 'icon' && localSettings.icon
                ? localSettings.icon
                : ''
            "
            @select="doCommandSelect"
          />
        </div>
        <template v-if="selectedCommandParams">
          <div class="widget-popup__params">
            <template
              v-for="(param, index) in selectedCommandParams"
              :key="param.param"
            >
              <div
                v-if="displayParameter(index)"
                class="widget-popup__param-wrapper"
                :class="{
                  'widget-popup__param-wrapper--custom': hasColorPicker,
                }"
              >
                <div
                  v-if="hasOptional && !hasColorPicker"
                  class="widget-popup__params__field-optional"
                >
                  <div
                    v-if="optionalParamsStatus[param.param] != undefined"
                    class="form-item form-item--checkbox-tick form-item--checkbox-tick--small form-item--checkbox-tick"
                  >
                    <input
                      :id="`widget-popup__params-${index}-checkbox-tick`"
                      :checked="optionalParamsStatus[param.param]"
                      type="checkbox"
                    />
                    <label
                      class="toggle"
                      :for="`widget-popup__params-${index}-checkbox-tick`"
                    />
                    <button
                      class="button--toggle-tick"
                      @click="updateOptionalParamStatus(param.param)"
                    ></button>
                  </div>
                </div>
                <template v-if="hasColorPicker">
                  <span class="widget-popup__param-wrapper__label">{{
                    $t("widget.popup.command.color")
                  }}</span>
                  <ColorPicker :hs="hueAndSaturation" @change="colorChanged" />
                </template>
                <CommandParam
                  v-else
                  :value="localSettings.command?.params?.[param.param]"
                  :meta="getParamMetaByKey(param.param)"
                  :command="localSettings.command"
                  :index="index"
                  :selection-options="
                    selectionOptions[getParamMetaByKey(param.param)?.param] ||
                    []
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

        <div
          v-if="
            localSettings.type !== 'media_player' &&
            localSettings.type !== 'numpad' &&
            (localSettings.type !== 'sensor' ||
              localSettings.sensor?.sensor_id) &&
            (localSettings.type !== 'select' ||
              localSettings.select?.select_id) &&
            (localSettings.type !== 'slider' ||
              localSettings.slider?.entity_id) &&
            (localSettings.type !== 'number' || localSettings.number?.number_id)
          "
          class="widget-popup__field widget-popup__field--size"
        >
          <label>
            {{ $t("widget.popup.width") }}
          </label>
          <div class="widget-setting widget-setting--width">
            <UCStepper
              v-model="localSettings.size.width"
              :min="1"
              :max="maxButtonWidth || limits.width.max"
              @change="changeButtonWidth"
            />
          </div>
        </div>

        <div
          v-if="
            (localSettings.type !== 'media_player' ||
              localSettings.media_player_id) &&
            (localSettings.type !== 'sensor' ||
              localSettings.sensor?.sensor_id) &&
            (localSettings.type !== 'select' ||
              localSettings.select?.select_id) &&
            (localSettings.type !== 'slider' ||
              localSettings.slider?.entity_id) &&
            (localSettings.type !== 'number' ||
              localSettings.number?.number_id) &&
            localSettings.type !== 'numpad'
          "
          class="widget-popup__field widget-popup__field--size"
        >
          <label>
            {{ $t("widget.popup.height") }}
          </label>
          <div class="widget-setting widget-setting--height">
            <UCStepper
              v-model="localSettings.size.height"
              :min="minButtonHeight"
              :max="maxButtonHeight || limits.height.max"
              @change="changeButtonHeight"
            />
          </div>
        </div>
        <p v-show="sizeError" class="widget-popup__error">
          {{ $t("widget.popup.error.invalid_size") }}
        </p>

        <Transition name="collapse-small">
          <div v-if="!addItem" class="widget-popup__footer">
            <div class="widget-popup__footer__left">
              <div
                v-if="localSettings.type === 'icon'"
                class="widget-popup__button-convert"
                @click="changeType('text')"
              >
                <button
                  class="button button--tertiary button--icon button--icon--medium"
                >
                  <i class="fa-regular fa-rotate"></i>
                </button>
                <span>
                  {{ $t("widget.popup.convert_to_text") }}
                </span>
              </div>
              <div
                v-else-if="localSettings.type === 'text'"
                class="widget-popup__button-convert"
                @click="changeType('icon')"
              >
                <button
                  class="button button--tertiary button--icon button--icon--medium"
                >
                  <i class="fa-regular fa-rotate"></i>
                </button>
                <span>
                  {{ $t("widget.popup.convert_to_icon") }}
                </span>
              </div>
            </div>
            <div class="widget-popup__footer__right">
              <button
                :disabled="disableCopy"
                class="button button--secondary button--icon button--icon--medium"
                @click="copyItem"
              >
                <i class="fa-regular fa-copy"></i>
              </button>
              <button
                class="button button--secondary button--icon button--icon--medium"
                @click="deleteItem"
              >
                <i class="fa-regular fa-trash"></i>
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </div>
    <!-- <template v-if="localSettings.type !== 'numpad'">
      <WidgetEntitySelect
        v-if="entityType === 'activity' && localSettings.type === 'media_player'"
        :key="localSettings.media_player_id || $t('ui.none')"
        :value="localSettings.media_player_id || ''"
        :activity="entity"
        @select="doMediaPlayerEntitySelect"
      />
      <CommandSelect
        v-else-if="entityType === 'activity'"
        :key="localSettings.command?.cmd_id || $t('ui.none')"
        :value="localSettings.command?.cmd_id || ''"
        :activity="entity"
        @select="doCommandSelect"
      />
      <RemoteCommandSelect
        v-else-if="entityType === 'remote'"
        :key="`remote-${localSettings.command?.cmd_id}` || $t('ui.none')"
        :value="localSettings.command?.cmd_id || ''"
        :remote="entity"
        :label="false"
        @select="doShortCommandSelect"
      />
    </template> -->
  </div>
</template>
