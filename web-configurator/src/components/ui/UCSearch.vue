<script setup lang="ts">
import { ref, computed, watch, getCurrentInstance, onMounted } from "vue";

import { useTiming } from "@/composables/timing";
import { isTouchEnabled } from "@/composables/device";

const { debounce } = useTiming();

const props = withDefaults(
  defineProps<{
    debouncing?: boolean;
    focus?: boolean;
    small?: boolean;
    fullW?: boolean;
    hasSibling?: boolean;
    transparent?: boolean;
    gray?: boolean;
    placeholder?: string;
  }>(),
  {
    debouncing: false,
    focus: true,
    small: false,
    fullW: false,
    hasSibling: false,
    transparent: false,
    gray: false,
    placeholder: "",
  },
);

const model = defineModel<string>({ required: true });
const emit = defineEmits<{
  focus: [];
  blur: [];
}>();

const instanceId =
  getCurrentInstance()?.uid ||
  Math.floor(Math.random() * (99999 - 10000 + 1)) + 10000; // with fallback
const inputValue = ref(model.value);

watch(model, () => {
  if (model.value != inputValue.value) {
    inputValue.value = model.value;
  } else if (props.focus) {
    focusSearch();
  }
});

const mainClasses = computed(() => {
  let classList = "";
  classList += props.fullW ? "form-item--full-w " : "";
  classList += props.small ? "form-item--search--small " : "";
  classList += props.hasSibling ? "form-item--search--has-sibling " : "";
  classList += props.gray ? "form-item--search--gray " : "";
  return classList;
});

function onChange() {
  if (props.debouncing) {
    debouncedEmit();
  } else {
    model.value = inputValue.value;
  }
}

function onFocus() {
  emit("focus");
}

function onBlur() {
  emit("blur");
}

const debouncedEmit = debounce(function () {
  model.value = inputValue.value;
}, 300);

function focusSearch() {
  if (!props.focus) {
    return false;
  }

  const searchField = document.getElementById(`search-${instanceId}`);
  if (!isTouchEnabled() && searchField) {
    setTimeout(() => {
      searchField.focus();
    }, 10);
  }
}

onMounted(() => {
  if (props.focus) {
    focusSearch();
  }
});
</script>
<template>
  <div class="form-item form-item--search" :class="mainClasses">
    <input
      :id="`search-${instanceId}`"
      v-model="inputValue"
      type="search"
      :placeholder="placeholder || $t('ui.search')"
      @input="onChange"
      @focus="onFocus"
      @blur="onBlur"
    />
    <i class="fa-light fa-search form-item--search__icon-search" />
  </div>
</template>
