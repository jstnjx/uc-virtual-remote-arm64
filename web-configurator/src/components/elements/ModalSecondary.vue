<script setup lang="ts">
import { ref, watch, computed, onMounted } from "vue";
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
  focusableInput: {
    type: Boolean,
    default: true,
  },
  buttonClose: {
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
    default: "auto",
  },
  top: {
    type: String,
    default: "",
  },
  left: {
    type: String,
    default: "",
  },
  saving: {
    type: Boolean,
    default: false,
  },
  slide: {
    type: Boolean,
    default: false,
  },
});

const modal = ref<HTMLDivElement | null>(null);

// For animation
const showModal = ref(false);

defineExpose({
  triggerClose,
});

useModalRegistration({
  id: () => props.name,
  isOpen: () => props.show,
  onDismiss: triggerClose,
  disableClose: () => !props.closeable,
});

watch(props, async () => {
  if (props.show) {
    await sleep(30);
    showModal.value = true;

    if (!isTouchEnabled()) {
      await sleep(100);
      const focusElement = modal.value as HTMLDivElement;
      let input;
      if (focusElement && props.focusableInput) {
        input = focusElement.querySelector("input, textarea") as HTMLDivElement;
        if (input?.closest("[data-nofocus]")) {
          return;
        }
      }
      (input ? input : focusElement)?.focus();
    }
  } else {
    await sleep(100);
    showModal.value = false;
  }
});

const containerStyle = computed(() => {
  let styleList = "";
  styleList += `width:${props.width};height:${props.height};`;
  styleList += props.height != "auto" ? `min-height:${props.height};` : "";

  if (props.top.length > 0 && props.left.length > 0) {
    styleList += `position:fixed;top:${props.top};left:${props.left};`;
  }

  return styleList;
});

const containerTransition = computed(() => {
  if (props.slide) {
    return "slide-from-bottom";
  }

  return "opacity-fast";
});

async function triggerClose() {
  if (!props.closeable) {
    return;
  }

  showModal.value = false;
  await sleep(500);
  hideMessage();
  emit("close");
}

function triggerSubmit() {
  emit("submit");
}

onMounted(() => {
  showModal.value = props.show;
});
</script>
<template>
  <div
    v-if="show || showModal"
    ref="modal"
    class="modal-secondary"
    :class="{ 'modal-secondary--saving': saving }"
    @keyup.enter.stop="triggerSubmit"
  >
    <Transition name="opacity">
      <div v-show="show && showModal" class="modal-secondary__background"></div>
    </Transition>
    <Transition :name="containerTransition">
      <div
        v-show="show && showModal"
        class="modal-secondary__container"
        :style="containerStyle"
      >
        <div v-if="!!$slots.header" class="modal-secondary__header">
          <slot name="header" />
          <Transition name="opacity-fast">
            <button
              v-show="buttonClose && !saving"
              class="button button--secondary button--icon button--icon--small button-close"
              @click="triggerClose"
            >
              <i class="fa-regular fa-close"></i>
            </button>
          </Transition>
          <Transition name="opacity-fast">
            <div v-show="saving" class="modal-secondary__loader">
              <img
                src="/images/loading-indicator.png"
                alt="Loading"
                class="img-loading"
              />
            </div>
          </Transition>
        </div>

        <div v-if="bodyCover" class="modal-secondary__body">
          <slot />
        </div>
        <slot v-if="!bodyCover" />

        <div v-if="!!$slots.footer" class="modal-secondary__footer">
          <slot name="footer" />
        </div>
      </div>
    </Transition>
  </div>
</template>
