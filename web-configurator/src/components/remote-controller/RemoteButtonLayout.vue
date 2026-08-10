<script setup lang="ts">
import { ref, computed } from "vue";
import { asyncComputed } from "@vueuse/core";

import type { DeviceButton, TouchSlider } from "@/types/activity";

import { configStore } from "@/stores/config";
import { addErrorBottom } from "@/stores/messages";
import { appStateStore } from "@/stores/appState";

import translatedProperty from "@/composables/translatedProperty";
import { useRemoteProperties } from "@/composables/remote/properties";

const { getTouchSliderProps } = useRemoteProperties();

const config = configStore();
const appState = appStateStore();

const props = defineProps({
  button: {
    type: Object,
    default: () => ({}),
  },
});

const touchSlider = ref<TouchSlider>(getTouchSliderProps());

const isModelSecond = asyncComputed(async () => {
  let model = "";
  try {
    model = await config.getDeviceModel();
  } catch (e) {
    addErrorBottom(e);
  }
  return model?.toLowerCase() == "ucr2";
});

const buttons = computed(() => {
  return config.$state.list.buttonLayout[0]?.buttons || [];
});

function itemClass(b: DeviceButton | TouchSlider) {
  let classList = `remote-button-layout__item--${b.button
    .replace("_", "-")
    .toLowerCase()}`;
  if (b && b.button === props.button.button) {
    classList += " remote-button-layout__item--show";
  }

  return classList;
}

function startEdit(b: DeviceButton | TouchSlider) {
  appState.setEditButton(b);
}
</script>
<template>
  <div
    class="remote-button-layout"
    :class="{ 'remote-button-layout--v2': isModelSecond }"
  >
    <template v-for="button in buttons" :key="button.button">
      <div
        class="remote-button-layout__item"
        :class="itemClass(button)"
        @click="startEdit(button)"
      >
        <div class="remote-button-layout__item__label">
          <template v-if="button.name">{{
            translatedProperty(button.name)
          }}</template>
        </div>
      </div>
    </template>
    <div
      class="remote-button-layout__item"
      :class="itemClass(touchSlider)"
      @click="startEdit(touchSlider)"
    >
      <div class="remote-button-layout__item__label">
        <template v-if="touchSlider.name">{{
          translatedProperty(touchSlider.name)
        }}</template>
      </div>
    </div>
  </div>
</template>
