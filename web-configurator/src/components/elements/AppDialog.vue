<script setup lang="ts">
import { ref, computed, getCurrentInstance } from "vue";

import { useModalToggle } from "@/composables/modal";

import VueMarkdown from "vue-markdown-render";

defineExpose({
  open,
  close,
  isActive,
});
const emit = defineEmits(["submit", "close"]);

const props = defineProps({
  information: {
    type: Boolean,
    default: false,
  },
  icon: {
    type: String,
    default: null,
  },
  iconType: {
    type: String,
    default: null,
  },
  title: {
    type: String,
    required: false,
  },
  text: {
    type: String,
    required: true,
  },
  submitText: {
    type: String,
    default: null,
  },
  cancelText: {
    type: String,
    default: null,
  },
  class: {
    type: String,
    default: "",
  },
  disableCloseOnSubmit: {
    type: Boolean,
    default: false,
  },
  disableButtons: {
    type: Boolean,
    default: false,
  },
  textCenter: {
    type: Boolean,
    default: false,
  },
  submitCallback: {
    type: Function,
    default: () => void 0,
  },
  warning: {
    type: Boolean,
    default: false,
  },
  markdown: {
    type: Boolean,
    default: false,
  },
  closeable: {
    type: Boolean,
    default: true,
  },
});

const instanceUid =
  getCurrentInstance()?.uid || Math.floor(Math.random() * 1000);
const showDialog = ref(false);

useModalToggle(showDialog, {
  id: instanceUid,
  disableClose: () => !props.closeable,
});

const mainClasses = computed(() => {
  let classList = "";

  classList += props.class ? `${props.class} ` : "";
  classList += props.textCenter ? `dialog--center ` : "";
  classList += props.warning ? `dialog--warning ` : "";
  return classList;
});

const iconClasses = computed(() => {
  let classList = "";
  if (props.icon == null) {
    return "";
  }

  classList += props.icon;
  classList +=
    props.iconType != null ? ` dialog__icon--${props.iconType} ` : "";

  return classList;
});

function open() {
  showDialog.value = true;
}

function close() {
  showDialog.value = false;
  emit("close");
}

function isActive() {
  return showDialog.value;
}

async function submit() {
  emit("submit");

  if (props.disableCloseOnSubmit == false) {
    showDialog.value = false;
  }
}
</script>
<template>
  <Teleport v-if="showDialog" to="body">
    <Transition name="opacity-fast">
      <div v-show="showDialog" ref="dialog" class="dialog" :class="mainClasses">
        <div class="dialog__container">
          <i v-if="icon" class="dialog__icon" :class="iconClasses"></i>
          <h1 class="dialog__title">
            {{ title }}
          </h1>
          <p class="dialog__text">
            <vue-markdown v-if="markdown" :source="text" class="vue-markdown" />
            <template v-else>{{ text }}</template>
          </p>
          <template v-if="!!$slots.extra">
            <div class="dialog__extra">
              <slot name="extra" />
            </div>
          </template>
          <div class="dialog__triggers">
            <button
              v-if="cancelText != null"
              :disabled="disableButtons"
              class="button button--tertiary"
              :class="{ 'button--danger': warning }"
              @click="close"
            >
              {{ cancelText }}
            </button>
            <button
              :disabled="disableButtons"
              class="button button--secondary"
              :class="{ 'button--delete': warning }"
              @click="submit"
            >
              {{ submitText || $t("ui.ok") }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
