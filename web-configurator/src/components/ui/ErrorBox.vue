<script setup lang="ts">
import { computed, type PropType } from "vue";

const props = defineProps({
  message: {
    type: [String, Object] as PropType<string | Record<string, any>>,
    required: true,
  },
  left: {
    type: Boolean,
    default: false,
  },
  marginTop: {
    type: Boolean,
    default: false,
  },
  marginBottom: {
    type: Boolean,
    default: false,
  },
  borderTop: {
    type: Boolean,
    default: false,
  },
  widthFlex: {
    type: Boolean,
    default: false,
  },
});

const mainClasses = computed(() => {
  let classList = "";

  classList += props.left ? `error-box--left ` : "";
  classList += props.marginTop ? `error-box--mt ` : "";
  classList += props.marginBottom ? `error-box--mb ` : "";
  classList += props.borderTop ? `error-box--bt ` : "";
  classList += props.widthFlex ? `error-box--width-flex ` : "";
  return classList;
});
</script>
<template>
  <div class="error-box" :class="mainClasses">
    <i class="fa-light fa-exclamation"></i>
    <p v-if="typeof message === 'string'" class="error-box__text">
      {{ message }}
    </p>
    <p
      v-else-if="typeof message === 'object' && 'message' in message"
      class="error-box__text"
    >
      {{ message.message }}
    </p>
  </div>
</template>
