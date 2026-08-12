import { CoreWebSocketFacade } from "../core/websocket-facade.js";
import { sha256 } from "../shared/util.js";

function validToken(platform, token) {
  if (!platform || !token) return false;
  if (platform.adminToken && token === platform.adminToken) return true;
  if (platform.coreToken && token === platform.coreToken) return true;
  return Boolean(platform.db.findApiKey(sha256(String(token))));
}

function response(peer, id, msg, data = undefined, code = 200) {
  const payload = { kind: "resp", req_id: Number(id), msg, code };
  if (data !== undefined) payload.msg_data = data;
  peer.send(JSON.stringify(payload));
}

function result(peer, id, data = {}) {
  response(peer, id, "result", data);
}

function networkId(data) {
  return Number(data.id ?? data.network_id ?? data.networkId);
}

function publicWifiNetworks(hardware) {
  return hardware.savedWifiNetworks().map((item) => hardware.getWifiNetwork(item.id)).filter(Boolean);
}

async function dispatch(platform, peer, id, msg, data) {
  const hardware = platform.hardware;
  switch (msg) {
    case "get_wifi_status":
      response(peer, id, "wifi_status", await hardware.wifiStatus());
      return true;
    case "wifi_command":
      result(peer, id, await hardware.wifiCommand(data.command || data.cmd_id || data.cmd));
      return true;
    case "wifi_scan_start":
      await hardware.scanWifi();
      response(peer, id, "wifi_scan_status", hardware.wifiScanStatus());
      return true;
    case "wifi_scan_stop":
      response(peer, id, "wifi_scan_status", hardware.stopWifiScan());
      return true;
    case "get_wifi_scan_status":
      response(peer, id, "wifi_scan_status", hardware.wifiScanStatus());
      return true;
    case "get_all_wifi_networks":
      response(peer, id, "wifi_networks", { networks: publicWifiNetworks(hardware) });
      return true;
    case "add_wifi_network":
      response(peer, id, "wifi_network", await hardware.addWifiNetwork(data), 201);
      return true;
    case "del_all_wifi_networks":
      result(peer, id, { deleted: await hardware.deleteAllWifiNetworks() });
      return true;
    case "get_wifi_network": {
      const value = hardware.getWifiNetwork(networkId(data));
      if (!value) throw Object.assign(new Error("Wi-Fi network not found"), { status: 404 });
      response(peer, id, "wifi_network", value);
      return true;
    }
    case "update_wifi_network": {
      const value = await hardware.updateWifiNetwork(networkId(data), data);
      if (!value) throw Object.assign(new Error("Wi-Fi network not found"), { status: 404 });
      response(peer, id, "wifi_network", value);
      return true;
    }
    case "wifi_network_command": {
      const value = await hardware.wifiNetworkCommand(networkId(data), data.command || data.cmd_id || data.cmd);
      if (!value) throw Object.assign(new Error("Wi-Fi network not found"), { status: 404 });
      result(peer, id, value);
      return true;
    }
    case "del_wifi_network": {
      const deleted = await hardware.deleteWifiNetwork(networkId(data));
      if (!deleted) throw Object.assign(new Error("Wi-Fi network not found"), { status: 404 });
      result(peer, id, {});
      return true;
    }
    default:
      return false;
  }
}

export function installCurrentHardwareWebSocketCompatibility() {
  if (CoreWebSocketFacade.prototype.attach.__ucvrCurrentHardware) return;
  const previousAttach = CoreWebSocketFacade.prototype.attach;

  const attach = function attach(peer, options = {}) {
    const before = new Set(peer.listeners("message"));
    previousAttach.call(this, peer, options);
    const previousListener = peer.listeners("message").find((listener) => !before.has(listener));
    if (!previousListener) return;
    peer.removeListener("message", previousListener);

    const platform = this.platform;
    let authenticated = Boolean(options.authenticated) || validToken(platform, options.token);
    peer.on("message", async (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); }
      catch { return previousListener(raw); }
      if (message?.kind !== "req") return previousListener(raw);
      const msg = String(message.msg || "").trim().toLowerCase();
      const data = message.msg_data && typeof message.msg_data === "object" ? message.msg_data : {};
      if (msg === "auth") {
        if (validToken(platform, data.token)) authenticated = true;
        return previousListener(raw);
      }
      if (!authenticated) return previousListener(raw);
      try {
        if (await dispatch(platform, peer, message.id, msg, data)) return;
      } catch (error) {
        response(peer, message.id, "result", {
          code: error?.status === 404 ? "NOT_FOUND" : "ERROR",
          message: error?.message || "Hardware request failed",
        }, Number(error?.status || 500));
        return;
      }
      return previousListener(raw);
    });
  };

  Object.defineProperty(attach, "__ucvrCurrentHardware", { value: true });
  CoreWebSocketFacade.prototype.attach = attach;
}
