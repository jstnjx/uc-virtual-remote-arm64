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
  ]) assert.ok(rest.includes(marker), `missing REST parity marker ${marker}`);
  assert.match(rest, /password_hash/);
});

test("current WebSocket compatibility covers new configuration, profile, Dock and Bluetooth messages", () => {
  const parity = source("src/api/api-parity-compatibility.js");
  for (const marker of [
    "get_voice_assistants",
    "reset_network_cfg",
    "get_battery_charger",
    "bt_pairing_response",
    "active_profile_change",
    "dock_port_mode",
    "execute_entity_command",
  ]) assert.ok(parity.includes(marker), `missing WS parity marker ${marker}`);
});

test("native Core WebSocket facade covers Wi-Fi and standby management", () => {
  const websocket = source("src/core/websocket-facade.js");
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
    "create_standby_inhibitor",
    "del_standby_inhibitor",
    "del_all_standby_inhibitors",
  ]) assert.ok(websocket.includes(marker), `missing native Core WS marker ${marker}`);
});

test("voice and Bluetooth HID runtime dependencies are built into the appliance", () => {
  const dockerfile = source("Dockerfile");
  for (const dependency of ["ffmpeg", "python3-dbus", "python3-gi", "bluez"]) {
    assert.ok(dockerfile.includes(dependency), `missing runtime dependency ${dependency}`);
  }
  const index = source("src/index.js");
  assert.match(index, /installApiParityCompatibility\(\)/);
  assert.match(index, /installCurrentRestCompatibility\(\)/);
  assert.match(index, /installIntegrationRuntimeInfoCompatibility\(\)/);
});

test("Integration API handles assistant events and runtime-info requests", () => {
  const manager = source("src/integrations/manager.js");
  const connection = source("src/integrations/connection.js");
  const runtimeCompatibility = source("src/integrations/runtime-info-compatibility.js");
  assert.match(manager, /assistant_event/);
  assert.match(connection, /get_runtime_info/);
  assert.match(connection, /runtime_info/);
  assert.match(runtimeCompatibility, /driver_id/);
  assert.match(runtimeCompatibility, /intg_ids/);
  assert.match(runtimeCompatibility, /log_id/);
});
