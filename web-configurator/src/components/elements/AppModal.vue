<script setup lang="ts">
import { ref, watch, onMounted } from "vue";

import { useTiming } from "@/composables/timing";
import { isTouchEnabled } from "@/composables/device";
import { useModalRegistration } from "@/composables/modal";

import { hideMessage } from "@/stores/messages";

const { sleep } = useTiming();

const emit = defineEmits(["close", "closing", "submit"]);

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  show: {
    type: Boolean,
    default: false,
  },
  bodyCover: {
    type: Boolean,
    default: true,
  },
  closeable: {
    type: Boolean,
    default: true,
  },
  buttonBack: {
    type: Boolean,
    default: false,
  },
  width: {
    type: String,
    default: "100%",
  },
  height: {
    type: String,
    default: "100%",
  },
  cols: {
    type: Boolean,
    default: false,
  },
});

const modal = ref<HTMLDivElement | null>(null);

// For animation
const showModal = ref(false);

useModalRegistration({
  id: () => props.name,
  isOpen: () => props.show,
  onDismiss: triggerClose,
  disableClose: () => !props.closeable,
});

watch(props, async () => {
  if (props.show) {
    showModal.value = true;

    if (!isTouchEnabled()) {
      await sleep(200);
      const focusElement = modal.value as HTMLDivElement;
      let input;
      if (focusElement) {
        input = focusElement.querySelector("input, textarea") as HTMLDivElement;
        if (input?.closest("[data-nofocus]")) {
          return;
        }
      }
      (input ? input : focusElement)?.focus();
    }
  }
});

async function triggerClose() {
  if (!props.closeable) {
    return;
  }
  emit("closing");

  showModal.value = false;
  await sleep(800);
  hideMessage();
  emit("close");
}

function triggerSubmit() {
  emit("submit");
}

function getCloseButtonClasses(device: string) {
  return props.buttonBack
    ? ` modal__back modal__back--${device}`
    : ` modal__close modal__close--${device}`;
}

onMounted(async () => {
  showModal.value = props.show;
});
</script>
<template>
  <Transition name="opacity-fast">
    <div
      v-if="show"
      v-show="showModal"
      ref="modal"
      class="modal"
      @keyup.enter.stop="triggerSubmit"
    >
      <div class="modal__wrapper">
        <div>
          <button
            class="button button--tertiary button--icon"
            :class="getCloseButtonClasses('desktop')"
            @click="triggerClose"
          >
            <i
              class="fa-regular"
              :class="buttonBack ? 'fa-arrow-left' : 'fa-close'"
            ></i>
          </button>
          <button
            class="button button--secondary button--icon button--icon--small"
            :class="getCloseButtonClasses('phone')"
            @click="triggerClose"
          >
            <i
              class="fa-regular"
              :class="buttonBack ? 'fa-arrow-left' : 'fa-close'"
            ></i>
          </button>
        </div>
        <div
          class="modal__container"
          :style="`max-width:${props.width};height:${props.height};`"
        >
          <div
            v-if="!!$slots.header"
            class="modal__header"
            :class="{ 'modal__header--back-button': buttonBack }"
          >
            <slot name="header" />
          </div>

          <div
            v-if="bodyCover"
            class="modal__body"
            :class="{ 'modal__body--cols': cols == true }"
          >
            <slot />
          </div>
          <slot v-if="!bodyCover" />
          <div v-if="!!$slots.footer" class="modal__footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
