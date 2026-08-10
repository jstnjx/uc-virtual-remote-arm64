<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRouter } from "vue-router";
import type { MenuItems } from "@/types/menu";

import { useMenuItems } from "@/composables/menuItems";
import { useModalToggle } from "@/composables/modal";

import { appStateStore } from "@/stores/appState";

import MenuProfile from "@/components/profile/MenuProfile.vue";

defineProps({
  onSubPage: {
    type: Boolean,
    default: false,
  },
});

const router = useRouter();
const appState = appStateStore();

const { getMenuItems } = useMenuItems();
const items = (getMenuItems() as MenuItems) || [];
const open = ref(false);

useModalToggle(open, { lockScroll: false });

const emit = defineEmits(["toggle"]);

// Pushed to the navbar rather than pulled from it: reading this off the
// component instance made the navbar's render depend on the instance, so a menu
// that failed to mount re-triggered that render on every retry and the page
// locked up in a re-mount loop.
watch(open, (val) => emit("toggle", val));

const showMobileMenu = computed(() => {
  return router.currentRoute.value.name !== "login";
});
</script>
<template>
  <div v-if="showMobileMenu" class="menu-main-mobile">
    <Teleport to="body">
      <Transition name="opacity">
        <div v-show="open && onSubPage" class="menu-main-mobile__top-line">
          <router-link :to="{ name: 'home' }">
            <img
              alt="Unfolded Circle logo"
              class="logo"
              src="/logo.svg"
              width="45"
              height="30"
            />
          </router-link>
        </div>
      </Transition>
      <button
        class="menu-main-mobile__trigger"
        :class="{
          active: open,
          'menu-main-mobile__trigger--in-background': appState.activeDropdown,
        }"
        @click="open = !open"
      >
        <div class="line"></div>
        <div class="line"></div>
      </button>
      <Transition name="opacity">
        <div v-show="open" class="menu-main-mobile__body">
          <ul class="menu-main-mobile__items">
            <li
              v-for="item in items"
              :key="item.to.name"
              class="menu-main-mobile__item"
            >
              <router-link :to="item.to" @click="open = false">{{
                $t(item.title)
              }}</router-link>
            </li>
          </ul>
          <div class="menu-main-mobile__profiles">
            <MenuProfile :mobile-view="true" @logout="open = false" />
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
