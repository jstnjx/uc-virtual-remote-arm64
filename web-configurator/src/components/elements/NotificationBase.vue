<script setup lang="ts">
import { ref, computed, watch } from "vue";
import type {
  FlashMessageItem,
  FlashMessageDisplayMeta,
} from "@/types/flashMessages";
import {
  FlashMessageType,
  FlashMessageInfoStatus,
  FlashMessagePlacement,
} from "@/types/enums";

import { appStateStore } from "@/stores/appState";
import { messagesStore, hideMessage } from "@/stores/messages";

import { useTiming } from "@/composables/timing";
import { useWindowDimension } from "@/composables/windowDimension";

const { sleep } = useTiming();

const appStore = appStateStore();
const msgStore = messagesStore();

const { isSmallScreen } = useWindowDimension();

const showNotification = ref(false);
const message = ref<FlashMessageItem | null>(null);
const showText = ref(false);
const restarting = computed(() => appStore.restarting);
const reconnecting = computed(() => !appStore.connected);

watch(
  () => msgStore.message,
  async (newMessage) => {
    if (message.value != null) {
      showNotification.value = false;
      await sleep(500);
    }

    if (newMessage == null) {
      showNotification.value = false;
    }

    message.value = newMessage;
    showNotification.value = true;

    if (isError.value == true) {
      openText();
    }
  },
);

// onMounted(async () => {
//   // DEMO
//   console.log('DEMO')
//   try {
//     await systemUpdateStorage.getUpdates(true);
//   } catch (e) {
//     addErrorBottom(e, 'software_update');
//   }
// });

const notificationStyle = computed(() => {
  if (!isError.value || message.value == null || !message.value.parent) {
    return "";
  }

  const parentElMeta = message.value.parent.getBoundingClientRect();
  if (parentElMeta.width == 0) {
    return "";
  }

  if (isErrorInitial.value) {
    return `left:${parentElMeta.left}px;width:${parentElMeta.width}px;top:${
      parentElMeta.top + parentElMeta.height - 50
    }px`;
  }

  return `left:${parentElMeta.left}px;width:${parentElMeta.width}px;`;
});

const mainClasses = computed(() => {
  let classList = "";
  if (message.value == null) {
    return "";
  }
  classList +=
    message.value && message.value.type
      ? `notification--${message.value.type.toLowerCase()} `
      : "";
  classList +=
    message.value && message.value.status
      ? `notification--${message.value.status.toLowerCase()} `
      : "";
  classList +=
    message.value && message.value.placement
      ? `notification--${message.value.placement.toLowerCase()} `
      : "";
  classList +=
    message.value && message.value.parent && notificationStyle.value.length > 0
      ? `notification--has-parent `
      : "";
  classList +=
    isFull.value == false &&
    isTop.value == false &&
    isSmallScreen.value == false
      ? "notification--low "
      : "";
  // classList += isSmallScreen.value == true && isTop.value == false ? 'notification--top notification--top--minimal ' : '';
  classList +=
    message.value?.type != FlashMessageType.error &&
    isFull.value == false &&
    isTop.value == false
      ? "notification--floating"
      : "";
  classList += showText.value == true ? "open " : "";
  return classList;
});

const isError = computed(() => {
  if (message.value == null || message.value.type == null) {
    return false;
  }
  return message.value?.type === FlashMessageType.error;
});

const isFull = computed(() => {
  if (message.value == null) {
    return false;
  }
  return message.value?.placement === FlashMessagePlacement.FULL;
});

const isTop = computed(() => {
  if (message.value == null) {
    return false;
  }
  return message.value?.placement === FlashMessagePlacement.TOP;
});

const isErrorInitial = computed(() => {
  if (message.value == null) {
    return false;
  }
  return (
    message.value?.placement === FlashMessagePlacement.INITIAL && isError.value
  );
});

const isTopOrBottom = computed(() => {
  if (message.value == null) {
    return false;
  }
  return (
    message.value?.placement === FlashMessagePlacement.BOTTOM ||
    message.value?.placement === FlashMessagePlacement.TOP
  );
});

const messageMeta = computed<FlashMessageDisplayMeta | null>(() => {
  if (message.value?.type === FlashMessageType.error) {
    return { icon: "fa-light fa-exclamation", color: "error" };
  } else if (message.value?.type === FlashMessageType.info) {
    if (message.value?.status === FlashMessageInfoStatus.SUCCESS) {
      return { icon: "fa-light fa-check", color: "success" };
    } else if (message.value?.status === FlashMessageInfoStatus.DOWNLOADING) {
      return { icon: "fa-light fa-cloud-arrow-down", color: "progress" };
    }
  }
  return null;
});

async function close() {
  if (showText.value) {
    showText.value = false;
    await sleep(400);
  } else {
    showText.value = false;
  }

  showNotification.value = false;
  hideMessage();
}

async function openText() {
  await sleep(300);
  showText.value = true;
}

function collapseText() {
  if (isError.value == true) {
    showText.value = !showText.value;
  }
}
</script>
<template>
  <Transition name="opacity">
    <div v-show="showNotification && !reconnecting">
      <!-- <Teleport v-if="isSmallScreen && isError && message" to="body">
        <div  class="notification-phone">
          <div class="notification-phone__body">
            <i class="notification-phone__icon fa-thin fa-exclamation" :class="messageMeta && messageMeta.icon || ''"></i>
            <p class="notification-phone__text">{{ message.message }}</p> 
            <button @click="close" class="button button--secondary button--full-w">{{ $t("ui.dismiss") }}</button>
          </div>
        </div>
      </Teleport> -->
      <Teleport
        v-if="message"
        :disabled="
          !isFull && !isTopOrBottom && !isSmallScreen && !isErrorInitial
        "
        to="body"
      >
        <div
          class="notification"
          :class="mainClasses"
          :style="notificationStyle"
        >
          <div v-if="isFull" class="notification__background"></div>
          <div class="notification__body">
            <div
              :class="`notification__icon--${messageMeta?.color}`"
              class="notification__icon"
              @click="collapseText()"
            >
              <img
                v-if="
                  message.status &&
                  (message.status == FlashMessageInfoStatus.SAVING ||
                    message.status == FlashMessageInfoStatus.LOADING)
                "
                src="/images/loading-indicator.png"
                alt="Loading"
                class="img-loading"
              />
              <i v-else :class="(messageMeta && messageMeta.icon) || ''"></i>
            </div>
            <Transition
              v-if="isError && message.message && message.message.length > 0"
              name="opacity"
            >
              <div v-show="showText" class="notification__text" title="">
                <p>{{ message.message }}</p>
                <button
                  class="button button--secondary button--icon button--icon--small button-close"
                  @click.prevent="close"
                >
                  <i class="fa-regular fa-close"></i>
                </button>
              </div>
            </Transition>
            <div v-else class="notification__text" title="">
              <p>
                <template
                  v-if="message.status == FlashMessageInfoStatus.SUCCESS"
                >
                  <template v-if="message.message && message.message.length">{{
                    message.message
                  }}</template>
                  <template v-else>{{
                    $t("notification.changes_saved")
                  }}</template>
                </template>
                <template
                  v-else-if="message.status == FlashMessageInfoStatus.SAVING"
                >
                  <template v-if="message.message && message.message.length">{{
                    message.message
                  }}</template>
                  <template v-else>{{
                    $t("notification.saving_changes")
                  }}</template>
                </template>
              </p>
            </div>
          </div>
        </div>
      </Teleport>
    </div>
  </Transition>
  <Teleport to="body">
    <Transition name="opacity">
      <div
        v-show="restarting || reconnecting"
        class="notification-reconnecting"
      >
        <div class="notification-reconnecting__badge">
          <img
            src="/images/loading-indicator.png"
            alt="Loading"
            class="img-loading"
          />
          <span v-if="restarting">{{
            $t("notification.restarting.title")
          }}</span>
          <span v-else>{{ $t("notification.reconnecting.title") }}</span>
        </div>
        <p
          v-if="reconnecting && !restarting"
          class="notification-reconnecting__info"
        >
          {{ $t("notification.reconnecting.info1") }}<br />
          {{ $t("notification.reconnecting.info2") }}
        </p>
      </div>
    </Transition>
  </Teleport>
</template>
