<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    min?: number;
    max?: number;
  }>(),
  {
    min: 0,
    max: 99999999,
  },
);

const model = defineModel<number>({ required: true });
const emit = defineEmits<{
  change: [value: number];
}>();

function makeMinus() {
  const newValue = model.value - 1;
  if (newValue >= props.min) {
    onChange(newValue);
  }
}

function makePlus() {
  const newValue = model.value + 1;
  if (newValue <= props.max) {
    onChange(newValue);
  }
}

function onChange(newValue: number) {
  emit("change", newValue);
}
</script>
<template>
  <div class="form-item form-item--stepper">
    <div class="form-item--stepper__body">
      <button
        :disabled="model <= min"
        class="button button--tertiary"
        @click="makeMinus"
      >
        <i class="fa-light fa-minus"></i>
      </button>
      <span class="form-item--stepper__value">
        {{ model }}
      </span>
      <!-- <input
          type="number"
          v-model="inputValue"
          :min="min"
          :max="max"
          :id="`stepper-${instanceId}`"
          @change="onChange"
          @keyup.enter="onChange"
        /> -->
      <button
        :disabled="model >= max"
        class="button button--tertiary"
        @click="makePlus"
      >
        <i class="fa-light fa-plus"></i>
      </button>
    </div>
  </div>
</template>
