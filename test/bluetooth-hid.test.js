import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { BluetoothHidService, consumerReport, keyboardReport, mouseReport, systemReport } from "../src/bluetooth-hid/service.js";

test("Bluetooth HID reports match composite report descriptor IDs", () => {
  assert.equal(keyboardReport(0x52).toString("hex"), "010000520000000000");
  assert.equal(mouseReport({ buttons: 1, dx: 5, dy: -3, wheel: 1 }).toString("hex"), "020105fd01");
  assert.equal(consumerReport(0x00e9).toString("hex"), "03e900");
  assert.equal(systemReport(0x81).toString("hex"), "0481");
});

test("BT remote commands implement UC key, consumer, system and mouse grammar", async () => {
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

  await service.sendCommand("LCTRL+LALT+KEY_DELETE");
  const combo = JSON.parse(writes.pop());
  assert.equal(Buffer.from(combo.reports[0], "base64").toString("hex"), "0105004c0000000000");

  await service.sendCommand("CONSUMER_VOLUME_INCREMENT");
  const consumer = JSON.parse(writes.pop());
  assert.equal(Buffer.from(consumer.reports[0], "base64").toString("hex"), "03e900");
  assert.equal(Buffer.from(consumer.reports[1], "base64").toString("hex"), "030000");

  await service.sendCommand("SYSTEM_POWER_DOWN");
  const system = JSON.parse(writes.pop());
  assert.equal(Buffer.from(system.reports[0], "base64").toString("hex"), "0481");
  assert.equal(Buffer.from(system.reports[1], "base64").toString("hex"), "0400");

  await service.sendCommand("MOUSE_X_-4");
  const mouse = JSON.parse(writes.pop());
  assert.equal(Buffer.from(mouse.reports[0], "base64").toString("hex"), "0200fc0000");

  await service.sendCommand("0xE9");
  const rawKey = JSON.parse(writes.pop());
  assert.equal(Buffer.from(rawKey.reports[0], "base64").toString("hex"), "010000e90000000000");

  await service.sendCommand("0x00E9");
  const rawConsumer = JSON.parse(writes.pop());
  assert.equal(Buffer.from(rawConsumer.reports[0], "base64").toString("hex"), "03e900");
});

test("remote.send_key uses the documented key + GUI parameters", async () => {
  const writes = [];
  const platform = {
    name: "Virtual Remote 3",
    db: { listConfiguredEntities: () => [] },
    hardware: {},
    events: { publish() {} },
  };
  const service = new BluetoothHidService(platform);
  service.state.running = true;
  service.process = { stdin: { writable: true, write(value) { writes.push(String(value)); return true; } } };
  await service.sendRemoteCommand(
    { entity_type: "remote", kind: "BT" },
    "remote.send_key",
    { key: "KEY_E", gui: true },
  );
  const command = JSON.parse(writes.pop());
  assert.equal(Buffer.from(command.reports[0], "base64").toString("hex"), "010800080000000000");
});

test("plain US-ASCII text is emitted as individual key presses", async () => {
  const writes = [];
  const platform = {
    name: "Virtual Remote 3",
    db: { listConfiguredEntities: () => [] },
    hardware: {},
    events: { publish() {} },
  };
  const service = new BluetoothHidService(platform);
  service.state.running = true;
  service.process = { stdin: { writable: true, write(value) { writes.push(String(value)); return true; } } };
  await service.sendCommand("Ab");
  const command = JSON.parse(writes.pop());
  assert.equal(command.reports.length, 4);
  assert.equal(Buffer.from(command.reports[0], "base64").toString("hex"), "010200040000000000");
  assert.equal(Buffer.from(command.reports[2], "base64").toString("hex"), "010000050000000000");
});

test("BlueZ helper implements LE HID over GATT, not classic HID SDP", () => {
  const helper = fs.readFileSync("tools/bluetooth-hid.py", "utf8");
  assert.match(helper, /00001812-0000-1000-8000-00805f9b34fb/);
  assert.match(helper, /org\.bluez\.GattManager1/);
  assert.match(helper, /org\.bluez\.LEAdvertisingManager1/);
  assert.match(helper, /00002a4b-0000-1000-8000-00805f9b34fb/);
  assert.match(helper, /00002908-0000-1000-8000-00805f9b34fb/);
  assert.doesNotMatch(helper, /ProfileManager1|PSM_CONTROL|PSM_INTERRUPT/);
});

test("BlueZ HID helper is valid Python", () => {
  const result = spawnSync("python3", ["-c", "compile(open('tools/bluetooth-hid.py', encoding='utf-8').read(), 'tools/bluetooth-hid.py', 'exec')"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
