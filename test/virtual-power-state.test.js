import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  VIRTUAL_POWER_MODE,
  virtualBatteryStatus,
  virtualPowerModeStatus,
  virtualRestPowerStatus,
} from "../src/core/virtual-power.js";

function source(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("virtual Remote power contract is permanently awake and externally powered", () => {
  assert.equal(VIRTUAL_POWER_MODE, "NORMAL");
  assert.deepEqual(virtualBatteryStatus(), {
    capacity: 100,
    status: "CHARGING",
    power_supply: true,
  });
  assert.deepEqual(virtualPowerModeStatus(), {
    mode: "NORMAL",
    battery: {
      capacity: 100,
      status: "CHARGING",
      power_supply: true,
    },
  });
  assert.deepEqual(virtualRestPowerStatus(), {
    mode: "NORMAL",
    power_supply: true,
    standby_timeout_sec: 0,
    standby_inhibitors: false,
  });
});

test("REST and WebSocket power APIs enforce the always-awake contract", () => {
  const server = source("src/api/server.js");
  const websocket = source("src/core/websocket-facade.js");

  assert.match(server, /virtualRestPowerStatus\(\)/);
  assert.match(server, /virtualBatteryStatus\(\)/);
  assert.match(websocket, /const next = virtualPowerModeStatus\(\)/);
  assert.match(websocket, /const current = virtualPowerModeStatus\(\)/);

  assert.doesNotMatch(
    websocket,
    /mode: command === "STANDBY" \? "SUSPEND" : "LOW_POWER"/,
  );
});

test("Web Configurator does not mislabel generic WebSocket loss as device sleep", () => {
  const status = source(
    "web-configurator/src/components/elements/RemoteStatus.vue",
  );

  assert.match(status, /RemoteStatus: WebSocket disconnected/);
  assert.doesNotMatch(status, /RemoteStatus: Device going to sleep/);
});
