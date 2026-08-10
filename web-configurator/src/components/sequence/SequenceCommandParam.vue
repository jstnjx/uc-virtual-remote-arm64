<script setup lang="ts">
import { computed, type PropType } from "vue";
import { useTranslation } from "i18next-vue";

import { EntityType, RemoteKind } from "@/types/enums";

import { addErrorBottom } from "@/stores/messages";

import SetupColorTemp from "@/components/ui/setup/SetupColorTemp.vue";
import SetupNumber from "@/components/ui/setup/SetupNumber.vue";
import SetupEnum from "@/components/ui/setup/SetupEnum.vue";
import SetupBoolean from "@/components/ui/setup/SetupBoolean.vue";
import SetupRegex from "@/components/ui/setup/SetupRegex.vue";
import SetupSelection from "@/components/ui/setup/SetupSelection.vue";

const { t } = useTranslation();

const props = defineProps({
  param: {
    type: Object,
    required: true,
  },
  item: {
    type: Object,
    required: true,
  },
  index: {
    type: Number,
    required: true,
  },
  options: {
    type: Array as PropType<string[]>,
    required: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["change"]);

const isIrRemote = computed(() => {
  const entity = props.item.entity;

  if (!entity || entity.entity_type !== EntityType.remote) {
    return false;
  }

  const options = entity.options;

  if (!options) {
    return false;
  }

  const hasCommands =
    Array.isArray(options.simple_commands) &&
    options.simple_commands.length > 0;
  const isIrKind = !options.kind || options.kind === RemoteKind.IR;

  return isIrKind && hasCommands;
});

function isInvalidNewValue(val: string): boolean {
  const pattern = props.param.regex;

  if (!val) return false;
  if (!pattern) return false;

  return !new RegExp(pattern).test(val);
}

function emitChange(message?: any) {
  if (props.param.type === "regex" && isIrRemote.value) {
    if (message.paramValue && isInvalidNewValue(message.paramValue)) {
      addErrorBottom(t("error.INVALID_FORMAT"));
      return false;
    }
  }

  if (typeof message != "undefined") {
    emit("change", message);
  }
}
</script>
<template>
  <SetupSelection
    v-if="param.type === 'regex' && isIrRemote && param.param != 'sequence'"
    :key="`irremote-${index}`"
    :value="
      item.sequence?.command?.params?.[param.param] !== undefined
        ? item.sequence?.command?.params[param.param]
        : (param.default ?? '')
    "
    :params="param"
    :options="item.entity.options.simple_commands"
    :allow-free-text="true"
    @change="emitChange"
  />
  <SetupColorTemp
    v-else-if="param.type === 'number' && param.param === 'color_temperature'"
    :key="`color-temperature-${index}`"
    :value="
      Number(
        item.sequence?.command?.params?.[param.param] !== undefined
          ? item.sequence?.command?.params[param.param]
          : (param.default ?? param.min ?? 0),
      )
    "
    :params="param"
    :disabled="disabled"
    @change="emitChange"
  />
  <SetupNumber
    v-else-if="param.type === 'number'"
    :key="`number-${index}`"
    :value="
      item.sequence?.command?.params?.[param.param] !== undefined
        ? item.sequence?.command?.params[param.param]
        : (param.default ?? param.min ?? 0)
    "
    :params="param"
    :disabled="disabled"
    @change="emitChange"
  />
  <SetupEnum
    v-else-if="param.type === 'enum'"
    :key="`enum-${index}`"
    :param-name="param.param"
    :value="
      item.sequence?.command?.params?.[param.param] !== undefined
        ? item.sequence?.command?.params[param.param]
        : (param.default ?? '')
    "
    :options="param.values"
    :disabled="disabled"
    @change="emitChange"
  />
  <SetupBoolean
    v-else-if="param.type === 'bool'"
    :id="item.id"
    :key="`bool-${index}`"
    :param-name="param.param"
    :value="
      item.sequence?.command?.params?.[param.param] !== undefined
        ? item.sequence?.command?.params[param.param]
        : (param.default ?? true)
    "
    :disabled="disabled"
    @change="emitChange"
  />
  <SetupRegex
    v-else-if="param.type === 'regex'"
    :id="item.id"
    :key="`regex-${index}`"
    :entity-id="item.entity.entity_id"
    :param-name="param.param"
    :value="
      item.sequence?.command?.params?.[param.param] !== undefined
        ? item.sequence?.command?.params[param.param]
        : (param.default ?? '')
    "
    :regex="param.regex ?? ''"
    :disabled="disabled"
    @change="emitChange"
  />
  <SetupSelection
    v-else-if="param.type === 'selection'"
    :key="`selection-${index}`"
    :value="
      item.sequence?.command?.params?.[param.param] !== undefined
        ? item.sequence?.command?.params[param.param]
        : (param.default ?? '')
    "
    :params="param"
    :options="options"
    :disabled="disabled"
    @change="emitChange"
  />
</template>
