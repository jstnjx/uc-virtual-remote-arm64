// REST Core-API operations added between 0.46.0 and 0.57.2 that the original
// compatibility router did not provide. `handleCurrentCoreRest` is called by
// the Core router first and returns `true` when it answered the request.

import fs from "node:fs";
import os from "node:os";
import { sequenceReadiness } from "../engine/readiness.js";
import { coreEntity } from "../core/models.js";

const SET_STATE_TYPES = new Set(["switch", "light", "climate", "media_player", "remote", "activity"]);

function routeMatch(pathname, pattern) {
  const names = [];
  const source = pattern.replace(/:[^/]+/g, (value) => {
    names.push(value.slice(1));
    return "([^/]+)";
  });
  const result = pathname.match(new RegExp(`^${source}$`));
  if (!result) return null;
  return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(result[index + 1])]));
}

function failure(status, code, message) {
  return Object.assign(new Error(message), { status, errorCode: code, code });
}

// Core-API "fix entity state": set ON / OFF without sending a command.
export function setEntityPowerState(platform, entityId, state) {
  const value = String(state || "").toUpperCase();
  if (!entityId || typeof entityId !== "string") throw failure(400, "BAD_REQUEST", "Missing entity_id");
  if (!["ON", "OFF"].includes(value)) throw failure(400, "BAD_REQUEST", "state must be ON or OFF");
  const db = platform.db;
  const activity = db.getActivity(entityId);
  if (activity) {
    if (platform.engine?.isRunning?.(entityId)) {
      throw failure(409, "CONFLICT", `A sequence of activity ${entityId} is running; stop it first with activity.stop`);
    }
    if (String(activity.state || activity.attributes?.state || "").toUpperCase() !== value) {
      db.setActivityState(entityId, value);
      db.updateActivityAttributes?.(entityId, { state: value, step: undefined, total_steps: undefined });
      platform.events.publish("activity.change", db.getActivity(entityId));
    }
    return db.getActivity(entityId);
  }
  const entity = db.getConfiguredEntity(entityId);
  if (!entity) {
    if (db.getMacro(entityId)) throw failure(422, "UNPROCESSABLE_ENTITY", "The state of a macro cannot be set");
    throw failure(404, "NOT_FOUND", `Entity ${entityId} not found`);
  }
  if (!SET_STATE_TYPES.has(entity.entity_type)) {
    throw failure(422, "UNPROCESSABLE_ENTITY", `The state of a ${entity.entity_type} entity cannot be set`);
  }
  if (String(entity.attributes?.state || "").toUpperCase() === "UNAVAILABLE") {
    throw failure(409, "CONFLICT", `Entity ${entityId} is unavailable`);
  }
  if (String(entity.attributes?.state || "").toUpperCase() === value) return entity;
  const updated = db.updateEntityAttributes(entityId, { state: value });
  platform.events.publish("entity.change", updated);
  return updated;
}

export function networkState() {
  const routable = Object.values(os.networkInterfaces()).flat().some((item) =>
    item && !item.internal && (item.family === "IPv4" || item.family === 4 || (item.family === "IPv6" && !String(item.address).startsWith("fe80")))
  );
  return { state: routable ? "ONLINE" : "OFFLINE" };
}

export function chargerStatus(platform) {
  return { features: [], power_supply: true, ...(platform.db.getSetting("battery_charger_cfg", {}) || {}) };
}

function defaultPortsFor(dock) {
  return (dock.ports || []).map((port) => ({ ...port, mode: "AUTO" }));
}

export async function handleCurrentCoreRest(server, request, response, pathname, url, helpers) {
  const { json, body, ok, multipartFile, text } = helpers;
  const platform = server.platform;
  const db = platform.db;
  const method = String(request.method || "GET").toUpperCase();
  let params;

  // Readiness checks
  params = routeMatch(pathname, "/activities/:id/readiness");
  if (params && method === "GET") {
    const report = sequenceReadiness(platform, params.id, {
      kind: "activity",
      command: url.searchParams.get("command") || undefined,
      lang: url.searchParams.get("lang") || undefined,
      errorPolicy: url.searchParams.get("error_policy") || undefined,
    });
    json(response, 200, report);
    return true;
  }
  params = routeMatch(pathname, "/macros/:id/readiness");
  if (params && method === "GET") {
    const report = sequenceReadiness(platform, params.id, {
      kind: "macro",
      lang: url.searchParams.get("lang") || undefined,
      errorPolicy: url.searchParams.get("error_policy") || undefined,
    });
    json(response, 200, report);
    return true;
  }

  // Entity power state correction
  params = routeMatch(pathname, "/entities/:id/state");
  if (params && method === "PUT") {
    const input = await body(request);
    const entity = setEntityPowerState(platform, params.id, input.state);
    json(response, 200, coreEntity(entity));
    return true;
  }

  // Asynchronous backup jobs
  const jobs = platform.backupJobs;
  if (jobs) {
    if (pathname === "/system/backup/export" && method === "POST") {
      const input = await body(request);
      const job = jobs.startExport(input || {});
      json(response, 202, job, { Location: `/api/system/backup/jobs/${job.job_id}` });
      return true;
    }
    if (pathname === "/system/backup/restore" && method === "POST") {
      jobs.assertIdle();
      const upload = await multipartFile(request, 2100 * 1024 * 1024);
      if (!upload?.buffer?.length) throw failure(400, "BAD_REQUEST", "Missing backup file");
      if (upload.filename && !/\.backup$/i.test(upload.filename) && !/\.(zip|json|tar|gz)$/i.test(upload.filename)) {
        throw failure(400, "BAD_REQUEST", "The backup filename must end in .backup");
      }
      const job = jobs.startRestore(upload.buffer, {
        merge: url.searchParams.get("merge") === "true",
        filename: upload.filename,
        custom_integrations: url.searchParams.get("custom_integrations") !== "false",
      });
      json(response, 202, job, { Location: `/api/system/backup/jobs/${job.job_id}` });
      return true;
    }
    if (pathname === "/system/backup/jobs" && method === "GET") {
      json(response, 200, jobs.list());
      return true;
    }
    params = routeMatch(pathname, "/system/backup/jobs/:id/archive");
    if (params && method === "GET") {
      const download = jobs.download(params.id);
      if (!download) throw failure(404, "NOT_FOUND", "Backup archive not found");
      try {
        text(response, 200, download.buffer, "application/octet-stream", {
          "Content-Disposition": `attachment; filename="${download.filename}"`,
        });
      } finally {
        download.done();
      }
      return true;
    }
    params = routeMatch(pathname, "/system/backup/jobs/:id");
    if (params && method === "GET") {
      const job = jobs.get(params.id);
      if (!job) throw failure(404, "NOT_FOUND", "Backup job not found");
      json(response, 200, job);
      return true;
    }
    if (params && method === "DELETE") {
      const job = jobs.cancelOrDiscard(params.id);
      if (!job) throw failure(404, "NOT_FOUND", "Backup job not found");
      json(response, 200, job);
      return true;
    }
    // Synchronous backup operations are refused while a job runs.
    const synchronousBackup = (pathname === "/system/backup/export" && method === "GET")
      || (pathname === "/system/backup/restore" && method === "PUT")
      || (pathname.startsWith("/system/backup/snapshots") && method !== "GET");
    if (jobs.running() && synchronousBackup) {
      throw failure(409, "CONFLICT", "A backup or restore process is already running");
    }
  }

  // Battery charger: the virtual Remote is permanently mains-powered.
  if (pathname === "/system/power/charger" && method === "GET") {
    json(response, 200, chargerStatus(platform));
    return true;
  }
  if (pathname === "/system/power/charger" && method === "PUT") {
    await body(request);
    // No wireless charging on a virtual appliance: the update is accepted and
    // the unchanged charger information returned.
    json(response, 200, chargerStatus(platform));
    return true;
  }

  // Bluetooth subsystem operations
  if (pathname === "/system/bt" && method === "PUT") {
    const clearBonds = url.searchParams.get("clear_bonds") === "true";
    if (clearBonds) {
      await platform.hardware?.clearBluetoothBonds?.().catch?.(() => {});
      platform.events.publish("bluetooth.bonds_cleared", {});
    }
    ok(response);
    return true;
  }
  if (pathname === "/system/bt" && method === "DELETE") {
    const config = platform.configuration.get("bt") || {};
    if (platform.hardware?.setBluetoothPower && config.enabled !== false) {
      await platform.hardware.setBluetoothPower(false).catch(() => {});
      await platform.hardware.setBluetoothPower(true).catch(() => {});
    }
    ok(response);
    return true;
  }
  params = routeMatch(pathname, "/cfg/bt/profiles/:id");
  if (params && method === "GET") {
    const profiles = [
      { id: "HID", name: { en: "Human Interface Device" }, enabled: true },
      { id: "A2DP", name: { en: "Advanced Audio Distribution" }, enabled: true },
      ...(db.listResources?.("BtDeviceProfile") || []),
    ];
    const profile = profiles.find((item) => String(item.id) === params.id);
    if (!profile) throw failure(404, "NOT_FOUND", "Bluetooth device profile not found");
    json(response, 200, profile);
    return true;
  }

  // HCI trace download
  if (pathname === "/system/logs/hci" && method === "GET") {
    const status = await platform.hardware?.hciLogStatus?.();
    if (!status?.path || !fs.existsSync(status.path)) throw failure(404, "NOT_FOUND", "No HCI trace available");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    text(response, 200, fs.readFileSync(status.path), "application/octet-stream", {
      "Content-Disposition": `attachment; filename="bluetooth-hci-${stamp}.btsnoop"`,
    });
    return true;
  }

  // Advanced Wi-Fi settings reset
  if (pathname === "/cfg/network/wifi" && method === "DELETE") {
    const network = platform.configuration.get("network") || {};
    const defaults = platform.configuration.defaults?.()?.network?.wifi;
    const value = platform.configuration.update("network", { wifi: defaults || { band: "AUTO", scan_interval_sec: 10, wake_on_wlan: network.wifi?.wake_on_wlan ?? {} } });
    json(response, 200, value.wifi || {});
    return true;
  }

  // Dock external ports
  params = routeMatch(pathname, "/docks/devices/:id/ports");
  if (params && ["GET", "DELETE"].includes(method)) {
    const dock = platform.docks.get(params.id);
    if (!dock) throw failure(404, "NOT_FOUND", "Dock not found");
    if (method === "DELETE") {
      for (const port of defaultPortsFor(dock)) platform.docks.updatePort(params.id, port.port, { mode: "AUTO" });
    }
    json(response, 200, platform.docks.get(params.id).ports || []);
    return true;
  }
  params = routeMatch(pathname, "/docks/devices/:id/ports/:port");
  if (params && ["GET", "DELETE"].includes(method)) {
    const dock = platform.docks.get(params.id);
    const port = dock?.ports?.find((item) => String(item.port) === String(params.port));
    if (!port) throw failure(404, "NOT_FOUND", "Dock or port not found");
    json(response, 200, method === "DELETE" ? platform.docks.updatePort(params.id, params.port, { mode: "AUTO" }) : port);
    return true;
  }

  // Dock IR learning: the Dock is the IR emitter.
  params = routeMatch(pathname, "/docks/devices/:id/ir/learn");
  if (params && ["GET", "POST", "DELETE"].includes(method)) {
    if (!platform.docks.get(params.id)) throw failure(404, "NOT_FOUND", "Dock not found");
    const value = method === "GET"
      ? platform.docks.learnStatus(params.id)
      : method === "POST"
        ? platform.docks.startLearn(params.id, url.searchParams.get("timeout") || 60)
        : platform.docks.stopLearn(params.id);
    json(response, 200, value);
    return true;
  }

  return false;
}
