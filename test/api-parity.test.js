import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("platform advertises the implemented current API generations", () => {
  const platform = source("src/platform.js");
  assert.match(platform, /restCoreApiVersion = "0\.46\.0"/);
  assert.match(platform, /coreWebSocketApiVersion = "0\.35\.3-beta"/);
  assert.match(platform, /integrationApiVersion = "0\.15\.4-beta"/);
  assert.match(platform, /"voice_assistant"/);
});

test("current REST compatibility covers voice and the post-0.32 log web-app API", () => {
  const rest = source("src/api/rest-current-compatibility.js");
  for (const marker of [
    "/api/cfg/voice_control/voice_assistants",
    "/api/cfg/entity/commands",
    "/api/system/logs/web",
    "/api/resources/BtDeviceProfile",
  ]) assert.match(rest, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(rest, /password_hash/);
});

test("current WebSocket compatibility covers new configuration, profile, Dock, Bluetooth and Wi-Fi messages", () => {
  const parity = source("src/api/api-parity-compatibility.js");
  const hardware = source("src/api/ws-hardware-compatibility.js");
  for (const marker of [
    "get_voice_assistants",
    "reset_network_cfg",
    "get_battery_charger",
    "create_standby_inhibitor",
    "bt_pairing_response",
    "active_profile_change",
    "dock_port_mode",
    "execute_entity_command",
  ]) assert.match(parity, new RegExp(marker));
  for (const marker of [
    "get_wifi_status",
    "wifi_command",
    "wifi_scan_start",
    "wifi_scan_stop",
    "get_wifi_scan_status",
    "get_all_wifi_networks",
    "add_wifi_network",
    "del_all_wifi_networks",
    "get_wifi_network",
    "update_wifi_network",
    "wifi_network_command",
    "del_wifi_network",
  ]) assert.match(hardware, new RegExp(marker));
});

test("voice and Bluetooth HID runtime dependencies are built into the appliance", () => {
  const dockerfile = source("Dockerfile");
  for (const dependency of ["ffmpeg", "python3-dbus", "python3-gi", "bluez"]) {
    assert.match(dockerfile, new RegExp(`\\b${dependency}\\b`));
  }
  const index = source("src/index.js");
  assert.match(index, /installApiParityCompatibility\(\)/);
  assert.match(index, /installCurrentHardwareWebSocketCompatibility\(\)/);
  assert.match(index, /installCurrentRestCompatibility\(\)/);
});

test("Integration API handles assistant events and runtime-info requests", () => {
  const manager = source("src/integrations/manager.js");
  assert.match(manager, /assistant_event/);
  assert.match(manager, /get_runtime_info/);
});
