<script setup lang="ts">
import { ref, toRef, onBeforeUpdate, onMounted } from "vue";
import { useTiming } from "@/composables/timing";

const { sleep } = useTiming();

const props = withDefaults(
  defineProps<{
    fields?: number;
    disabled?: boolean;
    required?: boolean;
    classNames?: string;
    hideCode?: boolean;
  }>(),
  {
    fields: 4,
    disabled: false,
    required: true,
    classNames: "",
    hideCode: true,
  },
);

defineExpose({
  resetValues,
});

const emit = defineEmits<{
  change: [value: string];
  complete: [value: string];
  submit: [value: string];
}>();

const KEY_CODE: Record<string, string[]> = {
  backspace: ["Backspace"],
  left: ["ArrowLeft"],
  up: ["ArrowUp"],
  right: ["ArrowRight"],
  down: ["ArrowDown"],
  enter: ["Enter", "NumpadEnter"],
};

const values = ref<string[]>([]);
const iRefs = ref<number[]>([]);
const inputs = ref<HTMLInputElement[]>(new Array(4));
const timers = ref<any[]>(new Array(4));
const fields = toRef(props, "fields");
const autoFocusIndex = ref(0);
const disabled = ref(props.disabled);
const required = ref(props.required);
const autoFocus = true;

const onFocus = (e: FocusEvent) => {
  const target: HTMLInputElement | null = e.target as HTMLInputElement | null;
  if (target) {
    target.type = "text";
    target.select();
  }
};

function hideCodeInput(i: number, timeout = 0) {
  if (props.hideCode == false) {
    return false;
  }

  const index = i + 1;
  if (!inputs.value[index]) {
    return;
  }
  clearTimeout(timers.value[index]);

  function doHide() {
    inputs.value[index].type = "password";
  }

  if (timeout) {
    timers.value[index] = setTimeout(() => {
      doHide();
    }, timeout);
  } else {
    doHide();
  }
}

const onBlur = (e: Event, i: number) => {
  const target: HTMLInputElement | null = e.target as HTMLInputElement | null;
  if (target) {
    hideCodeInput(i, 1000);
    hideCodeInput(i - 1, 0);
  }
};

const onValueChange = (e: Event) => {
  const target = e.target as HTMLInputElement;
  const index = parseInt(target.dataset?.id || "");
  target.value = target.value.replace(/[^\d]/gi, "");

  if (target.value === "" || !target.validity.valid) {
    return;
  }
  let next;
  const value = target.value;
  values.value = Object.assign([], values.value);
  if (value.length > 1) {
    let nextIndex = value.length + index - 1;
    if (nextIndex >= fields.value) {
      nextIndex = fields.value - 1;
    }
    next = iRefs.value[nextIndex];
    const split = value.split("");
    split.forEach((item, i) => {
      const cursor = index + i;
      if (cursor < fields.value) {
        values.value[cursor] = item;
      }
    });
  } else {
    next = iRefs.value[index + 1];
    values.value[index] = value;
  }
  if (next) {
    const element = inputs.value[next];
    element.focus();
    element.select();
  }
  triggerChange(values.value);
};

function isCode(e: KeyboardEvent, name: string): boolean {
  const def = KEY_CODE[name];
  if (!def) {
    return false;
  }
  return def.includes(e.code) || def.includes(e.key);
}

const onKeyDown = (e: KeyboardEvent) => {
  const target = e.target as HTMLInputElement;
  const index = parseInt(target.dataset?.id || "");
  const prevIndex = index - 1;
  const nextIndex = index + 1;
  const prev = iRefs.value[prevIndex];
  const next = iRefs.value[nextIndex];

  if (isCode(e, "backspace")) {
    e.preventDefault();
    const vals = [...values.value];
    if (values.value[index]) {
      vals[index] = "";
      values.value = vals;
      triggerChange(vals);
    } else if (prev) {
      vals[prevIndex] = "";
      inputs.value[prev].focus();
      values.value = vals;
      triggerChange(vals);
    }
  } else if (isCode(e, "left")) {
    e.preventDefault();
    if (prev) {
      inputs.value[prev].focus();
    }
  } else if (isCode(e, "right")) {
    e.preventDefault();
    if (next) {
      inputs.value[next].focus();
    }
  } else if (isCode(e, "up") || isCode(e, "down")) {
    e.preventDefault();
  } else if (isCode(e, "enter")) {
    e.preventDefault();
    const val = values.value.join("");
    if (val.length >= fields.value) {
      emit("submit", val);
    }
  } else {
    if (index === 3) {
      hideCodeInput(0, 0);
      hideCodeInput(1, 0);
      hideCodeInput(2, 0);
      hideCodeInput(3, 400);
    }
  }
};

const triggerChange = (vals: string[]) => {
  const val = vals.join("");
  emit("change", val);
  if (val.length >= fields.value) {
    emit("complete", val);
  }
};

function registerInputRef(el: any, index: number) {
  if (el) {
    inputs.value[index + 1] = el as HTMLInputElement;
  }
}

function resetValues() {
  values.value = [];
  initValue();
}

function initValue() {
  let vals;
  if (values.value && values.value.length) {
    vals = [];
    for (let i = 0; i < fields.value; i++) {
      vals.push(values.value[i] || "");
    }
    autoFocusIndex.value =
      values.value.length >= fields.value ? 0 : values.value.length;
  } else {
    vals = Array(fields.value).fill("");
  }
  iRefs.value = [];
  for (let i = 0; i < fields.value; i++) {
    iRefs.value.push(i + 1);
  }
  values.value = vals;
}

onBeforeUpdate(() => {
  inputs.value = [];
  disabled.value = props.disabled;
  required.value = props.required;
});

onMounted(async () => {
  await sleep(100);
  initValue();
  if (document.querySelector(".code-input")) {
    const firstInput = document
      .querySelector(".code-input")!
      .querySelector(".code-input--input") as HTMLInputElement;
    if (firstInput) {
      firstInput.focus();
    }
  }
});
</script>
<template>
  <div class="code-input" :class="classNames">
    <input
      v-for="(v, index) in values"
      :key="index"
      :ref="
        (el) => {
          if (el) {
            registerInputRef(el, index);
          }
        }
      "
      class="code-input__input"
      pattern="\d*"
      inputmode="numeric"
      :autoFocus="autoFocus && index === autoFocusIndex"
      :data-id="index"
      :value="v"
      :required="required"
      :disabled="disabled"
      maxlength="1"
      @input="onValueChange($event)"
      @focus="onFocus($event)"
      @keydown="onKeyDown"
      @blur="onBlur($event, index)"
    />
  </div>
</template>
