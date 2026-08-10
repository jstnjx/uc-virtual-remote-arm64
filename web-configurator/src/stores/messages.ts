import { defineStore } from "pinia";

import type { FlashMessageItem } from "@/types/flashMessages";
import {
  FlashMessageType,
  FlashMessageInfoStatus,
  FlashMessagePlacement,
} from "@/types/enums";
import { useTiming } from "@/composables/timing";
import { getErrorMessage } from "@/composables/error";

let store: any;
export function showMessage(item: FlashMessageItem) {
  if (!store) {
    store = messagesStore();
  }
  store.show(item);
}

async function setHideTimer() {
  await useTiming().sleep(2000);
  hideMessage();
}

function addError(
  m: unknown,
  placement: FlashMessagePlacement = FlashMessagePlacement.BOTTOM,
  translationKey: string | null = "",
  parentEl?: HTMLElement,
) {
  const errMessage = getErrorMessage(m, translationKey);

  showMessage({
    ...errMessage,
    type: FlashMessageType.error,
    timeout: -1,
    placement: placement,
    ...(parentEl && { parent: parentEl }),
  });
}

export async function addInfo(
  status: FlashMessageInfoStatus,
  placement: FlashMessagePlacement = FlashMessagePlacement.INITIAL,
  message?: string,
) {
  if (status == FlashMessageInfoStatus.SUCCESS) {
    // await useTiming().sleep(200);
    setHideTimer();
  }

  showMessage({
    status: status,
    id: "info",
    type: FlashMessageType.info,
    placement: placement,
    ...(message && { message: message }),
  } as FlashMessageItem);
}

export async function showLoading() {
  showMessage({
    status: FlashMessageInfoStatus.LOADING,
    id: "info",
    type: FlashMessageType.info,
    placement: FlashMessagePlacement.FULL,
  } as FlashMessageItem);
}

/**
 * @param translationKey - Translation key without ending: '.error_status' or '.error_code'. For example: 'macro.settings.update' => add to translations: 'macro.settings.update.error_status'
 * */
export function addErrorFull(message: unknown, translationKey?: string | null) {
  addError(message, FlashMessagePlacement.FULL, translationKey);
}

/**
 * @param translationKey - Translation key without ending: '.error_status' or '.error_code'. For example: 'macro.settings.update' => add to translations: 'macro.settings.update.error_status'
 * */
export function addErrorBase(
  message: unknown,
  translationKey?: string | null,
  parentEl?: HTMLElement,
) {
  addError(message, FlashMessagePlacement.INITIAL, translationKey, parentEl);
}

/**
 * @param translationKey - Translation key without ending: '.error_status' or '.error_code'. For example: 'macro.settings.update' => add to translations: 'macro.settings.update.error_status'
 * */
export function addErrorTop(message: unknown) {
  addError(message, FlashMessagePlacement.TOP);
}

/**
 * @param translationKey - Translation key without ending: '.error_status' or '.error_code'. For example: 'macro.settings.update' => add to translations: 'macro.settings.update.error_status'
 * */
export function addErrorBottom(
  message: unknown,
  translationKey?: string | null,
  parentEl?: HTMLElement,
) {
  addError(message, FlashMessagePlacement.BOTTOM, translationKey, parentEl);
}

export function addInfoFull(status: FlashMessageInfoStatus, message?: string) {
  addInfo(status, FlashMessagePlacement.FULL, message);
}

export function addInfoTop(status: FlashMessageInfoStatus, message?: string) {
  addInfo(status, FlashMessagePlacement.TOP, message);
}

export function hideMessage() {
  if (store) {
    store.hide();
  }
}

export const messagesStore = defineStore("messages", {
  state: () => ({
    message: <FlashMessageItem | null>null,
    connected: true,
  }),
  actions: {
    show(item: FlashMessageItem) {
      const date = new Date();
      const newMessage = {
        id: null,
        timeout: 800000,
        closeable: true,
        ...item,
      } as FlashMessageItem;

      if (this.message != null) {
        this.hide();
      }

      if (!newMessage.id) {
        newMessage.id = date.getTime() + "." + date.getMilliseconds();
      }
      if (!newMessage.timeout) {
        newMessage.timeout = 8000;
      }
      if (typeof newMessage.closeable === "undefined") {
        newMessage.closeable = true;
      }

      this.message = item;
    },

    hide() {
      this.message = null;
    },

    // error(message: FlashMessageData) {
    //   this.show({
    //     ...message,
    //     type: FlashMessageType.error,
    //   });
    // },

    // info(message: FlashMessageData) {
    //   this.show({
    //     ...message,
    //     type: FlashMessageType.info,
    //   });
    // },
  },
});
