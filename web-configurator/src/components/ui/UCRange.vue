<script setup lang="ts">
import { computed } from "vue";
import { SettingTypes, CfgGroups } from "@/types/enums";
import type { ChangeCallbackParams } from "@/types/config";

interface RangeSettings {
  min?: number;
  max?: number;
  step?: number;
  showValue?: boolean;
  showLimits?: boolean;
  valueFormatter?: ((value: number) => string) | null;
}

interface RangeDefinition {
  label?: string;
  type?: string;
  group?: CfgGroups;
  settings?: RangeSettings;
}

const props = withDefaults(
  defineProps<{
    name: string;
    definition: RangeDefinition;
    defaultValue?: number;
    points?: number[];
    pointsLabel?: string[];
    description?: string;
    settings?: boolean;
    compact?: boolean;
  }>(),
  {
    defaultValue: 0,
    points: () => [],
    pointsLabel: () => [],
    description: "",
    settings: false,
    compact: false,
  },
);

const emit = defineEmits<{
  change: [params: ChangeCallbackParams];
}>();

const model = defineModel<number>({ default: 0 });

const mainClasses = computed(() => {
  let classList = "";
  classList += props.settings ? "form-item--range--settings " : "";
  classList += props.compact ? "form-item--range--compact " : "";
  return classList;
});

const pointsPositons = computed(() => {
  if (!props.points) {
    return null;
  }

  const multiplier =
    100 /
    (definitionSettings.value.max as number) /
    (definitionSettings.value.step || 1);
  return props.points.map((number) => {
    return Math.ceil((number as number) * multiplier);
  });
});

function onChange(ev: Event) {
  if (ev.target instanceof HTMLInputElement) {
    let newValue = parseInt(ev.target.value);

    if (props.points.length > 0) {
      newValue = props.points.reduce((a, b) => {
        return Math.abs((b as number) - newValue) <
          Math.abs((a as number) - newValue)
          ? b
          : a;
      }) as number;
    }

    model.value = newValue;
    emit("change", {
      ev,
      group: props.definition.group,
      name: props.name,
      value: newValue,
    });
  }
}

const defaultSettings: RangeSettings = {
  // min: 10,
  // max: 100,
  showValue: true,
  valueFormatter: null,
};

const definitionSettings = computed<RangeSettings>(() => ({
  ...defaultSettings,
  ...(props.definition.settings || {}),
}));

const inputStyle = computed(() => {
  let width;
  if (props.definition.type === SettingTypes.PERCENT) {
    if (
      definitionSettings.value?.min !== undefined ||
      definitionSettings.value?.max !== undefined
    ) {
      const defMin = definitionSettings.value?.min ?? 0;
      const defMax = definitionSettings.value?.max ?? 100;

      width = ((model.value - defMin) / (defMax - defMin)) * 100 + "%";
    } else {
      width = `${model.value}%`;
    }
  } else {
    width =
      ((model.value - (definitionSettings.value.min as number)) /
        ((definitionSettings.value.max as number) -
          (definitionSettings.value.min as number))) *
        100 +
      "%";
  }
  return {
    backgroundSize: `${width} 100%`,
  };
});

const formattedMin = computed(() => {
  if (
    props.pointsLabel &&
    props.pointsLabel.length > 0 &&
    props.pointsLabel[0]
  ) {
    return props.pointsLabel[0];
  }

  if (props.definition.type === SettingTypes.SECONDS) {
    const minutes = Math.floor((definitionSettings.value.min as number) / 60);
    const remainingSeconds = (definitionSettings.value.min as number) % 60;
    if (minutes < 1) {
      return `${remainingSeconds}s`;
    } else if (remainingSeconds < 1) {
      return `${minutes}min`;
    }
    return `${minutes}min ${remainingSeconds}s`;
  }

  return "";
});

const formattedMax = computed(() => {
  if (
    props.pointsLabel &&
    props.pointsLabel.length > 0 &&
    props.pointsLabel.slice(-1)[0]
  ) {
    return props.pointsLabel.slice(-1)[0];
  }

  if (props.definition.type === SettingTypes.SECONDS) {
    const minutes = Math.floor((definitionSettings.value.max as number) / 60);
    const remainingSeconds = (definitionSettings.value.max as number) % 60;
    if (minutes < 1) {
      return `${remainingSeconds}s`;
    } else if (remainingSeconds < 1) {
      return `${minutes}min`;
    }
    return `${minutes}min ${remainingSeconds}s`;
  }

  return "";
});

const formattedValue = computed(() => {
  if (definitionSettings.value.valueFormatter instanceof Function) {
    return definitionSettings.value.valueFormatter(model.value);
  }

  if (props.definition.type === SettingTypes.PERCENT) {
    return `${model.value}%`;
  }

  if (props.definition.type === SettingTypes.SECONDS) {
    const minutes = Math.floor(model.value / 60);
    const remainingSeconds = model.value % 60;
    if (minutes < 1) {
      return `${remainingSeconds}s`;
    } else if (remainingSeconds < 1) {
      return `${minutes}m`;
    }

    return `${minutes}m ${remainingSeconds}s`;
  }

  if (props.pointsLabel && props.pointsLabel.length > 0) {
    let returnValue = props.points[0];
    let returnLabel = props.pointsLabel[0];

    for (let i = 1; i < props.points.length; i++) {
      if (
        Math.abs((props.points[i] as number) - model.value) <
        Math.abs((returnValue as number) - model.value)
      ) {
        returnValue = props.points[i];
        returnLabel = props.pointsLabel[i];
      }
    }

    return returnLabel;
  }

  return `${model.value}`;
});
</script>
<template>
  <div class="form-item form-item--range" :class="mainClasses">
    <div class="form-item--range__main">
      <div
        v-if="props.definition.label || props.compact"
        class="form-item--range__header"
      >
        <label v-if="props.definition.label">
          {{ props.definition.label }}
        </label>
        <span
          v-if="definitionSettings.showValue && compact"
          class="form-item--range__header__value"
        >
          {{ formattedValue }}
        </span>
      </div>
      <p v-if="props.description" class="form-item--range__description">
        {{ props.description }}
      </p>
      <div class="form-item--range__container">
        <div class="form-item--range__line" :style="inputStyle"></div>
        <input
          v-model.number="model"
          :min="definitionSettings.min"
          :max="definitionSettings.max"
          :data-value="model"
          class="slider"
          type="range"
          @change="onChange"
        />
        <span
          v-for="(point, index) in pointsPositons"
          v-show="model < (point as number)"
          :key="index"
          :style="{
            left:
              index === 0
                ? (point as number) + 1.5 + '%'
                : index === props.points.length - 1
                  ? (point as number) - 1.5 + '%'
                  : point + '%',
          }"
          class="range-dot"
        >
        </span>
        <div
          v-if="
            definitionSettings.showLimits &&
            ((definitionSettings.min && definitionSettings.max) || pointsLabel)
          "
          class="form-item--range__container__limits"
        >
          <span class="form-item--range__container__limit">{{
            formattedMin
          }}</span>
          <span class="form-item--range__container__limit">{{
            formattedMax
          }}</span>
        </div>
      </div>
    </div>
    <span
      v-if="definitionSettings.showValue && !compact"
      class="form-item--range__value"
    >
      {{ formattedValue }}
    </span>
  </div>
</template>
