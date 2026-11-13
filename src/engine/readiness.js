// Activity and macro readiness check (REST Core-API 0.49.0,
// `GET /activities/{id}/readiness`, `GET /macros/{id}/readiness`, WebSocket
// `get_sequence_readiness`).
//
// The virtual Remote predicts the run from the stored sequence: command and
// delay steps, nested macros and activities expanded in place. Activity group
// transitions are not prepended because the sequence engine does not run them.

import { nowIso } from "../shared/util.js";

const ERROR_POLICIES = ["abort", "continue_transition", "ignore_all"];
const MAX_DEPTH = 8;

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400, errorCode: "BAD_REQUEST", code: "BAD_REQUEST" });
}

function notFound(message) {
  return Object.assign(new Error(message), { status: 404, errorCode: "NOT_FOUND", code: "NOT_FOUND" });
}

function nameFor(value, lang, fallback) {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  const culture = String(lang || "en").replace("-", "_");
  return value[culture] || value[culture.split("_")[0]] || value.en || Object.values(value).find((item) => typeof item === "string") || fallback;
}

function stepCommand(step) {
  const type = String(step?.type || "");
  if (type === "command") {
    const command = step.command || {};
    return { entity_id: command.entity_id, cmd_id: command.cmd_id || command.command, params: command.params };
  }
  if (type === "entity_command") return { entity_id: step.entity_id, cmd_id: step.command || step.cmd_id, params: step.params };
  return null;
}

function stepDelay(step) {
  if (String(step?.type || "") !== "delay") return null;
  return Number(step.delay ?? step.ms ?? step.duration_ms ?? 0) || 0;
}

export function sequenceReadiness(platform, entityId, { kind, command = undefined, lang = undefined, errorPolicy = undefined } = {}) {
  const db = platform.db;
  const activity = db.getActivity(entityId);
  const macro = activity ? null : db.getMacro(entityId);
  if (kind === "activity" && !activity) {
    if (db.getMacro(entityId)) throw badRequest(`${entityId} is a macro, not an activity`);
    throw notFound(`Activity ${entityId} not found`);
  }
  if (kind === "macro" && !macro) {
    if (activity) throw badRequest(`${entityId} is an activity, not a macro`);
    throw notFound(`Macro ${entityId} not found`);
  }
  if (!activity && !macro) throw notFound(`Entity ${entityId} not found`);
  if (lang !== undefined && lang !== null && lang !== "" && !/^[a-z]{2}([_-][A-Za-z]{2})?$/.test(String(lang))) {
    throw badRequest(`Invalid lang ${lang}`);
  }
  if (errorPolicy !== undefined && errorPolicy !== null && errorPolicy !== "" && !ERROR_POLICIES.includes(String(errorPolicy))) {
    throw badRequest(`Invalid error_policy ${errorPolicy}`);
  }
  const language = String(lang || platform.configuration?.get?.("localization")?.language_code || "en").split(/[_-]/)[0];

  let cmdId;
  let sequence;
  if (activity) {
    const value = String(command || "on").toLowerCase().replace(/^activity\./, "");
    if (!["on", "start", "off"].includes(value)) throw badRequest(`Unsupported activity command ${command}`);
    cmdId = value === "off" ? "activity.off" : value === "start" ? "activity.start" : "activity.on";
    sequence = value === "off" ? activity.sequence_off : activity.sequence_on;
  } else {
    const value = String(command || "run").toLowerCase().replace(/^macro\./, "");
    if (!["run", "start"].includes(value)) throw badRequest(`Unsupported macro command ${command}`);
    cmdId = "macro.run";
    sequence = macro.sequence;
  }

  let policy = String(errorPolicy || (activity ? activity.options?.error_policy : "") || "continue_transition");
  if (!activity && policy === "continue_transition") policy = "abort";

  const integrationIds = new Set();
  const emitterIds = new Set();
  const steps = [];

  const reasonFor = (entity) => {
    if (!entity) return null;
    if (["activity", "macro"].includes(entity.entity_type)) {
      if (platform.engine?.isRunning?.(entity.entity_id || entity.id)) {
        return { code: "SEQUENCE_ALREADY_RUNNING", message: `${nameFor(entity.name, language, entity.entity_id)} is already running`, group_id: `SEQUENCE_ALREADY_RUNNING:${entity.entity_id || entity.id}` };
      }
      return null;
    }
    const integrationId = entity.integration_id;
    if (!integrationId || integrationId === "uc:core" || String(integrationId).startsWith("uc.")) return null;
    if (platform.demo?.isIntegration?.(integrationId)) return null;
    integrationIds.add(integrationId);
    const resolved = platform.integrations?.resolveIntegration?.(integrationId);
    const record = resolved?.record;
    const integrationName = nameFor(record?.metadata?.name || record?.name, language, integrationId);
    if (!record) {
      return { code: "INTEGRATION_NOT_FOUND", message: `Integration ${integrationId} is not configured`, group_id: `INTEGRATION_NOT_FOUND:${integrationId}`, integration_id: integrationId };
    }
    if (record.enabled === false) {
      return { code: "INTEGRATION_DISABLED", message: `Integration ${integrationName} is disabled`, group_id: `INTEGRATION_DISABLED:${integrationId}`, integration_id: integrationId, integration_name: integrationName };
    }
    const connected = platform.integrations?.connections?.get?.(resolved.record_id)?.connected;
    if (!connected) {
      const state = String(record.device_state || record.status || "DISCONNECTED");
      return { code: "INTEGRATION_NOT_CONNECTED", message: `Integration ${integrationName} is not connected`, group_id: `INTEGRATION_NOT_CONNECTED:${integrationId}`, integration_id: integrationId, integration_name: integrationName, state };
    }
    if (String(entity.attributes?.state || "").toUpperCase() === "UNAVAILABLE") {
      return { code: "ENTITY_UNAVAILABLE", message: `${nameFor(entity.name, language, entity.entity_id)} is unavailable`, group_id: `ENTITY_UNAVAILABLE:${entity.entity_id}`, integration_id: integrationId, integration_name: integrationName, state: "UNAVAILABLE" };
    }
    return null;
  };

  const lookup = (id) => db.getConfiguredEntity(id) || db.getActivity(id) || db.getMacro(id);

  const visit = (items, { depth, parents, topIndex, visited }) => {
    (Array.isArray(items) ? items : []).forEach((step, position) => {
      const index = depth === 0 ? position + 1 : topIndex;
      const base = {
        index,
        authored_index: index,
        ...(depth > 0 ? { nested_index: position + 1, parents } : {}),
        part: "sequence",
      };
      const delay = stepDelay(step);
      if (delay !== null) {
        steps.push({ ...base, type: "delay", delay, ready: true });
        return;
      }
      const type = String(step?.type || "");
      if (type === "macro") {
        const nested = db.getMacro(step.macro_id);
        const ref = { entity_id: String(step.macro_id || ""), name: nameFor(nested?.name, language, String(step.macro_id || "")) };
        if (!nested) {
          steps.push({ ...base, type: "command", entity_id: ref.entity_id, entity_type: "macro", name: ref.name, cmd_id: "macro.run", ready: true, skipped: true,
            reason: { code: "ENTITY_NOT_FOUND", message: `${ref.name} no longer exists`, group_id: `ENTITY_NOT_FOUND:${ref.entity_id}` } });
          return;
        }
        if (depth + 1 > MAX_DEPTH || visited.has(ref.entity_id)) {
          steps.push({ ...base, type: "command", entity_id: ref.entity_id, entity_type: "macro", name: ref.name, cmd_id: "macro.run", ready: false,
            reason: { code: "NESTING_LIMIT", message: `${ref.name} is nested too deeply`, group_id: `NESTING_LIMIT:${ref.entity_id}` } });
          return;
        }
        visit(nested.sequence, { depth: depth + 1, parents: [...(parents || []), ref], topIndex: index, visited: new Set([...visited, ref.entity_id]) });
        return;
      }
      if (type === "parallel") {
        for (const branch of Array.isArray(step.sequences) ? step.sequences : []) {
          visit(branch, { depth: depth + 1, parents: parents || [], topIndex: index, visited });
        }
        return;
      }
      const command = stepCommand(step);
      if (!command) return;
      const entity = lookup(command.entity_id);
      const entry = {
        ...base,
        type: "command",
        entity_id: command.entity_id,
        ...(entity?.entity_type ? { entity_type: entity.entity_type } : {}),
        name: nameFor(entity?.name, language, command.entity_id),
        cmd_id: command.cmd_id,
        ...(command.params ? { params: command.params } : {}),
      };
      if (!entity) {
        steps.push({ ...entry, ready: true, skipped: true, reason: { code: "ENTITY_NOT_FOUND", message: `${entry.name} no longer exists`, group_id: `ENTITY_NOT_FOUND:${command.entity_id}` } });
        return;
      }
      if (entity.entity_type === "activity" && /(^|\.)stop$/.test(String(command.cmd_id || ""))) {
        steps.push({ ...entry, ready: false, reason: { code: "INVALID_COMMAND", message: "activity.stop cannot be a sequence step", group_id: `INVALID_COMMAND:${command.entity_id}` } });
        return;
      }
      const reason = reasonFor(entity);
      steps.push(reason ? { ...entry, ready: false, reason } : { ...entry, ready: true });
    });
  };
  visit(sequence, { depth: 0, parents: null, topIndex: 0, visited: new Set([entityId]) });

  let blocked = 0;
  let aborting = 0;
  let skipped = 0;
  for (const step of steps) {
    if (step.skipped) { skipped += 1; continue; }
    if (step.ready) continue;
    blocked += 1;
    const abortsRun = policy !== "ignore_all";
    step.aborts_run = abortsRun;
    if (abortsRun) aborting += 1;
  }

  return {
    entity_id: entityId,
    entity_type: activity ? "activity" : "macro",
    name: nameFor((activity || macro).name, language, entityId),
    cmd_id: cmdId,
    lang: language,
    error_policy: policy,
    timestamp: nowIso(),
    ready: aborting === 0,
    total_steps: steps.length,
    transition_steps: 0,
    blocked_steps: blocked,
    skipped_steps: skipped,
    aborting_steps: aborting,
    omitted_steps: 0,
    depends_on: { integration_ids: [...integrationIds], emitter_ids: [...emitterIds], dock_ids: [], bluetooth: false },
    steps,
    omitted: [],
  };
}
