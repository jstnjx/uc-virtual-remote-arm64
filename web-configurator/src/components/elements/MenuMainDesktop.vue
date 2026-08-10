<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from "vue";
import { useRoute } from "vue-router";
import { useTranslation } from "i18next-vue";

import type { MenuItems } from "@/types/menu";

import { useTiming } from "@/composables/timing";
import { useMenuItems } from "@/composables/menuItems";
import { useModalToggle } from "@/composables/modal";

const { i18next } = useTranslation();
const { getMenuItems } = useMenuItems();
const { sleep } = useTiming();

const props = defineProps({
  notificationWidth: {
    type: Number,
    default: 0,
  },
});

const route = useRoute();
const menuMain = useTemplateRef<HTMLDivElement>("menuMain");
const items = (getMenuItems(true) as MenuItems) || [];
const collapsed = ref(false);
const savedNotificationWidth = ref(0);
const open = ref(false);
const loading = ref(false);
const activeIndex = ref<number | null>(null);

useModalToggle(open, { lockScroll: false });

watch(props, (val) => {
  if (
    savedNotificationWidth.value < val.notificationWidth &&
    collapsed.value == false
  ) {
    handleMenuDimensions();
  } else if (
    savedNotificationWidth.value > val.notificationWidth &&
    collapsed.value == true
  ) {
    handleMenuDimensions();
  }
  savedNotificationWidth.value = val.notificationWidth;
});

watch(route, async () => {
  await sleep(10);
  highlightLink();
});

// For menu animation
watch(
  () => i18next.language,
  async () => {
    const actIndex = activeIndex.value;
    activeIndex.value = null;
    await sleep(50);
    activeIndex.value = actIndex;
  },
);

const menuAnimation = computed(() => {
  if (activeIndex.value !== null) {
    const link = Array.from(
      menuMain.value?.querySelectorAll(".menu-desktop__item") ?? [],
    )[activeIndex.value] as HTMLElement;
    return {
      transform: `translateX(${link.offsetLeft}px)`,
      width: `${link.offsetWidth - 8}px`,
    };
  }
  return null;
});

function getFirstPathSegment(url: string) {
  if (url === "/") {
    return "home";
  }

  if (url.startsWith("/")) {
    url = url.substring(1);
  }

  const segments = url.split("/");
  return segments[0];
}

function highlightLink() {
  const routeName = getFirstPathSegment(route.path);
  if (routeName == undefined || routeName == null) {
    activeIndex.value = 0;
  }
  const active = Object.keys(items).indexOf(routeName.replace(/-/g, "_"));

  if (active > -1) {
    activeIndex.value = active;
  }
}

function hidePopupMenu() {
  if (open.value == true) {
    open.value = false;
  }
}

async function handleMenuDimensions() {
  if (collapsed.value == true) {
    await sleep(200);
  }
  collapsed.value =
    props.notificationWidth +
      (menuMain.value ? menuMain.value.offsetWidth : 0) >
    window.innerWidth - 300;
}

onMounted(async () => {
  loading.value = true;
  highlightLink();
  await sleep(500);
  loading.value = false;
});
</script>
<template>
  <div
    ref="menuMain"
    class="menu-main-desktop"
    :class="{ collapsed: collapsed }"
  >
    <div v-click-outside="hidePopupMenu" class="menu-main-desktop__wrapper">
      <ul class="menu-main-desktop__items">
        <div
          class="menu-animation"
          :class="{ 'menu-animation--active': !loading }"
          :style="menuAnimation"
        ></div>
        <li
          v-for="item in Object.values(items)"
          :key="item.to.name"
          class="menu-desktop__item"
        >
          <router-link v-if="item" :to="item.to">{{
            $t(item.title)
          }}</router-link>
        </li>
      </ul>
      <button
        :class="{ 'menu-main-desktop__trigger--active': open }"
        class="menu-main-desktop__trigger button button--secondary button--with-icon"
        @click="open = !open"
      >
        <i class="fa-light fa-bars"></i>
        <span>{{ $t("ui.menu") }}</span>
      </button>
      <ul
        v-show="open"
        class="menu-main-desktop__dropdown-items"
        @click="hidePopupMenu"
      >
        <li
          v-for="item in items"
          :key="item.to.name"
          class="menu-desktop__item"
        >
          <router-link :to="item.to">{{ $t(item.title) }}</router-link>
        </li>
      </ul>
    </div>
  </div>
</template>
