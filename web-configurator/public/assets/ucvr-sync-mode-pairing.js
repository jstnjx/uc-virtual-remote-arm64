(function ucvrSyncModePairingPanel() {
  const BASE = String(window.__UCVR_BASE_PATH__ || "").replace(/\/$/, "");
  const API = `${BASE}/api/cfg/sync_mode`;
  const PANEL_ID = "ucvr-sync-mode-pairing";

  function syncModeRouteActive() {
    return String(window.location.hash || "").toLowerCase().includes("settings/sync-mode");
  }

  function element(tag, attributes = {}, text = "") {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "class") node.className = value;
      else if (key === "type") node.type = value;
      else if (key === "placeholder") node.placeholder = value;
      else node.setAttribute(key, value);
    }
    if (text) node.textContent = text;
    return node;
  }

  async function pairSatellite(panel) {
    const address = panel.querySelector('[data-field="address"]');
    const token = panel.querySelector('[data-field="token"]');
    const name = panel.querySelector('[data-field="name"]');
    const button = panel.querySelector("button");
    const status = panel.querySelector('[data-field="status"]');

    const url = String(address?.value || "").trim();
    const pairingToken = String(token?.value || "").trim();
    if (!url || !pairingToken) {
      status.textContent = "Enter the Satellite agent address and pairing token.";
      status.dataset.error = "true";
      return;
    }

    button.disabled = true;
    status.textContent = "Pairing Satellite…";
    status.dataset.error = "false";
    try {
      const response = await fetch(API, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pair-satellite",
          satellite: {
            url,
            token: pairingToken,
            name: String(name?.value || "").trim(),
          },
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
      }
      status.textContent = "Pairing started. Satellite status will refresh automatically.";
      token.value = "";
      window.setTimeout(() => {
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }, 750);
    } catch (error) {
      status.textContent = error.message || String(error);
      status.dataset.error = "true";
    } finally {
      button.disabled = false;
    }
  }

  function installStyles() {
    if (document.getElementById(`${PANEL_ID}-style`)) return;
    const style = element("style", { id: `${PANEL_ID}-style` });
    style.textContent = `
      #${PANEL_ID} { margin-top: 18px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,.1); }
      #${PANEL_ID} h3 { margin: 0 0 6px; }
      #${PANEL_ID} p { margin: 0 0 14px; opacity: .75; line-height: 1.45; }
      #${PANEL_ID} .ucvr-sync-pair-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      #${PANEL_ID} label { display: grid; gap: 6px; font-size: 13px; }
      #${PANEL_ID} label:first-child { grid-column: 1 / -1; }
      #${PANEL_ID} input { min-height: 42px; width: 100%; padding: 8px 11px; color: inherit; border: 1px solid rgba(255,255,255,.15); border-radius: 9px; background: rgba(0,0,0,.18); }
      #${PANEL_ID} .ucvr-sync-pair-actions { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
      #${PANEL_ID} [data-field="status"] { font-size: 13px; opacity: .8; }
      #${PANEL_ID} [data-field="status"][data-error="true"] { color: #ff9b9b; opacity: 1; }
      @media (max-width: 800px) { #${PANEL_ID} .ucvr-sync-pair-grid { grid-template-columns: 1fr; } #${PANEL_ID} label:first-child { grid-column: auto; } }
    `;
    document.head.appendChild(style);
  }

  function mount() {
    if (!syncModeRouteActive() || document.getElementById(PANEL_ID)) return;
    const heading = [...document.querySelectorAll(".sync-card h2")].find(
      (node) => node.textContent?.trim() === "Satellite remotes",
    );
    const card = heading?.closest(".sync-card");
    if (!card) return;

    installStyles();
    const panel = element("div", { id: PANEL_ID });
    panel.appendChild(element("h3", {}, "Pair a Remote"));
    panel.appendChild(
      element(
        "p",
        {},
        "On the physical Remote, open UC Remote Sync and choose Satellite mode. Enter the address and pairing token shown there.",
      ),
    );

    const grid = element("div", { class: "ucvr-sync-pair-grid" });
    const addressLabel = element("label");
    addressLabel.appendChild(element("span", {}, "Remote address"));
    addressLabel.appendChild(
      element("input", {
        type: "text",
        placeholder: "192.168.1.50:11081",
        "data-field": "address",
      }),
    );
    const nameLabel = element("label");
    nameLabel.appendChild(element("span", {}, "Friendly name"));
    nameLabel.appendChild(
      element("input", {
        type: "text",
        placeholder: "Living Room Remote",
        "data-field": "name",
      }),
    );
    const tokenLabel = element("label");
    tokenLabel.appendChild(element("span", {}, "Pairing token"));
    tokenLabel.appendChild(
      element("input", {
        type: "password",
        placeholder: "Token displayed by the Satellite",
        "data-field": "token",
      }),
    );
    grid.append(addressLabel, nameLabel, tokenLabel);
    panel.appendChild(grid);

    const actions = element("div", { class: "ucvr-sync-pair-actions" });
    const button = element("button", { class: "button", type: "button" }, "Pair Remote");
    const status = element("span", { "data-field": "status", "aria-live": "polite" });
    button.addEventListener("click", () => pairSatellite(panel));
    actions.append(button, status);
    panel.appendChild(actions);
    card.appendChild(panel);
  }

  const observer = new MutationObserver(mount);
  const start = () => {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    mount();
  };
  window.addEventListener("hashchange", mount);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
