(function ucvrRouteRefreshBridge() {
  const BASE = String(window.__UCVR_BASE_PATH__ || "").replace(/\/$/, "");
  const nativeFetch = window.fetch.bind(window);
  const syncModePath = new URL(
    `${BASE}/api/cfg/sync_mode`,
    window.location.origin,
  ).pathname;
  const networkPath = new URL(
    `${BASE}/api/cfg/network`,
    window.location.origin,
  ).pathname;
  let route = "";
  let requestGeneration = 0;

  function requestUrl(input) {
    if (typeof input === "string") return new URL(input, window.location.href);
    if (input instanceof URL) return input;
    if (input instanceof Request) return new URL(input.url, window.location.href);
    return null;
  }

  function requestMethod(input, init) {
    return String(
      init?.method || (input instanceof Request ? input.method : "GET"),
    ).toUpperCase();
  }

  async function requestBody(input, init) {
    if (init?.body !== undefined && init.body !== null) {
      return typeof init.body === "string" ? init.body : String(init.body);
    }
    if (input instanceof Request) return input.clone().text();
    return "";
  }

  function jsonResponse(response, payload) {
    const headers = new Headers(response.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.delete("Content-Length");
    return new Response(JSON.stringify(payload ?? null), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  async function syncModeFetch(input, init = {}) {
    const method = requestMethod(input, init);
    const headers = new Headers(
      init.headers || (input instanceof Request ? input.headers : undefined),
    );
    const next = {
      ...init,
      method,
      headers,
      credentials:
        init.credentials ||
        (input instanceof Request ? input.credentials : "same-origin"),
    };

    if (method === "PATCH" || method === "PUT") {
      const raw = await requestBody(input, init);
      let patch = {};
      if (raw) {
        try {
          patch = JSON.parse(raw);
        } catch {
          return jsonResponse(
            new Response(null, { status: 400, statusText: "Bad Request" }),
            { error: "Invalid Sync Mode JSON body" },
          );
        }
      }
      next.method = "PATCH";
      next.body = JSON.stringify({ sync_mode: patch });
      headers.set("Content-Type", "application/json");
    } else {
      delete next.body;
    }

    const response = await nativeFetch(
      new URL(networkPath, window.location.origin).href,
      next,
    );
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    return jsonResponse(response, payload?.sync_mode ?? payload);
  }

  window.fetch = (input, init) => {
    const url = requestUrl(input);
    if (url?.origin === window.location.origin && url.pathname === syncModePath) {
      return syncModeFetch(input, init);
    }
    return nativeFetch(input, init);
  };

  function currentRoute() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }

  function remoteRouteActive() {
    const value = currentRoute().toLowerCase();
    return value.includes("remote-simulator") || value.includes("#/remote");
  }

  function removeUpdateIntegrationIcon(root = document) {
    root
      .querySelectorAll?.(
        'button i.fa-cloud-arrow-down, button .fa-cloud-arrow-down',
      )
      .forEach((icon) => icon.remove());
  }

  function applyLighting(settings) {
    const device = document.querySelector(".ucvr-sim-device");
    if (!device) return false;

    const display = settings?.display || {};
    const displayBrightness = Math.max(
      0,
      Math.min(100, Number(display.brightness ?? 70)),
    );
    device.style.setProperty(
      "--ucvr-display-brightness",
      (displayBrightness / 100).toFixed(3),
    );

    const button = settings?.button || {};
    const rawRgb = Array.isArray(button.static_color?.rgb)
      ? button.static_color.rgb
      : [255, 255, 255];
    const rgb = [0, 1, 2].map((index) =>
      Math.max(0, Math.min(255, Math.round(Number(rawRgb[index]) || 0))),
    );
    const buttonBrightness = Math.max(
      0,
      Math.min(100, Number(button.brightness ?? 70)),
    );
    device.style.setProperty("--ucvr-button-backlight-rgb", rgb.join(" "));
    device.style.setProperty(
      "--ucvr-button-backlight-opacity",
      (buttonBrightness / 100).toFixed(3),
    );
    return true;
  }

  async function refreshLighting() {
    if (!remoteRouteActive()) return;
    const generation = ++requestGeneration;
    try {
      const response = await nativeFetch(`${BASE}/api/simulator`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) return;
      const settings = await response.json();
      if (generation !== requestGeneration) return;
      if (!applyLighting(settings)) {
        window.setTimeout(() => {
          if (generation === requestGeneration) applyLighting(settings);
        }, 100);
      }
    } catch {
      // The main simulator runtime owns user-visible error reporting.
    }
  }

  function synchronize(force = false) {
    removeUpdateIntegrationIcon();
    const next = currentRoute();
    const changed = next !== route;
    route = next;
    if ((changed || force) && remoteRouteActive()) refreshLighting();
  }

  window.addEventListener("hashchange", () => synchronize(true));
  window.addEventListener("popstate", () => synchronize(true));

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) removeUpdateIntegrationIcon(node);
      }
    }
    synchronize(false);
  });

  const start = () => {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    synchronize(true);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
