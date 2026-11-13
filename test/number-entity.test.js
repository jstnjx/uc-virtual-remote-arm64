import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEntityOptionsUpdate,
  clampNumber,
  driverOptions,
  mergeDriverOptions,
  normalizeNumberItem,
  normalizeSliderItem,
  numberDecimals,
  numberOptions,
  numberRepresentation,
  validateFeatureTarget,
} from "../src/core/entity-options.js";
import { entityCommandIds } from "../src/core/device-metadata.js";
import { sortItems } from "../src/core/models.js";
import { WS_REST_MESSAGES } from "../src/core/websocket-rest-bridge.js";
import { sequenceReadiness } from "../src/engine/readiness.js";
import { BackupJobService } from "../src/system-backup/jobs.js";

test("number options apply the Core-API defaults and device class units", () => {
  assert.deepEqual(numberOptions({}), { min: 0, max: 100, step: 1, display_mode: "auto", readable: true });
  const unbounded = numberOptions({ min: null, max: null, step: 0.5, decimals: 1 }, "temperature");
  assert.equal(unbounded.min, null);
  assert.equal(unbounded.max, null);
  assert.equal(unbounded.decimals, 1);
  assert.ok(unbounded.unit, "temperature device class provides a default unit");
  assert.equal(numberOptions({ unit: "dB" }, "temperature").unit, "dB");
});

test("number values are clamped without floating point artifacts", () => {
  assert.equal(clampNumber(99, { min: -10, max: 10 }), 10);
  assert.equal(clampNumber(-99, { min: -10, max: 10 }), -10);
  assert.equal(clampNumber(0.1 + 0.2, { min: 0, max: 1 }), 0.3);
  assert.equal(clampNumber(1e9, { min: 0, max: null }), 1e9);
  assert.equal(clampNumber("abc", {}), null);
});

test("number representation follows widget, user override, entity and auto rules", () => {
  const entity = { entity_type: "number", options: { min: 0, max: 100, step: 1 } };
  assert.equal(numberRepresentation(entity), "slider");
  assert.equal(numberRepresentation({ ...entity, options: { min: 0, max: 1000, step: 1 } }), "stepper");
  assert.equal(numberRepresentation({ ...entity, options: { ...entity.options, display_mode: "stepper" } }), "stepper");
  assert.equal(numberRepresentation({ ...entity, options: { ...entity.options, display_mode: "stepper", user: { display_mode: "slider" } } }), "slider");
  assert.equal(numberRepresentation({ ...entity, options: { ...entity.options, user: { display_mode: "slider" } } }, "stepper"), "stepper");
  assert.equal(numberRepresentation({ ...entity, options: { min: null, max: 10 } }, "slider"), "stepper");
});

test("number decimals prefer the user override, then options, then step precision", () => {
  assert.equal(numberDecimals({ options: { step: 0.25 } }), 2);
  assert.equal(numberDecimals({ options: { step: 0.25, decimals: 1 } }), 1);
  assert.equal(numberDecimals({ options: { step: 0.25, decimals: 1, user: { decimals: 3 } } }), 3);
});

test("entity option updates only change user overrides and validate them", () => {
  const entity = { entity_type: "number", options: { min: 0, max: 10, step: 1 } };
  const updated = applyEntityOptionsUpdate(entity, { user: { decimals: 2, display_mode: "stepper", bogus: 1 }, min: 5 });
  assert.deepEqual(updated, { min: 0, max: 10, step: 1, user: { decimals: 2, display_mode: "stepper" } });
  const partial = applyEntityOptionsUpdate({ ...entity, options: updated }, { user: { decimals: null } });
  assert.deepEqual(partial.user, { display_mode: "stepper" });
  assert.equal(applyEntityOptionsUpdate({ ...entity, options: updated }, { user: null }).user, undefined);
  assert.throws(() => applyEntityOptionsUpdate(entity, { user: { decimals: 7 } }), { status: 422 });
  assert.throws(() => applyEntityOptionsUpdate(entity, { user: { display_mode: "dial" } }), { status: 422 });
  const sensor = applyEntityOptionsUpdate({ entity_type: "sensor", options: {} }, { user: { decimals: 1, display_mode: "slider" } });
  assert.deepEqual(sensor.user, { decimals: 1 }, "sensors only support the decimals override");
});

test("driver updates cannot set user overrides and keep the existing ones", () => {
  assert.deepEqual(driverOptions({ min: 1, user: { decimals: 2 } }), { min: 1 });
  assert.deepEqual(
    mergeDriverOptions({ min: 0, user: { decimals: 2 } }, { min: 5, user: { decimals: 4 } }, "number"),
    { min: 5, user: { decimals: 2 } },
  );
});

test("slider and number widget items are normalized with their defaults", () => {
  assert.deepEqual(normalizeSliderItem({ entity_id: "light.a", style: "nope" }), {
    entity_id: "light.a", show_name: false, show_value: true, update_mode: "on_release", style: "default", color: "auto", fill: "auto",
  });
  assert.deepEqual(normalizeSliderItem({ entity_id: "light.a", feature: "color_temperature", min: "10", max: 90, style: "bar", update_mode: "live" }), {
    entity_id: "light.a", feature: "color_temperature", show_name: false, show_value: true, min: 10, max: 90, update_mode: "live", style: "bar", color: "auto", fill: "auto",
  });
  assert.deepEqual(normalizeNumberItem({ number_id: "n.a", display_mode: "stepper", step: 0 }), { number_id: "n.a", show_name: false, display_mode: "stepper" });
});

test("slider feature targets are validated against the entity", () => {
  const light = { entity_type: "light", features: ["dim"] };
  assert.equal(validateFeatureTarget({ entity_id: "l" }, light), "dim");
  assert.equal(validateFeatureTarget({ entity_id: "l", feature: "color_temperature" }, light), "color_temperature");
  assert.throws(() => validateFeatureTarget({ entity_id: "l", feature: "volume" }, light), { status: 422 });
  const player = { entity_type: "media_player" };
  assert.throws(() => validateFeatureTarget({ entity_id: "m", feature: "seek" }, player), { status: 422 });
  assert.equal(validateFeatureTarget({ entity_id: "m", feature: "seek" }, player, { touchSlider: true }), "seek");
  assert.throws(() => validateFeatureTarget({ entity_id: "n" }, { entity_type: "number", options: { max: null } }), { status: 422 });
  assert.throws(() => validateFeatureTarget({ entity_id: "s" }, { entity_type: "switch" }), { status: 422 });
});

test("number entities always expose set_value, increment and decrement", () => {
  const ids = entityCommandIds({ entity_type: "number", features: [] });
  for (const id of ["number.set_value", "number.increment", "number.decrement"]) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes("number.set_value_transition"));
  assert.ok(entityCommandIds({ entity_type: "number", features: ["value", "transition"] }).includes("number.set_value_transition"));
});

test("list sorting supports name and created in both orders", () => {
  const items = [
    { name: { en: "b" }, created_at: "2024-01-02" },
    { name: { en: "a" }, created_at: "2024-01-03" },
    { name: { en: "c" }, created_at: "2024-01-01" },
  ];
  assert.deepEqual(sortItems(items, { sort: "name" }).map((item) => item.name.en), ["a", "b", "c"]);
  assert.deepEqual(sortItems(items, { sort: "name", order: "desc" }).map((item) => item.name.en), ["c", "b", "a"]);
  assert.throws(() => sortItems(items, { sort: "bogus" }), { status: 400, code: "BAD_REQUEST" });
});

test("WebSocket REST bridge maps every message to an HTTP method and path", () => {
  const entries = Object.entries(WS_REST_MESSAGES);
  assert.ok(entries.length > 50);
  for (const [msg, value] of entries) {
    assert.match(value.method, /^(GET|HEAD|POST|PUT|PATCH|DELETE)$/, msg);
    assert.match(value.path, /^\//, msg);
    assert.ok(value.resp, `${msg} has a response message`);
  }
  assert.equal(WS_REST_MESSAGES.get_activity_ui_pages.path, "/activities/{entity_id}/ui/pages");
});

function readinessPlatform({ connected = true, enabled = true } = {}) {
  const entities = {
    "drv.tv": { entity_id: "drv.tv", entity_type: "media_player", integration_id: "drv", name: { en: "TV" }, attributes: { state: "ON" } },
  };
  const macros = {
    m1: { entity_id: "m1", entity_type: "macro", name: { en: "Macro" }, sequence: [{ type: "command", command: { entity_id: "drv.tv", cmd_id: "media_player.on" } }] },
  };
  const activities = {
    a1: {
      entity_id: "a1",
      entity_type: "activity",
      name: { en: "Activity" },
      options: {},
      sequence_on: [
        { type: "macro", macro_id: "m1" },
        { type: "delay", delay: 500 },
        { type: "command", command: { entity_id: "gone.entity", cmd_id: "switch.on" } },
      ],
    },
  };
  return {
    db: {
      getActivity: (id) => activities[id] || null,
      getMacro: (id) => macros[id] || null,
      getConfiguredEntity: (id) => entities[id] || null,
    },
    integrations: {
      resolveIntegration: () => ({ record_id: "drv", record: { enabled, name: { en: "Driver" } } }),
      connections: { get: () => ({ connected }) },
    },
    engine: { isRunning: () => false },
  };
}

test("readiness expands macros and reports blocked and skipped steps", () => {
  const ready = sequenceReadiness(readinessPlatform(), "a1", { kind: "activity" });
  assert.equal(ready.ready, true);
  assert.equal(ready.total_steps, 3);
  assert.equal(ready.skipped_steps, 1);
  assert.equal(ready.steps[0].parents[0].entity_id, "m1");
  assert.deepEqual(ready.depends_on.integration_ids, ["drv"]);

  const blocked = sequenceReadiness(readinessPlatform({ connected: false }), "a1", { kind: "activity" });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.steps[0].reason.code, "INTEGRATION_NOT_CONNECTED");
  assert.equal(blocked.steps[0].aborts_run, true);

  const ignored = sequenceReadiness(readinessPlatform({ enabled: false }), "a1", { kind: "activity", errorPolicy: "ignore_all" });
  assert.equal(ignored.ready, true);
  assert.equal(ignored.steps[0].reason.code, "INTEGRATION_DISABLED");

  assert.throws(() => sequenceReadiness(readinessPlatform(), "m1", { kind: "activity" }), { status: 400 });
  assert.throws(() => sequenceReadiness(readinessPlatform(), "nope", { kind: "macro" }), { status: 404, code: "NOT_FOUND" });
  assert.throws(() => sequenceReadiness(readinessPlatform(), "a1", { kind: "activity", errorPolicy: "bogus" }), { status: 400 });
});

test("backup jobs run one at a time and lease the export archive", async () => {
  const events = [];
  const platform = {
    events: { publish: (name, value) => events.push([name, value?.state]) },
    systemBackup: { exportArchive: () => Buffer.from("archive"), restore: () => ({ report: [{ id: "x" }] }) },
  };
  const jobs = new BackupJobService(platform, { leaseSeconds: 60 });
  const job = jobs.startExport({});
  assert.equal(job.state, "RUNNING");
  assert.throws(() => jobs.startExport({}), { status: 409 });
  for (let i = 0; i < 40 && jobs.running(); i += 1) await new Promise((resolve) => setImmediate(resolve));
  const done = jobs.get(job.job_id);
  assert.equal(done.state, "COMPLETED");
  assert.match(done.archive.filename, /^UCR3_.*\.backup$/);
  const download = jobs.download(job.job_id);
  assert.equal(download.buffer.toString(), "archive");
  download.done();
  assert.ok(events.every(([name]) => name === "backup.job"));
  assert.equal(jobs.cancelOrDiscard(job.job_id).state, "COMPLETED");
  assert.deepEqual(jobs.list(), []);
  assert.throws(() => jobs.startExport({ custom_integrations: "yes" }), { status: 400 });
  jobs.stop();
});

test("API output keeps the unbounded number limits", async () => {
  const { coreEntity } = await import("../src/core/models.js");
  const value = coreEntity({ entity_id: "n", entity_type: "number", options: { min: 0, max: null, unit: null } });
  assert.equal(value.options.max, null);
  assert.equal(value.options.min, 0);
  assert.ok(!("unit" in value.options));
  const other = coreEntity({ entity_id: "s", entity_type: "sensor", options: { max: null } });
  assert.ok(!("max" in other.options));
});
