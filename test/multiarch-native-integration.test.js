import assert from "node:assert/strict";
import test from "node:test";
import { driverLaunchCommand } from "../src/native-integrations/service.js";

const record = {
  driver_id: "test-driver",
  executable: "/data/native-integrations/packages/test-driver/bin/driver",
  architecture: "arm64"
};

test("ARM64 native integrations execute directly on arm64", () => {
  assert.deepEqual(driverLaunchCommand(record, { runtimeArch: "arm64" }), {
    command: record.executable,
    args: [],
    emulated: false,
    architecture: "arm64"
  });
});

test("ARM64 native integrations use scoped QEMU on amd64", () => {
  assert.deepEqual(driverLaunchCommand(record, {
    runtimeArch: "x64",
    emulator: "/usr/local/bin/qemu-aarch64-static",
    ldPrefix: "/usr/aarch64-linux-gnu",
    exists: () => true
  }), {
    command: "/usr/local/bin/qemu-aarch64-static",
    args: ["-L", "/usr/aarch64-linux-gnu", record.executable],
    emulated: true,
    architecture: "arm64"
  });
});

test("amd64 runtime fails clearly if the ARM64 emulator is unavailable", () => {
  assert.throws(
    () => driverLaunchCommand(record, {
      runtimeArch: "x64",
      emulator: "/missing/qemu-aarch64-static",
      exists: () => false
    }),
    /requires qemu-aarch64-static/
  );
});

test("script integrations remain direct on amd64", () => {
  const script = { ...record, executable: "/data/test/driver.py", architecture: "script" };
  assert.deepEqual(driverLaunchCommand(script, { runtimeArch: "x64" }), {
    command: script.executable,
    args: [],
    emulated: false,
    architecture: "script"
  });
});
