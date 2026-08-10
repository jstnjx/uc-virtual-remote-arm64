<script setup lang="ts">
import { ref, watch, onMounted, reactive } from "vue";

import type { ColorPickerValue } from "@/types/ui";

import { useTiming } from "@/composables/timing";

import ModalSecondary from "@/components/elements/ModalSecondary.vue";

const { sleep, debounce } = useTiming();

const props = defineProps({
  title: {
    type: String,
    default: "",
  },
  rgb: {
    type: Array,
    default: () => [],
  },
  hs: {
    type: Array,
    default: () => [],
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["change"]);

const WIDTH = 220;
const HEIGHT = 220;
const SCALE = 1.07;
const MIDDLE_X = WIDTH / 2;
const MIDDLE_Y = HEIGHT / 2;

let ctx: CanvasRenderingContext2D | null = null;
const canvas = ref<HTMLCanvasElement | null>(null);
const colorCircle = ref<HTMLDivElement | null>(null);
const selectedColor = ref<string>("hsl(0, 0%, 100%)");
const selectedPosition = reactive({ x: MIDDLE_X - 15, y: MIDDLE_Y - 15 });
const colorDetails = reactive({
  h: 0,
  s: 0,
  l: 0,
});
let dragging = false;

const colorPicker = ref<HTMLButtonElement | null>(null);
const colorPickerTrigger = ref<HTMLButtonElement | null>(null);
const colorPickerModal = ref<HTMLButtonElement | null>(null);
const showColorPickerModal = ref<boolean>(false);
const colorPickerModalLeft = ref<number>(0);
const colorPickerModalTop = ref<number>(0);

watch(props, () => {
  setColors();
});

watch(showColorPickerModal, async (val) => {
  if (val) {
    setModalPosition();
    await sleep(10);
    setCanvas();
  }
});

const debouncedEmit = debounce(function () {
  emitColorChange();
}, 500);

function emitColorChange() {
  const rgb = hslToRgb(colorDetails.h, colorDetails.s, colorDetails.l);
  const message = {
    hsl: [colorDetails.h, colorDetails.s, colorDetails.l],
    rgb: [rgb.r, rgb.g, rgb.b],
  } as ColorPickerValue;
  emit("change", message);
}

function setColors() {
  if (props.rgb.length === 3) {
    const hsl = rgbToHsl(
      props.rgb[0] as number,
      props.rgb[1] as number,
      props.rgb[2] as number,
    );
    updateColorDetails({ h: hsl.h, s: hsl.s, l: hsl.l }, true);
  } else if (props.hs.length === 2) {
    updateColorDetails(
      { h: props.hs[0] as number, s: props.hs[1] as number, l: 50 },
      true,
    );
  }
}

function rgbToHsl(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return {
    r: Math.round(255 * f(0)),
    g: Math.round(255 * f(8)),
    b: Math.round(255 * f(4)),
  };
}

async function setModalPosition() {
  if (colorPickerTrigger.value) {
    colorPickerModalLeft.value =
      colorPickerTrigger.value.getBoundingClientRect().x - 115;
    colorPickerModalTop.value =
      colorPickerTrigger.value.getBoundingClientRect().y;

    await sleep(100);
    const colorPickerModalContainer = document.querySelector(
      ".color-picker-modal .modal-secondary__container",
    );
    if (colorPickerModalContainer) {
      const containerRightPosition =
        colorPickerModalContainer.getBoundingClientRect().right;
      const containerBottomPosition =
        colorPickerModalContainer.getBoundingClientRect().bottom;

      if (window.innerWidth < containerRightPosition) {
        colorPickerModalLeft.value =
          colorPickerModalLeft.value -
          (containerRightPosition - window.innerWidth) -
          10;
      }

      if (window.innerHeight < containerBottomPosition) {
        colorPickerModalTop.value =
          colorPickerModalTop.value -
          (containerBottomPosition - window.innerHeight) -
          10;
      }
    }
  }
}

function setCanvas() {
  if (canvas.value) {
    ctx = canvas.value.getContext("2d");
    if (ctx) drawColorWheel();
  }
}

function degreeToRadian(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radianToDegree(rad: number): number {
  return (rad * 180) / Math.PI;
}

function getDistanceFromCenter(x: number, y: number): number {
  const offsetX = Math.abs(MIDDLE_X - x);
  const offsetY = Math.abs(MIDDLE_Y - y);
  return Math.sqrt(Math.pow(offsetX, 2) + Math.pow(offsetY, 2));
}

function getColorForPoint(
  x: number,
  y: number,
): { h: number; s: number; l: number } {
  const dist = getDistanceFromCenter(x, y);

  if (dist > 100 * SCALE) return { h: 0, s: 0, l: 1 };

  const s = dist / SCALE;
  let h = radianToDegree(Math.acos((x - MIDDLE_X) / s / SCALE));
  if (y > MIDDLE_Y) h = 360 - h;
  const l = (1 - s / 100) * 0.5 + 0.5;
  return { h, s: s, l: props.hs.length === 2 ? 50 : l * 100 };
}

function getPointForColor(
  h: number,
  s: number,
  _l: number,
): { x: number; y: number } {
  const maxS = 100 * SCALE;
  const dist = s * SCALE;

  if (dist > maxS) return { x: MIDDLE_X, y: MIDDLE_Y };

  const angle = h * (Math.PI / 180);
  const x = MIDDLE_X + dist * Math.cos(angle);
  const y = MIDDLE_Y - dist * Math.sin(angle);

  return { x, y };
}

function drawColorWheel() {
  if (!ctx) return;

  for (let h = 0; h <= 360; h++) {
    for (let s = 0; s <= 100; s++) {
      ctx.beginPath();
      const lightness = props.hs.length === 2 ? 0.5 : (1 - s / 100) * 0.5 + 0.5;
      ctx.fillStyle = `hsl(${h}, ${s}%, ${lightness * 100}%)`;
      const posX = MIDDLE_X + Math.cos(degreeToRadian(h)) * s * SCALE;
      const posY = MIDDLE_Y - Math.sin(degreeToRadian(h)) * s * SCALE;
      ctx.arc(posX, posY, (SCALE * s) / 100 + 1.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}

function startDrag(event: MouseEvent) {
  dragging = true;
  updateColor(event);
}

function drag(event: MouseEvent) {
  if (dragging) {
    updateColor(event);
  }
}

function endDrag() {
  dragging = false;
}

function updateColor(event: MouseEvent) {
  if (!canvas.value) return;
  const rect = canvas.value.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const color = getColorForPoint(x, y);
  if (color.s > 0) {
    updateColorDetails(color);
    selectedPosition.x = x - 15;
    selectedPosition.y = y - 15;
  }
}

function updateColorDetails(
  color: { h: number; s: number; l: number },
  onInit = false,
) {
  colorDetails.h = Math.floor(color.h);
  colorDetails.s = Math.floor(color.s);
  colorDetails.l = Math.floor(color.l);
  selectedColor.value = `hsl(${color.h}, ${color.s}%, ${color.l}%)`;

  if (onInit) {
    const points = getPointForColor(color.h, color.s, color.l);
    selectedPosition.x = points.x - 15;
    selectedPosition.y = points.y - 15;
  } else {
    debouncedEmit();
  }
}

onMounted(() => {
  setColors();
});
</script>

<template>
  <div ref="colorPicker" class="color-picker">
    <button
      ref="colorPickerTrigger"
      :style="{ backgroundColor: selectedColor }"
      :disabled="disabled"
      class="button color-picker__trigger"
      @click="showColorPickerModal = true"
    ></button>

    <Teleport to="body">
      <ModalSecondary
        ref="colorPickerModal"
        :show="showColorPickerModal"
        :width="'16.25rem'"
        :height="'fit-content;'"
        :top="`${colorPickerModalTop}px`"
        :left="`${colorPickerModalLeft}px`"
        :name="'color-picker-modal'"
        class="color-picker-modal"
        @close="showColorPickerModal = false"
      >
        <template #header>
          <template v-if="title">{{ title }}</template>
          <template v-else>{{ $t("ui.select_color") }}</template>
        </template>
        <canvas
          ref="canvas"
          :width="WIDTH"
          :height="HEIGHT"
          @mousedown="startDrag"
          @mousemove="drag"
          @mouseup="endDrag"
          @mouseleave="endDrag"
        >
        </canvas>
        <div
          ref="colorCircle"
          class="color-picker__selector"
          :style="{
            backgroundColor: selectedColor,
            top: selectedPosition.y + 'px',
            left: selectedPosition.x + 'px',
          }"
        ></div>
        <!-- <div>
          <p>{{ colorDetails.h }}°</p>
          <p>{{ colorDetails.s }}%</p>
        </div> -->
      </ModalSecondary>
    </Teleport>
  </div>
</template>
