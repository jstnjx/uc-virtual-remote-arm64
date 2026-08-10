<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";
import { useTranslation } from "i18next-vue";
import type { DropdownItem } from "@/types/ui";

import { useTiming } from "@/composables/timing";
import { useModalToggle } from "@/composables/modal";

const props = defineProps({
  listData: {
    type: Array<DropdownItem>,
    default: [],
  },
  icon: {
    type: String,
    default: "fa-light fa-bars",
  },
  label: {
    type: String,
    default: "",
  },
  title: {
    type: String,
    default: "",
  },
  onRight: {
    type: Boolean,
    default: false,
  },
});

const { i18next } = useTranslation();
const { sleep } = useTiming();
const emit = defineEmits(["itemClick", "show"]);

const show = ref(false);
const onBottom = ref(false);
const menuMain = useTemplateRef<HTMLDivElement>("menuMain");

useModalToggle(show, { lockScroll: false });

watch(show, async (val) => {
  // For animation
  if (val == false) {
    await sleep(200);
  }

  emit("show", val);
});

const growMenuMain = computed(() => {
  if (props.onRight) {
    return "grow";
  }
  return "grow-from-left";
});

function itemClick(item: DropdownItem) {
  emit("itemClick", item);
  show.value = false;
}

async function showDropdown() {
  const bodyEl = document.getElementsByTagName("body")[0];
  if (bodyEl) {
    bodyEl.click();
  }
  onBottom.value = false;
  show.value = true;
  if (menuMain.value) {
    checkPosition(menuMain.value);
  }
}

async function checkPosition(el: HTMLElement) {
  await sleep(500);
  const rect = el.getBoundingClientRect();
  const isOutOfView = rect.bottom > window.innerHeight - 50;
  onBottom.value = isOutOfView;
}
</script>
<template>
  <div
    class="dropdown-menu"
    :class="{
      'dropdown-menu--on-right': onRight,
      'dropdown-menu--on-bottom': onBottom,
      'dropdown-menu--open': show,
    }"
  >
    <div class="dropdown-menu__trigger">
      <template v-if="!!$slots.trigger">
        <div @click.stop="showDropdown">
          <slot name="trigger" />
        </div>
      </template>
      <button
        v-else
        class="button button--secondary button--icon"
        @click.stop="showDropdown"
      >
        <i :class="icon"></i>
      </button>
    </div>
    <Transition name="opacity-fast">
      <div
        v-show="show"
        class="dropdown-menu__background"
        @click.stop="show = false"
      ></div>
    </Transition>
    <Transition :name="growMenuMain">
      <div
        v-show="show"
        ref="menuMain"
        class="dropdown-menu__main"
        :class="{ 'dropdown-menu__main--fixed': title && title.length > 0 }"
      >
        <span
          v-if="title && title.length > 0"
          class="dropdown-menu__main__title"
          >{{ title }}</span
        >
        <ul class="dropdown-menu__list">
          <li
            v-for="item in listData"
            :key="item.value"
            class="dropdown-menu__list__item"
            :class="{ 'dropdown-menu__list__item--disabled': item.disabled }"
            @click.stop="itemClick(item)"
          >
            <div class="dropdown-menu__list__item__main">
              <i
                v-if="item.icon"
                class="dropdown-menu__list__item__icon"
                :class="item.icon"
              ></i>
              <span v-if="item.label" class="dropdown-menu__list__item__label">
                <template v-if="i18next.exists(`${item.label}`)">{{
                  $t(`${item.label}`)
                }}</template>
                <template v-else>{{ item.label }}</template>
              </span>
            </div>
            <p
              v-if="item.description"
              class="dropdown-menu__list__item__description"
            >
              {{ item.description }}
            </p>
          </li>
        </ul>
      </div>
    </Transition>
  </div>
</template>
