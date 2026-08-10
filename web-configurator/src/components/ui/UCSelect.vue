<script
  setup
  lang="ts"
  generic="T extends SelectOption, M extends SelectOption | SelectOption[]"
>
import {
  ref,
  watch,
  computed,
  getCurrentInstance,
  nextTick,
  onBeforeUnmount,
} from "vue";

import type { SelectOption } from "@/types/ui";

import { useDropdownPosition } from "@/composables/dropdownPosition";

// The template has two root nodes (backdrop teleport + select), so Vue cannot
// auto-inherit fallthrough attributes: it drops them with a dev warning. Bind
// them to the select root by hand, before the explicit bindings below, so the
// component's own id/class survive a caller that passes its own.
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    options: T[];
    position?: string;
    dynamicPosition?: boolean;
    dynamicWidth?: boolean;
    searchable?: boolean;
    multiple?: boolean;
    light?: boolean;
    dark?: boolean;
    compact?: boolean;
    langKeys?: boolean;
    disabled?: boolean;
  }>(),
  {
    position: "",
    dynamicPosition: false,
    dynamicWidth: false,
    searchable: false,
    multiple: false,
    light: false,
    dark: false,
    compact: false,
    langKeys: false,
    disabled: false,
  },
);

const instanceId =
  getCurrentInstance()?.uid ||
  Math.floor(Math.random() * (99999 - 10000 + 1)) + 10000; // with fallback

const emit = defineEmits<{
  select: [value: M];
  opened: [open: boolean];
}>();

const model = defineModel<M>({ required: true });
const selectOpened = ref(false);
const search = ref("");
const highlighted = ref(-1);

const rootEl = ref<HTMLElement>();
const toggleEl = ref<HTMLElement>();
const menuEl = ref<HTMLElement>();
const searchEl = ref<HTMLInputElement>();

let detachPosition: (() => void) | undefined;

watch(selectOpened, (val) => {
  emit("opened", val);
});

const listboxId = `v-select-${instanceId}__listbox`;

function optionId(index: number) {
  return `v-select-${instanceId}__option-${index}`;
}

// Searching is only wired up for single selects: multiple mode renders
// checkbox rows and has never had a search input.
const isSearchable = computed(() => props.searchable && !props.multiple);

const selectedOptions = computed<T[]>(() => {
  const value = model.value;
  if (!value) {
    return [];
  }
  const selected = (Array.isArray(value) ? value : [value]) as T[];
  // Display the label from `options`, not the one carried by the model. Callers
  // hold the selection as a copy of the option they picked, so its label is
  // frozen in the language it was picked in, while `options` is rebuilt on a
  // language change. Falls back to the model's own entry for a selection that is
  // not in the list (options not loaded yet, or a stale stored value).
  return selected.map(
    (item) =>
      props.options.find((option) => option.value === item?.value) ?? item,
  );
});

const filteredOptions = computed<T[]>(() => {
  if (!isSearchable.value || !search.value) {
    return props.options;
  }
  const query = search.value.toLocaleLowerCase();
  return props.options.filter(
    (option) => (option.label || "").toLocaleLowerCase().indexOf(query) > -1,
  );
});

const dynWidth = computed(() => {
  let maxChars = 0;
  for (const option of props.options) {
    const labelLength =
      typeof option === "string"
        ? (option as string).length
        : (option?.label?.length ?? 0);
    if (labelLength > maxChars) {
      maxChars = labelLength;
    }
  }

  if (maxChars < 10) {
    return null;
  }

  return `${maxChars * 14 + 50}px`;
});

const mainClasses = computed(() => {
  let classList = "";
  classList += props.position == "center" ? "v-select--on-center-list " : "";
  classList += props.position == "right" ? "v-select--on-right-list " : "";
  classList += props.multiple ? "v-select--multiple " : "";
  classList += props.light ? "v-select--light " : "";
  classList += props.dark && !props.light ? "v-select--dark " : "";
  classList += props.compact ? "v-select--compact " : "";
  return classList;
});

const stateClasses = computed(() => ({
  "vs--open": selectOpened.value,
  "vs--single": !props.multiple,
  "vs--multiple": props.multiple,
  "vs--searching": !!search.value,
  "vs--searchable": isSearchable.value,
  "vs--unsearchable": !isSearchable.value,
  "vs--disabled": props.disabled,
}));

const activeDescendant = computed(() =>
  selectOpened.value && filteredOptions.value[highlighted.value]
    ? optionId(highlighted.value)
    : undefined,
);

function isSelected(option: T) {
  return selectedOptions.value.some((item) => item.value === option.value);
}

function highlightLastSelected() {
  const last = selectedOptions.value[selectedOptions.value.length - 1];
  highlighted.value = last
    ? filteredOptions.value.findIndex((option) => option.value === last.value)
    : -1;
}

function highlightFrom(start: number, step: number) {
  const options = filteredOptions.value;
  for (let i = start; i >= 0 && i < options.length; i += step) {
    if (!options[i].disabled) {
      highlighted.value = i;
      return;
    }
  }
}

// Filtering invalidates the highlight: point at the first match so Enter
// picks the top result.
watch(search, () => {
  if (!selectOpened.value) {
    return;
  }
  highlighted.value = -1;
  highlightFrom(0, 1);
});

function focusSelect() {
  // Only the search input needs focusing from script. The unsearchable toggle
  // is focused by the browser on mousedown, and already holds focus when the
  // dropdown was opened from the keyboard. Focusing it here would trip
  // Chrome's :focus-visible heuristic and ring the toggle on mouse clicks.
  if (isSearchable.value) {
    searchEl.value?.focus();
  }
}

async function open() {
  if (props.disabled || selectOpened.value) {
    return;
  }

  selectOpened.value = true;
  highlightLastSelected();

  await nextTick();
  focusSelect();

  if (!props.dynamicPosition || !toggleEl.value || !menuEl.value) {
    return;
  }

  detachPosition = useDropdownPosition(toggleEl.value, menuEl.value, {
    width:
      props.dynamicWidth && dynWidth.value
        ? dynWidth.value
        : `${toggleEl.value.getBoundingClientRect().width}px`,
  });
}

function close(returnFocus = false) {
  if (!selectOpened.value) {
    return;
  }

  selectOpened.value = false;
  search.value = "";
  highlighted.value = -1;

  detachPosition?.();
  detachPosition = undefined;

  if (returnFocus) {
    toggleEl.value?.focus();
  }
}

onBeforeUnmount(() => {
  detachPosition?.();
});

function selectOption(option: T) {
  if (props.disabled || option.disabled) {
    return;
  }

  if (props.multiple) {
    // Always assign a new array, never mutate the model in place.
    const selection = (isSelected(option)
      ? selectedOptions.value.filter((item) => item.value !== option.value)
      : [...selectedOptions.value, option]) as unknown as M;

    model.value = selection;
    emit("select", selection);
    return;
  }

  const selection = option as unknown as M;
  model.value = selection;
  emit("select", selection);
  close(true);
}

// Arrow keys open the dropdown and, when nothing is selected to highlight,
// land on the first/last option so the keyboard always has a starting point.
// open() sets the highlight synchronously, before it awaits the menu render.
function openWithHighlight(start: number, step: number) {
  void open();
  if (highlighted.value < 0) {
    highlightFrom(start, step);
  }
}

function selectHighlighted() {
  const option = filteredOptions.value[highlighted.value];
  if (option) {
    selectOption(option);
  }
}

function onToggleMousedown(event: MouseEvent) {
  const onSearchInput = isSearchable.value && event.target === searchEl.value;

  // In searchable mode focus belongs to the input, so keep the toggle from
  // taking it. In unsearchable mode the toggle is the focusable combobox: let
  // the browser focus it natively, because focusing it from script after a
  // preventDefault trips Chrome's :focus-visible heuristic and paints a
  // keyboard focus ring on plain mouse clicks.
  if (isSearchable.value && !onSearchInput) {
    event.preventDefault();
  }

  if (props.disabled) {
    return;
  }

  if (selectOpened.value && !onSearchInput) {
    close(true);
    return;
  }

  void open();
}

function onKeydown(event: KeyboardEvent) {
  if (props.disabled) {
    return;
  }

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      if (selectOpened.value) {
        highlightFrom(highlighted.value + 1, 1);
      } else {
        openWithHighlight(0, 1);
      }
      break;
    case "ArrowUp":
      event.preventDefault();
      if (selectOpened.value) {
        highlightFrom(highlighted.value - 1, -1);
      } else {
        openWithHighlight(filteredOptions.value.length - 1, -1);
      }
      break;
    case "Home":
      if (selectOpened.value) {
        event.preventDefault();
        highlightFrom(0, 1);
      }
      break;
    case "End":
      if (selectOpened.value) {
        event.preventDefault();
        highlightFrom(filteredOptions.value.length - 1, -1);
      }
      break;
    case "Enter":
      event.preventDefault();
      if (selectOpened.value) {
        selectHighlighted();
      } else {
        void open();
      }
      break;
    case " ":
      // Space types into the search input when there is one.
      if (isSearchable.value) {
        break;
      }
      event.preventDefault();
      if (selectOpened.value) {
        selectHighlighted();
      } else {
        void open();
      }
      break;
    case "Escape":
      if (selectOpened.value) {
        event.stopPropagation();
        close(true);
      }
      break;
    case "Tab":
      close();
      break;
  }
}

function onFocusout(event: FocusEvent) {
  const next = event.relatedTarget as Node | null;
  if (next && rootEl.value?.contains(next)) {
    return;
  }
  close();
}
</script>
<template>
  <Teleport to="body" :disabled="!dynamicPosition">
    <Transition name="opacity">
      <!-- Full-viewport backdrop: owns outside-click closing, since it covers
           everything below the open select anyway. -->
      <div
        v-show="selectOpened"
        class="v-select__custom-background"
        @click="close()"
      ></div>
    </Transition>
  </Teleport>
  <div
    v-bind="$attrs"
    :id="`v-select-${instanceId}`"
    ref="rootEl"
    class="v-select"
    :class="[mainClasses, stateClasses]"
    data-nofocus
    :style="dynamicWidth ? `width:${dynWidth};` : ''"
    @keydown="onKeydown"
    @focusout="onFocusout"
  >
    <div
      ref="toggleEl"
      class="vs__dropdown-toggle"
      role="combobox"
      :tabindex="disabled || isSearchable ? undefined : 0"
      :aria-expanded="selectOpened ? 'true' : 'false'"
      aria-haspopup="listbox"
      :aria-controls="listboxId"
      :aria-activedescendant="activeDescendant"
      :aria-disabled="disabled ? 'true' : undefined"
      @mousedown="onToggleMousedown"
    >
      <div class="vs__selected-options">
        <span
          v-for="option in selectedOptions"
          :key="option.value"
          class="vs__selected"
        >
          <template v-if="langKeys">{{ $t(option.label) }}</template>
          <template v-else>{{ option.label }}</template>
        </span>
        <input
          v-if="isSearchable"
          ref="searchEl"
          v-model="search"
          class="vs__search"
          type="search"
          autocomplete="off"
          :disabled="disabled"
          aria-autocomplete="list"
          :aria-controls="listboxId"
          :aria-activedescendant="activeDescendant"
        />
      </div>
      <!-- The chevron is drawn by .vs__actions::after -->
      <div class="vs__actions"></div>
    </div>
    <Teleport to="body" :disabled="!dynamicPosition">
      <Transition name="vs__fade">
        <!-- Keep the class attribute static: useDropdownPosition adds
             dynamic-dropdown/animate-dropdown/drop-up via classList, which a
             reactive :class binding would overwrite on re-render. -->
        <ul
          v-if="selectOpened"
          :id="listboxId"
          ref="menuEl"
          class="vs__dropdown-menu"
          role="listbox"
          tabindex="-1"
          :aria-multiselectable="multiple ? 'true' : undefined"
          @mousedown.prevent
        >
          <li
            v-for="(option, index) in filteredOptions"
            :id="optionId(index)"
            :key="option.value"
            class="vs__dropdown-option"
            :class="{
              'vs__dropdown-option--selected': isSelected(option),
              'vs__dropdown-option--highlight': index === highlighted,
              'vs__dropdown-option--disabled': !!option.disabled,
            }"
            role="option"
            :aria-selected="isSelected(option) ? 'true' : 'false'"
            :aria-disabled="option.disabled ? 'true' : undefined"
            @mouseover="option.disabled ? null : (highlighted = index)"
            @click.prevent.stop="selectOption(option)"
          >
            <!-- Clicks anywhere on the row bubble to the row handler, so the
                 tick button, the label and the text all toggle identically.
                 @click.prevent also cancels the label's checkbox activation,
                 which would otherwise toggle the row a second time. -->
            <span v-if="multiple">
              <span class="form-item form-item--checkbox-tick">
                <input
                  :id="`${option.value}-checkbox-tick`"
                  type="checkbox"
                  :checked="isSelected(option)"
                />
                <label class="toggle" :for="`${option.value}-checkbox-tick`" />
                <button class="button--toggle-tick" tabindex="-1"></button>
              </span>
              <span class="label">
                <template v-if="langKeys">{{ $t(option.label) }}</template>
                <template v-else>{{ option.label }}</template>
              </span>
            </span>
            <template v-else>
              <i v-if="option.icon" :class="option.icon"></i>
              <span class="label">
                <template v-if="langKeys">{{ $t(option.label) }}</template>
                <template v-else>{{ option.label }}</template>
              </span>
            </template>
          </li>
          <li v-if="filteredOptions.length === 0" class="vs__no-options">
            <span class="v-select__no-options">{{
              $t("form.no_options_found")
            }}</span>
          </li>
        </ul>
      </Transition>
    </Teleport>
  </div>
</template>
