import assert from "node:assert/strict";
import test from "node:test";
import { installCurrentDockApiCompatibility } from "../src/docks/current-api-compatibility.js";
import { DockService } from "../src/docks/service.js";

test("current Dock SET_VOLUME command persists bounded volume and emits state", () => {
  installCurrentDockApiCompatibility();
  const published = [];
  const logs = [];
  const dock = { dock_id: "dock-1", id: "dock-1", state: "ACTIVE", volume: 20 };
  const service = Object.create(DockService.prototype);
  service.platform = { events: { publish: (...args) => published.push(args) } };
  service.get = (id) => id === "dock-1" ? dock : null;
  service.save = (value) => value;
  service.logOutput = (...args) => logs.push(args);

  const result = service.command("dock-1", { command: "SET_VOLUME", volume: 73 });
  assert.deepEqual(result, { code: "OK", volume: 73 });
  assert.equal(dock.volume, 73);
  assert.equal(logs.length, 1);
  assert.equal(published.at(-1)[0], "dock.state");
  assert.equal(published.at(-1)[1].volume, 73);
});

test("current Dock SET_VOLUME clamps the supported range", () => {
  installCurrentDockApiCompatibility();
  const dock = { dock_id: "dock-1", id: "dock-1", state: "ACTIVE" };
  const service = Object.create(DockService.prototype);
  service.platform = { events: { publish() {} } };
  service.get = () => dock;
  service.save = (value) => value;
  service.logOutput = () => {};
  assert.equal(service.command("dock-1", { cmd_id: "SET_VOLUME", value: 150 }).volume, 100);
  assert.equal(service.command("dock-1", { cmd_id: "SET_VOLUME", value: -5 }).volume, 0);
});
