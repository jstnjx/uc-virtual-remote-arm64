import type { App } from "vue";
import i18next from "../i18next";

import type { ApiErrorMessage } from "@/types/flashMessages";
import { addErrorBase, addErrorBottom } from "@/stores/messages";
import ApiConnection from "@/api";

function logError(origin: string, err: unknown, ...detail: unknown[]) {
  console.groupCollapsed(`[${origin}]`);
  console.error(err);
  for (const d of detail) {
    console.log(d);
  }
  console.groupEnd();
}

function flashError(err: unknown) {
  if (err && typeof err === "object" && ("response" in err || "code" in err)) {
    // API/axios-shaped error: getErrorMessage maps it to a translated
    // status/code message inside addError.
    addErrorBottom(err as ApiErrorMessage);
  } else if (err instanceof Error && err.message) {
    addErrorBottom(err.message);
  } else {
    addErrorBottom(i18next.t("error.unknown_error"));
  }
}

/**
 * App-wide error channel: errors escaping component code (render, watchers,
 * lifecycle hooks and event handlers, including rejected async handlers) are
 * logged and surfaced as a flash message instead of dying in the console.
 * Aborted requests are not failures and stay silent. Promise rejections
 * outside Vue's reach are only logged — background work must not interrupt
 * the UI with a toast.
 */
export function installGlobalErrorHandlers(app: App) {
  app.config.errorHandler = (err, instance, info) => {
    logError(`VueError: ${info}`, err, instance);
    if (!ApiConnection.rest().isCancelError(err)) {
      flashError(err);
    }
  };

  window.addEventListener("unhandledrejection", (event) => {
    logError("UnhandledRejection", event.reason);
  });
}

/**
 * Loose shape of the error objects this app catches — REST/axios failures and
 * the occasional custom throw. Every field is optional: it is a *view* over an
 * `unknown` catch value, so reads stay guarded and missing fields are undefined.
 */
export type CaughtError = {
  message?: string;
  code?: string;
  status?: number;
  response?: {
    status?: number;
    data?: { code?: string; message?: string; errors?: unknown[] };
  };
};

/**
 * Narrow an `unknown` `catch` value to {@link CaughtError} for property access.
 * Non-objects (thrown strings, etc.) collapse to `{}` so every read is safe.
 */
export function asError(e: unknown): CaughtError {
  return e && typeof e === "object" ? (e as CaughtError) : {};
}

/**
 * @param translationKey - Translation key without ending: '.error_status' or '.error_code'. For example: 'macro.settings.update' => add to translations: 'macro.settings.update.error_status'
 * */
export function getErrorMessage(
  error: unknown,
  translationKey: string | null = null,
): { message: string } {
  let message = i18next.t("error.unknown_error");

  if (!error) {
    return { message: message };
  }

  if (typeof error === "string") {
    return { message: error };
  }

  // Only object-shaped errors carry the code/response metadata below; anything
  // else (numbers, symbols, a bare FlashMessageData with just a message) falls
  // back to the generic text, matching the previous union-typed behaviour.
  if (typeof error !== "object") {
    return { message: message };
  }
  const m = error as ApiErrorMessage;

  if (
    "code" in m &&
    m.code === "ECONNABORTED" &&
    typeof m.message === "string" &&
    m.message.includes("timeout")
  ) {
    return { message: i18next.t("error.HAS_TIMEOUT") };
  }

  if ("code" in m && i18next.exists("api_errors.generic_error")) {
    message = `${i18next.t("api_errors.generic_error")}${m.code}`;
  }

  if ("response" in m) {
    const { response } = m;
    const responseCode = response?.data?.code;
    const responseStatus = response?.status;

    if (translationKey != null && response) {
      if (
        responseCode &&
        i18next.exists(`${translationKey}.error_code.${responseCode}`)
      ) {
        message = i18next.t(`${translationKey}.error_code.${responseCode}`);
      } else if (
        responseStatus &&
        i18next.exists(`${translationKey}.error_status.${responseStatus}`)
      ) {
        message = i18next.t(`${translationKey}.error_status.${responseStatus}`);
      } else if (
        responseStatus &&
        i18next.exists(`api_errors.error_status.${responseStatus}`)
      ) {
        message = i18next.t(`api_errors.error_status.${responseStatus}`);
      }
    } else if (
      response &&
      responseStatus &&
      i18next.exists(`api_errors.error_status.${responseStatus}`)
    ) {
      message = i18next.t(`api_errors.error_status.${responseStatus}`);
    }
  }

  return { message: message || "" };
}

export function errorOnChange(e: unknown) {
  addErrorBase(e);
}
