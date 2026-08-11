import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SystemUpdateService } from "../src/system-update/service.js";
import { SupervisorUpdateAdapter } from "../src/system-update/supervisor.js";

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function platform(dataDir, version = "0.14.12") {
  return {
    dataDir,
    version,
    configuration: {
      get(section) {
        if (section === "software_update") return { channel: "DEFAULT", check_for_updates: true };
        return {};
      }
    },
    events: {
      published: [],
      publish(type, data) { this.published.push({ type, data }); }
    }
  };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

test("Supervisor adapter refreshes the store and reports the add-on update", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body });
    if (String(url).endsWith("/store/reload")) return response({ result: "ok", data: {} });
    if (String(url).endsWith("/addons/self/info")) {
      return response({
        result: "ok",
        data: {
          version: "0.14.11",
          version_latest: "0.14.12",
          update_available: true
        }
      });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    const adapter = new SupervisorUpdateAdapter({ apiBase: "http://supervisor", token: "test-token" });
    const update = await adapter.check(true);
    assert.equal(update.version, "0.14.12");
    assert.equal(update.source, "HOME_ASSISTANT_SUPERVISOR");
    assert.equal(adapter.installedVersion, "0.14.11");
    assert.equal(adapter.latestVersion, "0.14.12");
    assert.deepEqual(calls.map((item) => [item.method, new URL(item.url).pathname]), [
      ["POST", "/store/reload"],
      ["GET", "/addons/self/info"]
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Supervisor-managed service preserves DOWNLOAD then INSTALL and delegates installation", async () => {
  const previousFetch = globalThis.fetch;
  const previousManaged = process.env.UCVR_SUPERVISOR_MANAGED;
  const previousToken = process.env.SUPERVISOR_TOKEN;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ucvr-supervisor-update-test-"));
  const calls = [];
  process.env.UCVR_SUPERVISOR_MANAGED = "true";
  process.env.SUPERVISOR_TOKEN = "test-token";
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body });
    if (String(url).endsWith("/addons/self/info")) {
      return response({
        result: "ok",
        data: {
          version: "0.14.11",
          version_latest: "0.14.12",
          update_available: true
        }
      });
    }
    if (String(url).endsWith("/store/addons/self/update")) {
      return response({ result: "ok", data: { job_id: "job-123" } });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    const target = platform(root, "0.14.12");
    const service = new SystemUpdateService(target, { supervisor: { apiBase: "http://supervisor", token: "test-token" } });
    const checked = await service.check(false);
    assert.equal(checked.installed_version, "0.14.11");
    assert.equal(checked.available[0].version, "0.14.12");
    assert.equal(checked.supervisor_managed, true);

    const updateId = checked.available[0].id;
    const download = await service.action(updateId);
    assert.equal(download.action, "DOWNLOAD");
    await settle();
    assert.equal(service.progress(updateId).state, "SUCCESS");

    const install = await service.action(updateId);
    assert.equal(install.action, "INSTALL");
    await settle();
    assert.equal(service.progress(updateId).state, "DONE");

    const updateCall = calls.find((item) => item.url.endsWith("/store/addons/self/update"));
    assert.ok(updateCall, "Supervisor update endpoint was not called");
    assert.equal(updateCall.method, "POST");
    assert.deepEqual(JSON.parse(updateCall.body), { backup: false, background: true });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousManaged === undefined) delete process.env.UCVR_SUPERVISOR_MANAGED;
    else process.env.UCVR_SUPERVISOR_MANAGED = previousManaged;
    if (previousToken === undefined) delete process.env.SUPERVISOR_TOKEN;
    else process.env.SUPERVISOR_TOKEN = previousToken;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("standalone runtime still selects the original local updater", () => {
  const previousManaged = process.env.UCVR_SUPERVISOR_MANAGED;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ucvr-local-update-test-"));
  delete process.env.UCVR_SUPERVISOR_MANAGED;
  try {
    const service = new SystemUpdateService(platform(root));
    const status = service.status();
    assert.equal(status.repository, "jstnjx/uc-virtual-remote-arm64");
    assert.equal(status.channel, "DEFAULT");
    assert.equal(status.supervisor_managed, undefined);
  } finally {
    if (previousManaged === undefined) delete process.env.UCVR_SUPERVISOR_MANAGED;
    else process.env.UCVR_SUPERVISOR_MANAGED = previousManaged;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
