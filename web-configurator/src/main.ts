import { createApp } from "vue";
import { createPinia } from "pinia";

import App from "./App.vue";
import router from "./composables/router";
import i18next, { applyLanguage, restoreLanguage } from "./i18next";
import I18NextVue from "i18next-vue";
import { configStore } from "@/stores/config";

import ApiConnection from "@/api";
import { connectionMonitor } from "@/api/monitor";

import overflowIndicator from "@/directives/overflowIndicator.js";
import markdownToolsDirective from "@/directives/markdownTools.js";
import clickOutside from "@/directives/clickOutside.js";
import { installGlobalErrorHandlers } from "@/composables/error";
import { installChunkRecovery } from "@/composables/chunkRecovery";

const simulatorBasePath = String(
  (window as Window & { __UCVR_BASE_PATH__?: string }).__UCVR_BASE_PATH__ || "",
).replace(/\/$/, "");
const simulatorArtworkStyle = document.createElement("style");
simulatorArtworkStyle.id = "ucvr-simulator-device-artwork";
simulatorArtworkStyle.textContent = `
  .ucvr-sim-device.remote-controller--v3 .remote-controller__device,
  .ucvr-sim-device.remote-controller--v3--d .remote-controller__device {
    background-image: url("${simulatorBasePath}/configurator/images/remote-3-dark-front-backlight.webp") !important;
    background-position: top center;
    background-repeat: no-repeat;
    background-size: cover;
  }
`;
document.head.appendChild(simulatorArtworkStyle);

const app = createApp(App);
installGlobalErrorHandlers(app);
app.use(createPinia());
app.use(router);
// Lazy route chunks are fetched on navigation; a lost request must not leave
// the app on a dead route (#674).
installChunkRecovery(router);

// Apply the device's configured language whenever the config store's
// language_code changes — on startup, on WebSocket-driven config updates, and on
// full-config replacements (this deep subscription fires for all of them). Live
// in-settings switches additionally apply the language directly in
// SettingsLocalization for instant feedback, without waiting for the REST → WS
// round-trip; this subscription is the general/fallback path.
const config = configStore();
config.$subscribe((mutation, state) => {
  const locale: string = state?.config?.localization?.language_code || "";
  if (locale) {
    void applyLanguage(locale);
  }
});
app.use(I18NextVue, { i18next });

app.directive("overflow-indicator", overflowIndicator);
app.directive("markdownTools", markdownToolsDirective);
app.directive("click-outside", clickOutside);

// The device config only arrives after auth and a REST round-trip, so mounting
// straight away would first render every screen in the fallback language and
// correct it later. Anything that reads a translation once instead of re-reading
// it on `languageChanged` would keep that English text for good. Restoring
// the previous session's language before the first render removes that window;
// restoreLanguage never rejects, so a failed chunk fetch still mounts the app.
void restoreLanguage().then(() => {
  app.mount("#app");
});

// @ts-ignore
window.UC = {
  app,
  api: ApiConnection,
  connectionMonitor,
};
