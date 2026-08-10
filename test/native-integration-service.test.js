import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { NativeIntegrationService, validateTarListing, validateTarTypes } from "../src/native-integrations/service.js";

function platform(root) {
  const records = [];
  const db = {
    listIntegrations: () => records,
    saveIntegration(input) {
      const record = { status: "DISCONNECTED", device_state: "UNKNOWN", setup_data: {}, ...input };
      records.push(record);
      return record;
    },
    updateIntegration(id, input) {
      const record = records.find((item) => item.id === id);
      if (!record) return null;
      Object.assign(record, input);
      return record;
    },
    getIntegration(id) { return records.find((item) => item.id === id) || null; }
  };
  const instance = {
    dataDir: root,
    restCoreApiVersion: "0.32.0",
    db,
    externalIntegrations: { reservedPorts: () => new Set() },
    integrations: {
      async register(input) { return db.saveIntegration(input); },
      async connect() {},
      async disconnect() {}
    }
  };
  return instance;
}

function archive(root, version = "1.0.0") {
  const source = path.join(root, `src-${version}`);
  fs.mkdirSync(path.join(source, "bin"), { recursive: true });
  fs.mkdirSync(path.join(source, "config", "profiles"), { recursive: true });
  fs.writeFileSync(path.join(source, "driver.json"), JSON.stringify({
    driver_id: "test_native",
    version,
    min_core_api: "0.20.0",
    name: { en: "Native Test" },
    description: { en: "Native runtime test integration" }
  }));
  fs.writeFileSync(path.join(source, "config", "profiles", "default.json"), JSON.stringify({ version }));
  fs.writeFileSync(path.join(source, "server.js"), `
const net = require("node:net");
const server = net.createServer(() => {});
server.listen(Number(process.env.UC_INTEGRATION_HTTP_PORT), process.env.UC_INTEGRATION_INTERFACE);
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
`);
  fs.writeFileSync(path.join(source, "bin", "driver"), "#!/bin/sh\nexec node server.js\n", { mode: 0o755 });
  const output = path.join(root, `test-native-${version}.tar.gz`);
  execFileSync("tar", ["-czf", output, "-C", source, "."]);
  return fs.readFileSync(output);
}

test("tar listing rejects path traversal and link entries", () => {
  assert.throws(() => validateTarListing("./driver.json\n../escape\n"), /Unsafe integration archive path/);
  assert.throws(() => validateTarTypes("lrwxrwxrwx root/root 0 2026-08-10 00:00 ./escape -> /tmp/escape\n"), /unsupported link or special file/);
  assert.doesNotThrow(() => validateTarTypes("drwxr-xr-x root/root 0 2026-08-10 00:00 ./\n-rwxr-xr-x root/root 123 2026-08-10 00:00 ./bin/driver\n"));
});

test("native integration tarball installs, starts, updates and removes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ucvr-native-test-"));
  const runtime = platform(root);
  const service = new NativeIntegrationService(runtime, { portStart: 23191 });
  runtime.nativeIntegrations = service;
  try {
    const installed = await service.install(archive(root, "1.0.0"), { filename: "test-native-aarch64.tar.gz" });
    assert.equal(installed.driver_id, "test_native");
    assert.equal(installed.driver_type, "CUSTOM");
    assert.equal(installed.driver_version, "1.0.0");
    assert.equal(service.status().installed, 1);
    assert.equal(service.status().running, 1);
    const seededProfile = path.join(root, "native-integrations", "config", "test_native", "profiles", "default.json");
    assert.deepEqual(JSON.parse(fs.readFileSync(seededProfile, "utf8")), { version: "1.0.0" });

    const config = path.join(root, "native-integrations", "config", "test_native", "settings.json");
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.writeFileSync(config, "{\"keep\":true}\n");

    const updated = await service.install(archive(root, "1.1.0"), { filename: "test-native-aarch64.tar.gz", update: true });
    assert.equal(updated.driver_version, "1.1.0");
    assert.equal(fs.readFileSync(config, "utf8"), "{\"keep\":true}\n");
    assert.deepEqual(JSON.parse(fs.readFileSync(seededProfile, "utf8")), { version: "1.0.0" });
    assert.equal(service.managedRecord("test_native").version, "1.1.0");

    assert.equal(await service.remove("test_native"), true);
    assert.equal(service.status().installed, 0);
    assert.equal(service.status().running, 0);
  } finally {
    await service.stop().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});
