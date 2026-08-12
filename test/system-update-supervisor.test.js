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

function platform(dataDir, version = "0.15.1") {
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

const SUPERVISOR_ADDON_SLUG = "a0d7b954_uc_virtual_remote_arm64";
const HOME_ASSISTANT_UPDATE_ENTITY = "update.uc_virtual_remote_update";

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
          slug: SUPERVISOR_ADDON_SLUG,
          name: "UC Virtual Remote",
          version: "0.15.0",
          version_latest: "0.15.1",
          update_available: true
        }
      });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    const adapter = new SupervisorUpdateAdapter({ apiBase: "http://supervisor", token: "test-token" });
    const update = await adapter.check(true);
    assert.equal(update.version, "0.15.1");
    assert.equal(update.source, "HOME_ASSISTANT_SUPERVISOR");
    assert.equal(adapter.addonSlug, SUPERVISOR_ADDON_SLUG);
    assert.equal(adapter.addonName, "UC Virtual Remote");
    assert.equal(adapter.installedVersion, "0.15.0");
    assert.equal(adapter.latestVersion, "0.15.1");
    assert.deepEqual(calls.map((item) => [item.method, new URL(item.url).pathname]), [
      ["POST", "/store/reload"],
      ["GET", "/addons/self/info"]
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Supervisor-managed installation delegates self-update through Home Assistant Core", async () => {
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
          slug: SUPERVISOR_ADDON_SLUG,
          name: "UC Virtual Remote",
          version: "0.15.0",
          version_latest: "0.15.1",
          update_available: true
        }
      });
    }
    if (String(url).endsWith("/core/api/states")) {
      return response([
        {
          entity_id: HOME_ASSISTANT_UPDATE_ENTITY,
          state: "on",
          attributes: {
            friendly_name: "UC Virtual Remote Update",
            installed_version: "0.15.0",
            latest_version: "0.15.1"
          }
        }
      ]);
    }
    if (String(url).endsWith("/core/api/services/update/install")) return response([]);
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    const target = platform(root, "0.15.1");
    const service = new SystemUpdateService(target, { supervisor: { apiBase: "http://supervisor", token: "test-token" } });
    const checked = await service.check(false);
    assert.equal(checked.installed_version, "0.15.0");
    assert.equal(checked.available[0].version, "0.15.1");
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

    const stateCall = calls.find((item) => item.url.endsWith("/core/api/states"));
    assert.ok(stateCall, "Home Assistant update entities were not queried");

    const installCall = calls.find((item) => item.url.endsWith("/core/api/services/update/install"));
    assert.ok(installCall, "Home Assistant Core update.install service was not called");
    assert.equal(installCall.method, "POST");
    assert.deepEqual(JSON.parse(installCall.body), {
      entity_id: HOME_ASSISTANT_UPDATE_ENTITY,
      backup: false
    });

    assert.equal(calls.some((item) => item.url.includes("/store/addons/") && item.url.endsWith("/update")), false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousManaged === undefined) delete process.env.UCVR_SUPERVISOR_MANAGED;
    else process.env.UCVR_SUPERVISOR_MANAGED = previousManaged;
    if (previousToken === undefined) delete process.env.SUPERVISOR_TOKEN;
    else process.env.SUPERVISOR_TOKEN = previousToken;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Supervisor adapter can resolve a renamed Home Assistant add-on update entity", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body });
    if (String(url).endsWith("/addons/self/info")) {
      return response({
        result: "ok",
        data: {
          slug: SUPERVISOR_ADDON_SLUG,
          name: "UC Virtual Remote",
          version: "0.15.0",
          version_latest: "0.15.1",
          update_available: true
        }
      });
    }
    if (String(url).endsWith("/core/api/states")) {
      return response([
        {
          entity_id: "update.my_custom_ucvr_update",
          state: "on",
          attributes: {
            friendly_name: "UC Virtual Remote Update",
            installed_version: "0.15.0",
            latest_version: "0.15.1"
          }
        }
      ]);
    }
    if (String(url).endsWith("/core/api/services/update/install")) return response([]);
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    const adapter = new SupervisorUpdateAdapter({ apiBase: "http://supervisor", token: "test-token" });
    await adapter.check(false);
    await adapter.install();
    const installCall = calls.find((item) => item.url.endsWith("/core/api/services/update/install"));
    assert.equal(JSON.parse(installCall.body).entity_id, "update.my_custom_ucvr_update");
  } finally {
    globalThis.fetch = previousFetch;
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
