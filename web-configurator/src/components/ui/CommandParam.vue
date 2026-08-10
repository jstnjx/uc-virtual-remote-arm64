<script setup lang="ts">
import { ref, computed, watch, onMounted, type PropType } from "vue";
import { useTranslation } from "i18next-vue";
import { storeToRefs } from "pinia";

import { EntityType, RemoteKind } from "@/types/enums";
import type {
  EntityCmdParamNumber,
  EntityCmdParamEnum,
  EntityCmdParamChange,
} from "@/types/activity";
import type { ConfiguredEntity } from "@/types/integrationInstance";

import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";

import translatedProperty from "@/composables/translatedProperty";

import UCInput from "@/components/ui/UCInput.vue";
import ParamSetupSelection from "@/components/elements/param/ParamSetupSelection.vue";
import ParamSetupEnum from "@/components/elements/param/ParamSetupEnum.vue";
import ParamSetupBoolean from "@/components/elements/param/ParamSetupBoolean.vue";
import ParamSetupRegex from "@/components/elements/param/ParamSetupRegex.vue";
import ParamSetupColorTemp from "@/components/elements/param/ParamSetupColorTemp.vue";

const { t } = useTranslation();

const integrationsStorage = integrationsStore();

const props = defineProps({
  value: {
    default: undefined,
  },
  meta: {
    type: Object,
    default: null,
  },
  command: {
    type: Object,
    default: null,
  },
  index: {
    type: Number,
    default: 0,
  },
  selectionOptions: {
    type: Array as PropType<string[]>,
    default: () => [],
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["changeParamValue"]);

const { configuredEntities } = storeToRefs(integrationsStorage);
const paramValue = ref(props.value ?? props.meta?.default ?? 0);

watch(props, () => {
  paramValue.value = props.value ?? props.meta?.default ?? 0;
});

const commandEntity = computed(() => {
  if (!props.command) return;

  return configuredEntities.value.find((item: ConfiguredEntity) => {
    return item.entity_id === props.command.entity_id;
  });
});

const isIrRemote = computed(() => {
  const entity = commandEntity.value;

  if (!entity || entity.entity_type !== EntityType.remote) {
    return false;
  }

  const options = entity.options;

  return (
    !!options &&
    (!options.kind || options.kind === RemoteKind.IR) &&
    Array.isArray(options.simple_commands) &&
    options.simple_commands.length > 0
  );
});

const mainClasses = computed(() => {
  let classList = "";
  classList += props.disabled ? "command-param--disabled " : "";
  return classList;
});

function isInvalidNewValue(val: string): boolean {
  const pattern = props.meta?.regex;

  if (!val) return false;
  if (!pattern) return false;

  return !new RegExp(pattern).test(val);
}

function setParamValue(value: any) {
  if (props.meta.type === "regex" && isIrRemote.value) {
    if (value && isInvalidNewValue(value)) {
      addErrorBottom(t("error.INVALID_FORMAT"));
      return false;
    }
  }

  emit("changeParamValue", {
    paramValue: value,
    paramName: props.meta.param,
  });
}

function setNumericParamValue(value: number) {
  let newValue = value;
  if (
    props.meta !== undefined &&
    props.meta.min !== undefined &&
    props.meta.min > newValue
  ) {
    newValue = props.meta.min;
  } else if (
    props.meta !== undefined &&
    props.meta.max !== undefined &&
    props.meta.max < newValue
  ) {
    newValue = props.meta.max;
  }

  emit("changeParamValue", {
    paramValue: newValue,
    paramName: props.meta.param,
  });
}

function setMedia(value: EntityCmdParamChange[]) {
  emit("changeParamValue", value);
}

onMounted(() => {
  integrationsStorage.getConfiguredEntities(null, false);
});
</script>
<template>
  <span
    v-if="meta?.type === 'regex' && isIrRemote && meta?.param != 'sequence'"
    class="command-param command-param--irremote"
    :class="mainClasses"
  >
    <ParamSetupSelection
      :key="`param-${index}`"
      :value="value ?? meta?.default ?? ''"
      :meta="meta || {}"
      :options="(commandEntity?.options?.simple_commands as string[]) ?? []"
      :allow-free-text="true"
      :disabled="disabled"
      @change="setParamValue"
    />
  </span>
  <span
    v-else-if="
      meta?.type === 'number' &&
      meta?.param === 'color_temperature' &&
      meta !== undefined
    "
    class="command-param command-param--color-temperature"
    :class="mainClasses"
  >
    <ParamSetupColorTemp
      :key="`param-${index}`"
      :value="value ?? meta.default ?? 0"
      :meta="meta || {}"
      :options="selectionOptions || []"
      :disabled="disabled"
      @change="setParamValue"
    />
  </span>
  <span
    v-else-if="meta?.type === 'number' && meta !== undefined"
    class="command-param command-param--number"
    :class="mainClasses"
  >
    <UCInput
      :key="`param-${index}`"
      v-model="paramValue"
      :label="translatedProperty(meta?.name)"
      :unit="(meta as EntityCmdParamNumber).unit"
      :full-w="true"
      :type="'number'"
      :disabled="disabled"
      @submit="
        (message: any) => {
          setNumericParamValue(message);
        }
      "
    />
  </span>
  <span
    v-else-if="meta?.type === 'selection'"
    class="command-param command-param--selection"
    :class="mainClasses"
  >
    <ParamSetupSelection
      :key="`param-${index}`"
      :value="value ?? meta?.default ?? ''"
      :meta="meta || {}"
      :options="selectionOptions || []"
      :disabled="disabled"
      @change="setParamValue"
    />
  </span>
  <span
    v-else-if="meta?.type === 'enum'"
    class="command-param command-param--enum"
    :class="mainClasses"
  >
    <ParamSetupEnum
      :id="`param-${index}`"
      :ref="`param-${index}`"
      :key="`param-${index}`"
      :param-name="meta?.param"
      :value="value ?? meta?.default ?? ''"
      :label="translatedProperty(meta?.name)"
      :options="(meta as EntityCmdParamEnum).values"
      :disabled="disabled"
      @change="setParamValue"
    />
  </span>
  <span
    v-else-if="meta?.type === 'bool'"
    class="command-param command-param--bool"
    :class="mainClasses"
  >
    <ParamSetupBoolean
      :id="`param-${index}`"
      :ref="`param-${index}`"
      :key="`param-${index}`"
      :param-name="meta?.param"
      :value="value ?? meta?.default ?? true"
      :label="translatedProperty(meta?.name)"
      :disabled="disabled"
      @change="setParamValue"
    />
  </span>
  <span
    v-else-if="meta?.type === 'regex'"
    class="command-param command-param--regex"
    :class="mainClasses"
  >
    <ParamSetupRegex
      :id="`param-${index}`"
      :ref="`param-${index}`"
      :key="`param-${index}`"
      :param-name="meta?.param"
      :regex="meta?.regex"
      :label="translatedProperty(meta?.name)"
      :value="value ?? meta?.default ?? ''"
      :disabled="disabled"
      :entity-id="commandEntity?.entity_id ?? ''"
      @change="setParamValue"
      @set-media="setMedia"
    />
  </span>
</template>
