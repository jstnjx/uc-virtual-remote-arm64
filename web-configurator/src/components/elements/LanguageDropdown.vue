<script setup lang="ts">
import {
  ref,
  reactive,
  computed,
  watch,
  onMounted,
  onUnmounted,
  useTemplateRef,
} from "vue";

import type { LanguageListItem } from "@/types/config";

import { useTranslation } from "i18next-vue";

import { configStore } from "@/stores/config";

import {
  getValueByLang,
  hasDefaultCountryLocale,
  isDefaultCountryLocale,
} from "@/composables/translatedProperty";

import AppDialog from "@/components/elements/AppDialog.vue";
import { deepClone } from "@/composables/dataHelper";
import { useModalToggle } from "@/composables/modal";

const props = defineProps({
  langCode: {
    type: String,
    default: "",
  },
  translations: {
    type: Object,
    default: () => ({}),
  },
});

const emit = defineEmits(["setLang", "deleteText"]);

const config = configStore();
const openDropdown = ref(false);
const langToDelete = ref("");

useModalToggle(openDropdown, { lockScroll: false });

// Both read reactively: the language list arrives with the config, and the active
// locale changes at runtime. Read once at setup they would freeze at whatever was
// true when this dropdown was first created.
const allLanguages = computed(
  () => config.list.languages as LanguageListItem[],
);
// i18next.language is a plain property; it is the *proxied* i18next from
// useTranslation() that records the read, so this computed re-runs on a switch.
const { i18next } = useTranslation();
const currentLocale = computed(() => i18next.language);

const elDropdown = useTemplateRef<HTMLDivElement>("elDropdown");
const dialogDelete =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDelete");

const dropdownStyles = reactive<Record<string, string | undefined>>({
  position: "fixed",
  top: undefined,
  bottom: undefined,
  left: undefined,
  right: undefined,
});

watch(openDropdown, () => {
  updateDropdownPosition();
});

const availableLanguages = computed(() => {
  return allLanguages.value.filter(
    (l) => hasTranslation(l.code) || l.code === currentLocale.value,
  );
});

function getLangCode(code: string) {
  if (hasDefaultCountryLocale(code) && isDefaultCountryLocale(code)) {
    return code.substring(0, 2);
  }
  return code.replace("_", " - ");
}

function setLang(code: string) {
  emit("setLang", code || "en_US");
  openDropdown.value = false;
}

function hasTranslation(code: string) {
  const value = getValueByLang(props.translations, code, true).value;
  return typeof value != "undefined" && value.length > 0;
}

function updateDropdownPosition() {
  if (!elDropdown.value) return;

  const parentRect = elDropdown.value.getBoundingClientRect();

  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const right = viewportWidth - parentRect.right;

  const spaceBelow = viewportHeight - parentRect.bottom;
  const spaceAbove = parentRect.top;

  dropdownStyles.top = undefined;
  dropdownStyles.bottom = undefined;
  dropdownStyles.left = undefined;
  dropdownStyles.right = undefined;

  dropdownStyles.right = `${right}px`;

  if (spaceBelow >= 360) {
    dropdownStyles.top = `${parentRect.bottom}px`;
  } else if (spaceAbove >= 360) {
    dropdownStyles.bottom = `${viewportHeight - parentRect.top}px`;
  } else {
    const middleY = viewportHeight / 2;
    const dropdownHeight = 360;

    let topPos = middleY - dropdownHeight / 2;
    if (topPos < 0) topPos = 0;
    if (topPos + dropdownHeight > viewportHeight)
      topPos = viewportHeight - dropdownHeight;

    dropdownStyles.top = `${topPos}px`;
  }
}

function handleResize() {
  if (openDropdown.value) {
    updateDropdownPosition();
  }
}

function startDeleteContent(lang: string) {
  langToDelete.value = lang;
  dialogDelete.value?.open();
}

function deleteContent() {
  const newLocale = getFallbackLocale(langToDelete.value);

  emit("deleteText", langToDelete.value);
  openDropdown.value = false;
  langToDelete.value = "";
  emit("setLang", newLocale);
}

function getFallbackLocale(locale: string) {
  const shortLocale = locale.substring(0, 2);
  const availableTranslations = deepClone(props.translations);
  if (availableTranslations[locale]) {
    delete availableTranslations[locale];
  } else if (
    isDefaultCountryLocale(locale) &&
    availableTranslations[shortLocale]
  ) {
    delete availableTranslations[shortLocale];
  }

  return getValueByLang(availableTranslations, locale).lang || "en_US";
}

onMounted(() => {
  updateDropdownPosition();
  window.addEventListener("resize", handleResize);
});

onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
});
</script>
<template>
  <div ref="elDropdown" class="language-dropdown">
    <button
      :disabled="availableLanguages.length < 2"
      class="button language-dropdown__trigger"
      @click="openDropdown = true"
    >
      <i v-if="hasTranslation(langCode)" class="fa-thin fa-check"></i>
      {{ getLangCode(langCode || "en_US") }}
    </button>
    <Teleport to="body">
      <Transition name="opacity">
        <div
          v-show="openDropdown"
          class="language-dropdown__background"
          @click="openDropdown = false"
        ></div>
      </Transition>
      <Transition name="grow">
        <div
          v-if="availableLanguages.length > 1"
          v-show="openDropdown"
          :style="dropdownStyles"
          class="language-dropdown__container"
        >
          <div class="language-dropdown__container__body">
            <ul class="language-dropdown__container__list">
              <li
                v-for="lang in availableLanguages"
                :key="lang.code"
                class="language-dropdown__container__list__item"
                :class="{
                  'language-dropdown__container__list__item--system-lang':
                    currentLocale === lang.code,
                }"
                @click="setLang(lang.code)"
              >
                <span
                  class="language-dropdown__container__list__item__indicator"
                >
                  <i v-if="hasTranslation(lang.code)" class="fa-thin fa-check">
                  </i>
                  {{ getLangCode(lang.code) }}
                </span>
                <span class="language-dropdown__container__list__item__label">
                  {{ lang.name }}
                </span>
                <button
                  v-if="
                    hasTranslation(lang.code) &&
                    Object.keys(translations).length > 1
                  "
                  class="button button--blank button--blank--focus button--icon"
                  @click.stop="startDeleteContent(lang.code)"
                >
                  <i class="fa-light fa-trash"></i>
                </button>
              </li>
            </ul>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>

  <AppDialog
    ref="dialogDelete"
    :title="$t('language_text.popup_delete.title')"
    :text="$t('language_text.popup_delete.question')"
    :submit-text="$t('ui.delete')"
    :cancel-text="$t('ui.cancel')"
    @submit="deleteContent"
  />
</template>
