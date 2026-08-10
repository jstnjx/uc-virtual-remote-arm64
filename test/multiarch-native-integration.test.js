import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { driverLaunchCommand, packageExecutable, pyInstallerOnedirEnvironment, wrapArm64HelperExecutables } from "../src/native-integrations/service.js";

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


test("PyInstaller onedir ARM64 drivers skip the guest self-exec on amd64", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ucvr-pyi-"));
  try {
    const executable = path.join(root, "bin", "driver");
    fs.mkdirSync(path.join(root, "bin", "_internal"), { recursive: true });
    fs.writeFileSync(executable, "placeholder");
    const env = pyInstallerOnedirEnvironment({ driver_id: "pyi", executable, architecture: "arm64" }, {
      runtimeArch: "x64",
      ldLibraryPath: "/existing/lib"
    });
    assert.equal(env._PYI_ARCHIVE_FILE, executable);
    assert.equal(env._PYI_PARENT_PROCESS_LEVEL, "0");
    assert.equal(env.LD_LIBRARY_PATH, `${path.join(root, "bin", "_internal")}:/existing/lib`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("secondary ARM64 executables are wrapped without replacing the main driver", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ucvr-helper-"));
  try {
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin, { recursive: true });
    const main = path.join(bin, "driver");
    const helper = path.join(bin, "node");
    const internal = path.join(bin, "_internal");
    const modules = path.join(bin, "bridge", "node_modules", "native");
    const sharedLibrary = path.join(internal, "libpython3.11.so.1.0");
    const nativeModule = path.join(modules, "binding.node");
    fs.mkdirSync(internal, { recursive: true });
    fs.mkdirSync(modules, { recursive: true });
    fs.writeFileSync(main, "main", { mode: 0o755 });
    fs.writeFileSync(helper, "helper", { mode: 0o755 });
    fs.writeFileSync(sharedLibrary, "shared", { mode: 0o755 });
    fs.writeFileSync(nativeModule, "native", { mode: 0o755 });
    const wrapped = wrapArm64HelperExecutables(root, main, {
      runtimeArch: "x64",
      architectureOf: (filename) => [helper, sharedLibrary, nativeModule].includes(filename) ? "arm64" : null
    });
    assert.deepEqual(wrapped, [path.join("bin", "node")]);
    assert.equal(fs.readFileSync(main, "utf8"), "main");
    assert.match(fs.readFileSync(helper, "utf8"), /qemu-aarch64-static/);
    assert.equal(fs.readFileSync(`${helper}.ucvr-arm64`, "utf8"), "helper");
    assert.equal(fs.readFileSync(sharedLibrary, "utf8"), "shared");
    assert.equal(fs.readFileSync(nativeModule, "utf8"), "native");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("documented bin/driver.js packages launch through Node", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ucvr-node-driver-"));
  try {
    const bin = path.join(root, "bin");
    const driver = path.join(bin, "driver.js");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(driver, "console.log('driver');\n", { mode: 0o644 });
    assert.equal(packageExecutable(root), driver);
    const launch = driverLaunchCommand({ driver_id: "node-driver", executable: driver, architecture: "script" }, { runtimeArch: "x64" });
    assert.equal(launch.command, process.execPath);
    assert.deepEqual(launch.args, [driver]);
    assert.equal(launch.architecture, "script");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
