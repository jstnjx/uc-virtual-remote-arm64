<!-- Entity command parameter `type: selection` -->
<script setup lang="ts">
import {
  ref,
  watch,
  computed,
  getCurrentInstance,
  nextTick,
  onBeforeUnmount,
  type PropType,
} from "vue";

interface SelectOption {
  label: string;
  value: string;
}

const props = defineProps({
  value: {
    type: String,
    required: true,
  },
  params: {
    type: Object,
    required: true,
  },
  options: {
    type: Array as PropType<string[]>,
    default: () => [],
  },
  editIcon: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  allowFreeText: {
    type: Boolean,
    default: false,
  },
});
const emit = defineEmits(["change"]);

const value = ref(props.value);
const lastEmitted = ref(props.value);
const selected = ref({ label: props.value, value: props.value });

const searchText = ref("");

const instanceId = getCurrentInstance()!.uid;
const selectOpened = ref(false);
const highlighted = ref(-1);

const rootEl = ref<HTMLElement>();
const toggleEl = ref<HTMLElement>();
const searchEl = ref<HTMLInputElement>();
const dropdownEl = ref<HTMLElement | null>(null);

let detachPosition: (() => void) | undefined;

const listboxId = `setup-selection-${instanceId}__listbox`;

function optionId(index: number) {
  return `setup-selection-${instanceId}__option-${index}`;
}

watch(
  () => props.value,
  (newValue) => {
    const val = newValue ?? "";

    if (value.value !== val) {
      value.value = val;
      lastEmitted.value = props.value;
      selected.value = { label: val, value: val };
    }
  },
  { immediate: true },
);

watch(selected, (val, oldVal) => {
  if (val?.value !== oldVal?.value) {
    emitChange(val.value);
  }
});

const options = computed(() =>
  (props.options ?? []).map((item) => ({
    label: item,
    value: item,
  })),
);

const enabledFreeText = computed(() => {
  return props.allowFreeText || props.params?.items?.field === "source_list";
});

// Only the free-text mode has a search input, so only it can filter.
const filteredOptions = computed<SelectOption[]>(() => {
  if (!enabledFreeText.value || !searchText.value) {
    return options.value;
  }
  const query = searchText.value.toLocaleLowerCase();
  return options.value.filter(
    (option) => (option.label || "").toLocaleLowerCase().indexOf(query) > -1,
  );
});

const stateClasses = computed(() => ({
  "vs--single": true,
  "vs--open": selectOpened.value,
  "vs--searching": !!searchText.value,
  "vs--searchable": enabledFreeText.value,
  "vs--unsearchable": !enabledFreeText.value,
  "vs--disabled": props.disabled,
}));

const activeDescendant = computed(() =>
  selectOpened.value && filteredOptions.value[highlighted.value]
    ? optionId(highlighted.value)
    : undefined,
);

const dynWidth = computed(() => {
  let maxChars = 0;
  for (const option of props.options ?? []) {
    const labelLength =
      typeof option === "string"
        ? option.length
        : ((option as SelectOption)?.label?.length ?? 0);
    if (labelLength > maxChars) {
      maxChars = labelLength;
    }
  }

  if (maxChars < 10) {
    return null;
  }

  return `${maxChars * 14 + 50}px`;
});

function updateTextValue(event: Event) {
  const target = event.target;

  if (target instanceof HTMLInputElement) {
    emitChange(target.value);
  }
}

function emitChange(newValue: string) {
  if (newValue === lastEmitted.value) return;

  lastEmitted.value = newValue;

  const args = {
    paramValue: newValue,
    paramName: props.params.param,
  };
  emit("change", args);
}

function saveText() {
  selected.value = {
    label: searchText.value || "",
    value: searchText.value || "",
  };
  searchEl.value?.blur();
  closeSelect();
}

function selectOption(option: SelectOption) {
  selected.value = { ...option };
  searchEl.value?.blur();
  closeSelect();
}

// Filtering invalidates the highlight: point at the first match so Enter
// picks the top result, and at nothing when there is no match, which is what
// hands Enter over to the free-text commit.
watch(searchText, () => {
  if (selectOpened.value) {
    highlighted.value = filteredOptions.value.length > 0 ? 0 : -1;
  }
});

function moveHighlight(to: number) {
  if (to >= 0 && to < filteredOptions.value.length) {
    highlighted.value = to;
  }
}

async function openSelect() {
  if (props.disabled || selectOpened.value) {
    return;
  }

  selectOpened.value = true;
  highlighted.value = filteredOptions.value.findIndex(
    (option) => option.value === selected.value?.value,
  );

  await nextTick();

  if (enabledFreeText.value) {
    searchEl.value?.focus();
  }

  if (dropdownEl.value && toggleEl.value) {
    detachPosition = calcPosition(dropdownEl.value, toggleEl.value);
  }
}

function closeSelect() {
  if (!selectOpened.value) {
    return;
  }

  selectOpened.value = false;
  searchText.value = "";
  highlighted.value = -1;

  detachPosition?.();
  detachPosition = undefined;

  const dropdown = dropdownEl.value;
  if (!dropdown) return;

  dropdown.classList.remove("dropdown-enter-active");
  dropdown.classList.add("dropdown-leave");

  setTimeout(() => {
    dropdown.classList.remove("dropdown-leave", "dropdown-enter");
  }, 160);
}

onBeforeUnmount(() => {
  detachPosition?.();
});

function onToggleMousedown(event: MouseEvent) {
  const target = event.target as HTMLElement;
  const onSearchInput = enabledFreeText.value && target === searchEl.value;

  if (props.disabled) {
    return;
  }

  // The clear button sits inside the toggle but owns its own click; leave the
  // open state alone underneath it, as vue-select's toggleDropdown did.
  if (target.closest(".vs__clear")) {
    return;
  }

  // In free-text mode focus belongs to the search input. Clicking the arrow or
  // the label must not let the browser move focus (to the body, as the toggle
  // is not focusable here): that native focus change fires a focusout with a
  // null relatedTarget right after openSelect() focuses the input, and
  // onFocusout reads it as "focus left the select" and closes the list again.
  // Mirrors UCSelect.onToggleMousedown.
  if (enabledFreeText.value && !onSearchInput) {
    event.preventDefault();
  }

  if (selectOpened.value && !onSearchInput) {
    closeSelect();
    return;
  }

  void openSelect();
}

function onKeydown(event: KeyboardEvent) {
  if (props.disabled) {
    return;
  }

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      if (selectOpened.value) {
        moveHighlight(highlighted.value + 1);
      } else {
        void openSelect();
      }
      break;
    case "ArrowUp":
      event.preventDefault();
      if (selectOpened.value) {
        moveHighlight(highlighted.value - 1);
      } else {
        void openSelect();
      }
      break;
    case "Enter":
      event.preventDefault();
      onEnter();
      break;
    case "Escape":
      if (selectOpened.value) {
        event.stopPropagation();
        // Mirrors vue-select: the first Esc drops the query, the next closes.
        if (searchText.value) {
          searchText.value = "";
        } else {
          closeSelect();
        }
      }
      break;
    case "Tab":
      closeSelect();
      break;
  }
}

// Enter picks the highlighted option, and commits the typed text only when
// the filter matched nothing — the same split vue-select produced by way of
// blurring the search input before the keyup landed.
function onEnter() {
  if (!selectOpened.value) {
    void openSelect();
    return;
  }

  const option = filteredOptions.value[highlighted.value];
  if (option) {
    selectOption(option);
  } else if (enabledFreeText.value) {
    saveText();
  }
}

function onFocusout(event: FocusEvent) {
  const next = event.relatedTarget as Node | null;
  if (next && rootEl.value?.contains(next)) {
    return;
  }
  closeSelect();
}

/**
 * Positions the body-teleported dropdown against the toggle and keeps it there,
 * returning a detach function. Deliberately not `useDropdownPosition`: this one
 * is `position: fixed` and listens for scroll in the capture phase, so it keeps
 * up with the scrollable modal bodies this component lives in, and it clamps
 * the menu to the space actually available rather than to the viewport height.
 */
function calcPosition(dropdownList: HTMLElement, reference: HTMLElement) {
  const width = `${reference.getBoundingClientRect().width}px`;
  const VIEWPORT_MARGIN = 10;

  dropdownList.style.position = "fixed";
  dropdownList.style.width =
    dynWidth.value != null ? (dynWidth.value ?? width) : width;
  dropdownList.style.visibility = "hidden";
  dropdownList.style.display = "block";
  dropdownList.style.maxHeight = "";
  dropdownList.style.overflowY = "";

  function calculate() {
    const rect = reference.getBoundingClientRect();
    const naturalHeight = dropdownList.scrollHeight;
    const naturalWidth = dropdownList.offsetWidth;

    const maxViewportHeight = window.innerHeight - VIEWPORT_MARGIN * 2;

    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - VIEWPORT_MARGIN;

    let height = naturalHeight;
    let top = rect.bottom;
    let isDropUp = false;

    if (spaceBelow >= naturalHeight) {
      top = rect.bottom;
      isDropUp = false;
    } else if (spaceAbove >= naturalHeight) {
      height = naturalHeight;
      top = rect.top - height;
      isDropUp = true;
    } else {
      if (spaceBelow >= spaceAbove) {
        height = spaceBelow;
        top = rect.bottom;
        isDropUp = false;
      } else {
        height = spaceAbove;
        top = rect.top - height;
        isDropUp = true;
      }
    }

    if (height > maxViewportHeight) {
      height = maxViewportHeight;
    }

    if (top < VIEWPORT_MARGIN) {
      top = VIEWPORT_MARGIN;
    }

    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      top = window.innerHeight - VIEWPORT_MARGIN - height;
    }

    let left = rect.left;

    if (left + naturalWidth > window.innerWidth - VIEWPORT_MARGIN) {
      left = window.innerWidth - VIEWPORT_MARGIN - naturalWidth;
    }

    if (left < VIEWPORT_MARGIN) {
      left = VIEWPORT_MARGIN;
    }

    return { top, left, height, isDropUp };
  }

  function applyPosition() {
    const { top, left, height, isDropUp } = calculate();

    dropdownList.style.top = `${top}px`;
    dropdownList.style.left = `${left}px`;
    dropdownList.style.maxHeight = `${height}px`;
    dropdownList.style.overflowY =
      dropdownList.scrollHeight > height ? "auto" : "";

    dropdownList.classList.toggle("drop-up", isDropUp);
  }

  requestAnimationFrame(() => {
    applyPosition();

    dropdownList.classList.remove("dropdown-leave");
    dropdownList.classList.add("dropdown-enter");

    dropdownList.style.visibility = "visible";
    dropdownList.style.display = "";

    requestAnimationFrame(() => {
      dropdownList.classList.add("dropdown-enter-active");
    });
  });

  const update = () => applyPosition();

  window.addEventListener("resize", update);
  window.addEventListener("scroll", update, true);

  const observer = new ResizeObserver(update);
  observer.observe(dropdownList);

  return () => {
    window.removeEventListener("resize", update);
    window.removeEventListener("scroll", update, true);
    observer.disconnect();
  };
}
</script>
<template>
  <div
    v-if="params.param && options && options.length > 0"
    class="setup-item setup-item--selection-select"
  >
    <div class="setup-item__body">
      <Transition name="opacity">
        <!-- Full-viewport backdrop: owns outside-click closing, since it
             covers everything below the open select anyway. -->
        <div
          v-show="selectOpened"
          class="v-select__custom-background"
          @click="closeSelect"
        ></div>
      </Transition>
      <div
        ref="rootEl"
        class="v-select"
        :class="stateClasses"
        @keydown="onKeydown"
        @focusout="onFocusout"
      >
        <div
          ref="toggleEl"
          class="vs__dropdown-toggle"
          role="combobox"
          :tabindex="disabled || enabledFreeText ? undefined : 0"
          :aria-expanded="selectOpened ? 'true' : 'false'"
          aria-haspopup="listbox"
          :aria-controls="listboxId"
          :aria-activedescendant="activeDescendant"
          :aria-disabled="disabled ? 'true' : undefined"
          @mousedown="onToggleMousedown"
        >
          <div class="vs__selected-options">
            <span class="vs__selected">{{ selected.label }}</span>
            <input
              v-if="enabledFreeText"
              ref="searchEl"
              v-model="searchText"
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
          <div class="vs__actions">
            <button
              v-if="enabledFreeText"
              type="button"
              class="vs__clear"
              :title="$t('ui.clear')"
              :aria-label="$t('ui.clear')"
              @click="saveText"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
                <path
                  d="M6.895455 5l2.842897-2.842898c.348864-.348863.348864-.914488 0-1.263636L9.106534.261648c-.348864-.348864-.914489-.348864-1.263636 0L5 3.104545 2.157102.261648c-.348863-.348864-.914488-.348864-1.263636 0L.261648.893466c-.348864.348864-.348864.914489 0 1.263636L3.104545 5 .261648 7.842898c-.348864.348863-.348864.914488 0 1.263636l.631818.631818c.348864.348864.914773.348864 1.263636 0L5 6.895455l2.842898 2.842897c.348863.348864.914772.348864 1.263636 0l.631818-.631818c.348864-.348864.348864-.914489 0-1.263636L6.895455 5z"
                ></path>
              </svg>
            </button>
          </div>
        </div>
        <Teleport to="body">
          <Transition name="vs__fade">
            <!-- Keep the class attribute static: positionDropdown adds
                 dropdown-enter/-active and drop-up via classList, which a
                 reactive :class binding would overwrite on re-render. -->
            <ul
              v-if="selectOpened"
              :id="listboxId"
              ref="dropdownEl"
              class="vs__dropdown-menu"
              role="listbox"
              tabindex="-1"
              @mousedown.prevent
            >
              <li
                v-for="(option, index) in filteredOptions"
                :id="optionId(index)"
                :key="option.value"
                class="vs__dropdown-option"
                :class="{
                  'vs__dropdown-option--selected':
                    option.value === selected.value,
                  'vs__dropdown-option--highlight': index === highlighted,
                }"
                role="option"
                :aria-selected="
                  option.value === selected.value ? 'true' : 'false'
                "
                @mouseover="highlighted = index"
                @click.prevent.stop="selectOption(option)"
              >
                <span class="label">{{ option.label }}</span>
              </li>
              <li v-if="filteredOptions.length === 0" class="vs__no-options">
                <div
                  v-if="enabledFreeText"
                  class="button button--secondary button-add-freetext"
                  @click="saveText"
                >
                  {{ $t("ui.add") }}
                </div>
                <span v-else class="v-select__no-options">{{
                  $t("form.no_options_found")
                }}</span>
              </li>
            </ul>
          </Transition>
        </Teleport>
      </div>
    </div>
  </div>
  <div v-else-if="params.param" class="setup-item setup-item--selection-input">
    <div class="setup-item__body">
      <input
        :id="`setup-selection-${instanceId}`"
        type="text"
        :value="value"
        @keyup.enter="updateTextValue"
        @blur="updateTextValue"
      />
      <label
        :for="`setup-selection-${instanceId}`"
        class="setup-item__label"
      ></label>
    </div>
  </div>
</template>
<style lang="scss">
.dropdown-enter {
  opacity: 0;
  transform: scaleY(0.96) translateY(-4px);
  transform-origin: top;
}

.dropdown-enter.drop-up {
  transform-origin: bottom;
  transform: scaleY(0.96) translateY(4px);
}

.dropdown-enter-active {
  opacity: 1;
  transform: scaleY(1) translateY(0);
  transition:
    opacity 400ms ease,
    transform 500ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.dropdown-leave {
  opacity: 0;
  transform: scaleY(0.96);
  transition:
    opacity 400ms ease,
    transform 500ms ease;
}
</style>
