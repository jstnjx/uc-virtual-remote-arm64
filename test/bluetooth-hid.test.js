import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { BluetoothHidService, consumerReport, keyboardReport, mouseReport } from "../src/bluetooth-hid/service.js";

test("Bluetooth HID reports match composite report descriptor IDs", () => {
  assert.equal(keyboardReport(0x52).toString("hex"), "010000520000000000");
  assert.equal(mouseReport({ buttons: 1, dx: 5, dy: -3, wheel: 1 }).toString("hex"), "020105fd01");
  assert.equal(consumerReport(0x00e9).toString("hex"), "03e900");
});

test("BT remote commands produce press and release HID reports", async () => {
  const writes = [];
  const platform = {
    name: "Virtual Remote 3",
    db: { listConfiguredEntities: () => [] },
    hardware: {},
    events: { publish() {} },
  };
  const service = new BluetoothHidService(platform);
  service.state.running = true;
  service.process = {
    stdin: {
      writable: true,
      write(value) { writes.push(String(value)); return true; },
    },
  };

  await service.sendCommand("DPAD_UP");
  const keyboard = JSON.parse(writes.pop());
  assert.equal(keyboard.action, "sequence");
  assert.equal(Buffer.from(keyboard.reports[0], "base64").toString("hex"), "010000520000000000");
  assert.equal(Buffer.from(keyboard.reports[1], "base64").toString("hex"), "010000000000000000");

  await service.sendCommand("VOLUME_UP");
  const consumer = JSON.parse(writes.pop());
  assert.equal(Buffer.from(consumer.reports[0], "base64").toString("hex"), "03e900");
  assert.equal(Buffer.from(consumer.reports[1], "base64").toString("hex"), "030000");

  await service.sendCommand("MOUSE_MOVE", { dx: 4, dy: -2 });
  const mouse = JSON.parse(writes.pop());
  assert.equal(Buffer.from(mouse.reports[0], "base64").toString("hex"), "020004fe00");
});

test("BlueZ HID helper is valid Python", () => {
  const result = spawnSync("python3", ["-c", "compile(open('tools/bluetooth-hid.py', encoding='utf-8').read(), 'tools/bluetooth-hid.py', 'exec')"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
