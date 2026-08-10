<script setup lang="ts">
import { ref, computed, watch, getCurrentInstance, onMounted } from "vue";
import type { TranslatableValue } from "@/types/ui";

import LanguageDropdown from "@/components/elements/LanguageDropdown.vue";

const props = withDefaults(
  defineProps<{
    translations?: object;
    type?: string;
    label?: string;
    disabled?: boolean;
    unit?: string;
    description?: string;
    errorMessage?: string;
    invalid?: boolean;
    hasLang?: boolean;
    compact?: boolean;
    fullW?: boolean;
    submitButton?: boolean;
    dark?: boolean;
    focus?: boolean;
    selectOnFocus?: boolean;
    numberMin?: number;
    numberMax?: number;
    disableBlur?: boolean;
  }>(),
  {
    translations: () => ({}),
    type: "text",
    label: "",
    disabled: false,
    unit: "",
    description: "",
    errorMessage: "",
    invalid: false,
    hasLang: false,
    compact: false,
    fullW: false,
    submitButton: false,
    dark: false,
    focus: false,
    selectOnFocus: false,
    disableBlur: false,
  },
);

const model = defineModel<string | number | TranslatableValue>({
  required: true,
});

const instanceId =
  getCurrentInstance()?.uid ||
  Math.floor(Math.random() * (99999 - 10000 + 1)) + 10000; // with fallback
const emit = defineEmits<{
  changeLang: [code: string];
  submit: [value: string | number | TranslatableValue];
  click: [];
  onEsc: [];
}>();
const inputValue = ref(
  props.hasLang ? (model.value as TranslatableValue).value : model.value,
);
const langCode = ref(
  props.hasLang ? (model.value as TranslatableValue).langCode : "en",
);
const submitted = ref(true);

watch(
  [() => model.value],
  () => {
    if (
      props.hasLang &&
      (model.value as TranslatableValue).value != inputValue.value
    ) {
      inputValue.value = (model.value as TranslatableValue).value;
      langCode.value = (model.value as TranslatableValue).langCode;
    } else if (props.hasLang == false && model.value != inputValue.value) {
      inputValue.value = model.value;
    }
  },
  { deep: props.hasLang },
);

const mainClasses = computed(() => {
  let classList = "";
  classList += props.errorMessage || props.invalid ? "form-item--error " : "";
  classList += props.disabled ? "form-item--disabled " : "";
  classList += props.submitButton ? "form-item--has-submit " : "";
  classList += props.hasLang ? "form-item--has-lang " : "";
  classList += props.dark ? "form-item--dark " : "";
  classList += props.fullW ? "form-item--full-w " : "";
  classList +=
    !props.label || props.label.length < 1
      ? "form-item--textfield--no-label"
      : "";
  classList += props.compact ? "form-item--textfield--compact " : "";
  classList +=
    props.type == "textarea" ? "form-item--textfield--textarea " : "";
  return classList;
});

function onInput() {
  submitted.value = false;
  if (props.hasLang) {
    model.value = {
      value: inputValue.value,
      langCode: langCode.value,
    };
  } else {
    if (
      props.numberMin &&
      inputValue.value.length > 0 &&
      inputValue.value < props.numberMin
    ) {
      inputValue.value = props.numberMin;
    } else if (props.numberMax && inputValue.value > props.numberMax) {
      inputValue.value = props.numberMax;
    }
    model.value = inputValue.value;
  }
}

function onBlur() {
  if (props.disableBlur || submitted.value) {
    return;
  }
  submit();
}

function setLanguage(code: string) {
  langCode.value = code;
  emit("changeLang", code);
}

function deleteText(code: string) {
  model.value = { value: "", langCode: code };
  emit("submit", { value: "", langCode: code });
}

function submit() {
  if (props.hasLang) {
    emit("submit", { value: inputValue.value, langCode: langCode.value });
  } else {
    emit("submit", inputValue.value);
  }
  submitted.value = true;
}

function clickInput() {
  emit("click");
}

function onEscape() {
  emit("onEsc");
}

onMounted(() => {
  if (props.focus) {
    const textField = document.getElementById(`textfield-${instanceId}`);
    if (textField) {
      textField.focus();
      if (
        props.selectOnFocus &&
        (textField instanceof HTMLInputElement ||
          textField instanceof HTMLTextAreaElement)
      ) {
        textField.select();
      }
    }
  }
});
</script>
<template>
  <div class="form-item form-item--textfield" :class="mainClasses">
    <textarea
      v-if="props.type == 'textarea'"
      :id="`textfield-${instanceId}`"
      v-model="inputValue"
      :type="props.type"
      placeholder=" "
      :disabled="disabled"
      rows="3"
      @input="onInput"
      @blur="onBlur"
      @keyup.enter="submit"
      @keyup.esc="onEscape"
      @click.stop="clickInput"
    ></textarea>
    <input
      v-else
      :id="`textfield-${instanceId}`"
      v-model="inputValue"
      :value="inputValue"
      :type="props.type"
      :disabled="disabled"
      :data-nofocus="!focus"
      placeholder=" "
      @input="onInput"
      @blur="onBlur"
      @keyup.enter="submit"
      @keyup.esc="onEscape"
      @click.stop="clickInput"
    />
    <label :for="`textfield-${instanceId}`">{{ props.label }}</label>
    <span
      v-if="unit && unit.length > 0"
      :style="`left: ${16 + inputValue.toString().length * 10}px`"
      class="form-item--textfield__unit"
    >
      {{ props.unit }}
    </span>
    <div v-if="hasLang" class="form-item__lang">
      <LanguageDropdown
        :lang-code="langCode"
        :translations="translations"
        @set-lang="setLanguage"
        @delete-text="deleteText"
      />
    </div>
    <button
      v-if="submitButton"
      class="button button--secondary button--icon button--icon--medium form-item__submit"
      @click.stop="submit"
    >
      <i class="fa-regular fa-arrow-right"></i>
    </button>
    <p v-if="props.description" class="form-item__description">
      {{ props.description }}
    </p>
    <span v-show="props.errorMessage" class="form-item__error">{{
      props.errorMessage
    }}</span>
  </div>
</template>
