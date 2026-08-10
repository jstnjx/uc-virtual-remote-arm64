<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from "vue";

import { isTouchEnabled } from "@/composables/device";
import { useModalToggle } from "@/composables/modal";

const isOpen = ref(false);

// Registered however it was opened — hover, focus or click. A hover-opened
// popover unregisters as soon as the pointer leaves, and ESC dismissing the
// popover rather than a dialog underneath is the correct topmost-first order.
useModalToggle(isOpen, { lockScroll: false });
const triggerEl = ref<HTMLElement | null>(null);
const contentEl = ref<HTMLElement | null>(null);
const overlayEl = ref<HTMLElement | null>(null);

const position = ref({
  top: 0,
  left: 0,
  width: 0,
});

const open = async () => {
  isOpen.value = true;
  await nextTick();
  updatePosition();
};

const close = () => {
  isOpen.value = false;
};

const updatePosition = () => {
  if (!triggerEl.value || !contentEl.value) return;

  const triggerRect = triggerEl.value.getBoundingClientRect();
  const content = contentEl.value;

  const maxWidth = window.innerWidth < 420 ? window.innerWidth - 12 : 420;
  content.style.maxWidth = maxWidth + "px";

  const contentRect = content.getBoundingClientRect();
  const left = triggerRect.left + triggerRect.width / 2 - contentRect.width / 2;
  const top = triggerRect.top - contentRect.height + 30;

  position.value = {
    top,
    left: Math.max(
      6,
      Math.min(left, window.innerWidth - contentRect.width - 6),
    ),
    width: maxWidth,
  };
};

const handleMouseEnter = () => {
  if (!isTouchEnabled()) open();
};
const handleMouseLeave = (e: MouseEvent) => {
  if (isTouchEnabled()) return;
  if (!contentEl.value) return;

  const related = e.relatedTarget as HTMLElement | null;
  if (contentEl.value?.contains(related)) return;
  close();
};

const handleClick = () => {
  if (isTouchEnabled()) {
    isOpen.value ? close() : open();
  }
};

const handleGlobalMouseMove = (e: MouseEvent) => {
  if (!isOpen.value) return;
  if (!triggerEl.value || !contentEl.value) return;

  const target = e.target as HTMLElement;

  const insideTrigger = triggerEl.value.contains(target);
  const insideContent = contentEl.value.contains(target);

  if (!insideTrigger && !insideContent) {
    close();
  }
};

onMounted(() => {
  window.addEventListener("mousemove", handleGlobalMouseMove);
  window.addEventListener("scroll", updatePosition, true);
  window.addEventListener("resize", updatePosition);
});

onBeforeUnmount(() => {
  window.addEventListener("mousemove", handleGlobalMouseMove);
  window.removeEventListener("scroll", updatePosition, true);
  window.removeEventListener("resize", updatePosition);
});
</script>

<template>
  <div class="info-popup">
    <div
      ref="triggerEl"
      class="info-popup__trigger"
      tabindex="0"
      @mouseenter="handleMouseEnter"
      @mouseleave="handleMouseLeave"
      @focus="open"
      @click.stop="handleClick"
    >
      <i class="fa-solid fa-info"></i>
    </div>

    <Teleport to="body">
      <div
        v-if="isOpen"
        ref="overlayEl"
        class="info-popup__overlay"
        @click="close"
        @focus="close"
      ></div>

      <div
        v-if="isOpen"
        ref="contentEl"
        class="info-popup__content"
        :class="{ 'info-popup__content--active': isOpen }"
        :style="{
          top: position.top + 'px',
          left: position.left + 'px',
          maxWidth: position.width + 'px',
        }"
        tabindex="0"
      >
        <slot />
      </div>
    </Teleport>
  </div>
</template>
