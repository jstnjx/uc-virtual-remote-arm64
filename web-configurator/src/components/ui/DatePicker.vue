<script setup lang="ts">
import { ref, computed } from "vue";
import { storeToRefs } from "pinia";
// Imported locally (was globally registered in main.ts) so the datepicker and
// its stylesheet stay out of the entry chunk and load only with this component.
import { VueDatePicker } from "@vuepic/vue-datepicker";
import "@vuepic/vue-datepicker/dist/main.css";
import type { Locale } from "date-fns";
import {
  cs,
  da,
  de,
  el,
  enUS,
  es,
  et,
  fi,
  fr,
  hr,
  hu,
  it,
  lt,
  lv,
  nb,
  nl,
  pl,
  pt,
  sk,
  sl,
  sv,
} from "date-fns/locale";

import { configStore } from "@/stores/config";

import { getCurrentLangcode } from "@/composables/translatedProperty";
import { formatDate } from "@/composables/date";

// vue-datepicker >= 13 takes a date-fns Locale object instead of a langcode
// string. Map the app languages (see src/i18next) to date-fns locales.
const dateFnsLocales: Record<string, Locale> = {
  cs,
  da,
  de,
  el,
  en: enUS,
  es,
  et,
  fi,
  fr,
  hr,
  hu,
  it,
  lt,
  lv,
  nl,
  no: nb,
  pl,
  pt,
  sk,
  sl,
  sv,
};

const configStorage = configStore();

const props = defineProps({
  range: {
    type: Boolean,
    default: false,
  },
  minDate: {
    type: [Date, String],
    default: null,
  },
  maxDate: {
    type: [Date, String],
    default: null,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["change"]);
const { config } = storeToRefs(configStorage);

const date = ref<Date | Date[] | null>(null);
const tempDate = ref<Date | Date[] | null>([]);
const activeDP = ref(false);

const timeFormat24h = computed(() => {
  return config.value?.localization?.time_format_24h ?? true;
});

const pickerLocale = computed(() => {
  return dateFnsLocales[getCurrentLangcode()] ?? enUS;
});

function clearDate() {
  if (props.range === true) {
    date.value = [];
  } else {
    date.value = null;
  }
  emitDate();
}

function handleInternalChange(newValue: Date | Date[] | null) {
  tempDate.value = newValue;
}

function handleClosed() {
  activeDP;
  activeDP.value = false;
  date.value = tempDate.value;
  emitDate();
}

function emitDate() {
  emit("change", date.value);
}
</script>
<template>
  <div class="datepicker">
    <Teleport to="body">
      <Transition name="opacity-fast">
        <div v-show="activeDP" class="datepicker__background"></div>
      </Transition>
    </Teleport>
    <Transition name="opacity-fast">
      <VueDatePicker
        v-model="date"
        :range="range"
        :teleport="true"
        :centered="true"
        :min-date="minDate"
        :max-date="maxDate"
        :locale="pickerLocale"
        :action-row="{ selectBtnLabel: $t('ui.save') }"
        :time-config="{ is24: timeFormat24h, timePickerInline: true }"
        :disabled="disabled"
        dark
        hide-input-icon
        @internal-model-change="handleInternalChange"
        @open="activeDP = true"
        @closed="handleClosed"
      >
        <template #trigger>
          <button :disabled="disabled" class="datepicker__value">
            <template
              v-if="
                range === true &&
                date &&
                Array.isArray(date) &&
                date.length > 0 &&
                date[0]
              "
            >
              {{ formatDate(date[0], timeFormat24h) }}
              <span
                v-if="date.length < 2"
                class="datepicker__value__clear"
                @click.stop="clearDate"
              >
                <i class="fa-light fa-close"></i>
              </span>
            </template>
            <template v-else-if="date && date instanceof Date">
              {{ formatDate(date, timeFormat24h) }}
              <span class="datepicker__value__clear" @click.stop="clearDate">
                <i class="fa-light fa-close"></i>
              </span>
            </template>
            <template v-else>{{ $t("ui.not_set") }}</template>
          </button>
          <template v-if="range === true">
            <div class="spacer">
              <i class="fa-light fa-arrow-right"></i>
            </div>
            <button :disabled="disabled" class="datepicker__value">
              <template
                v-if="date && Array.isArray(date) && date.length > 1 && date[1]"
              >
                {{ formatDate(date[1], timeFormat24h) }}
                <span class="datepicker__value__clear" @click.stop="clearDate">
                  <i class="fa-light fa-close"></i>
                </span>
              </template>
              <template v-else>{{ $t("ui.not_set") }}</template>
            </button>
          </template>
        </template>
      </VueDatePicker>
    </Transition>
  </div>
</template>
