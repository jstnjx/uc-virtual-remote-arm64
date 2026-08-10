/*
 * Modified by Justin Jäger for the Unfolded.Tools Remote Simulator.
 * Modified build first published: 2026-08-03.
 * Licensed as part of the modified Web Configurator under GNU GPL v3.0 only.
 * See /remote-simulator/licensing/modifications.md for details.
 */
(() => {
  const configuredBasePath = "__UCVR_SESSION_BASE__";
  const hostedSession = Boolean(
    configuredBasePath
      && !/__UCVR_[A-Z0-9_]+__/.test(configuredBasePath),
  );
  const ingressMatch = String(window.location?.pathname || "").match(
    /^(\/api\/hassio_ingress\/[^/]+)/,
  );
  const ingressBasePath = ingressMatch?.[1] || "";
  const basePath = hostedSession
    ? `/${configuredBasePath.split("/").filter(Boolean).join("/")}`
    : ingressBasePath;
  const sessionKey = hostedSession
    ? basePath.split("/").filter(Boolean).pop() || "default"
    : ingressBasePath
      ? "home-assistant-ingress"
      : "self-hosted";
  const blockedRoutes = hostedSession
    ? Object.freeze([
        "wifi-bluetooth",
        "application-credentials",
        "development",
        "factory-reset",
      ])
    : Object.freeze([]);

  Object.defineProperty(window, "__UCVR_BASE_PATH__", {
    value: basePath,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  Object.defineProperty(window, "__UCVR_SIMULATOR__", {
    value: Object.freeze({
      enabled: true,
      public: hostedSession,
      mode: "remote3",
      sessionKey,
      basePath,
      blockedRoutes,
    }),
    configurable: false,
    enumerable: false,
    writable: false,
  });

  if (hostedSession) {
    document.documentElement.classList.add("ucvr-public-simulator");
    addEventListener(
      "DOMContentLoaded",
      () => document.body.classList.add("ucvr-public-simulator"),
      { once: true },
    );
  }
})();
