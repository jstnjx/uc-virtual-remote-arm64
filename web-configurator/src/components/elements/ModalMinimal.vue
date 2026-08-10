<script setup lang="ts">
import { ref, watch } from "vue";
import { useTiming } from "@/composables/timing";
import { isTouchEnabled } from "@/composables/device";
import { useModalRegistration } from "@/composables/modal";
import { hideMessage } from "@/stores/messages";

const { sleep } = useTiming();

const emit = defineEmits(["close", "submit"]);

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: false,
  },
  show: {
    type: Boolean,
    default: false,
  },
  closeable: {
    type: Boolean,
    default: true,
  },
});

const modal = ref<HTMLDivElement | null>(null);

useModalRegistration({
  id: () => props.name,
  isOpen: () => props.show,
  onDismiss: triggerClose,
  disableClose: () => !props.closeable,
});

watch(props, async () => {
  if (props.show) {
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

function triggerClose() {
  if (!props.closeable) {
    return;
  }
  hideMessage();
  emit("close");
}

function triggerSubmit() {
  emit("submit");
}
</script>
<template>
  <Transition name="opacity-fast">
    <div
      v-if="show"
      ref="modal"
      class="modal-minimal"
      @keyup.enter.stop="triggerSubmit"
    >
      <div class="modal-minimal__background" @click="triggerClose"></div>
      <div class="modal-minimal__container">
        <span v-if="title" class="modal-minimal__title">
          {{ title }}
        </span>
        <div class="modal-minimal__body">
          <slot />
        </div>
        <div v-if="!!$slots.footer" class="modal-minimal__footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Transition>
</template>
