import { createWebSocketHttpServer } from "../protocol/websocket.js";
import {
  DEFAULT_DEMO_UPDATE_INTERVAL_MS,
  DEMO_EXTERNAL_DRIVER_ID,
  createDemoEntityDefinitions,
  translated
} from "./entities.js";
import {
  applyDemoCommand,
  browseDemoMedia,
  randomizeDemoAttributes,
  searchDemoMedia
} from "./behavior.js";

function send(peer, value) {
  peer.send(JSON.stringify(value));
}

function response(peer, request, msg = "result", data = {}, code = 200) {
  send(peer, { kind: "resp", req_id: request.id, msg, code, msg_data: data });
}

function event(peer, msg, data, category = "ENTITY") {
  send(peer, { kind: "event", msg, cat: category, msg_data: data });
}

export function createStandaloneDemoIntegration(options = {}) {
  const host = options.host || "0.0.0.0";
  const port = Number(options.port || 11091);
  const updateIntervalMs = Math.max(1_000, Number(options.updateIntervalMs || DEFAULT_DEMO_UPDATE_INTERVAL_MS));
  const clients = new Set();
  const subscriptions = new Map();
  const entities = new Map(createDemoEntityDefinitions().map((definition) => [definition.entity_id, definition]));
  let configuredName = options.name || "Demo room";
  let timer = null;

  function isSubscribed(peer, entityId) {
    const selected = subscriptions.get(peer);
    return !selected?.size || selected.has(entityId);
  }

  function broadcastState(entityRecord) {
    for (const peer of clients) {
      if (!isSubscribed(peer, entityRecord.entity_id)) continue;
      event(peer, "entity_change", {
        entity_id: entityRecord.entity_id,
        entity_type: entityRecord.entity_type,
        attributes: entityRecord.attributes
      });
    }
  }

  function tick() {
    const updated = [];
    for (const entityRecord of entities.values()) {
      entityRecord.attributes = randomizeDemoAttributes(entityRecord);
      updated.push(entityRecord);
      broadcastState(entityRecord);
    }
    return updated;
  }

  function command(entityId, commandId, params = {}) {
    const entityRecord = entities.get(entityId);
    if (!entityRecord) return null;
    const result = applyDemoCommand(entityRecord, commandId, params);
    entityRecord.attributes = result.attributes;
    broadcastState(entityRecord);
    return { entity: entityRecord, driverCommandId: result.driverCommandId };
  }

  function startTimer() {
    if (timer) return;
    timer = setInterval(tick, updateIntervalMs);
    timer.unref?.();
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  const socketServer = createWebSocketHttpServer({
    host,
    port,
    onConnection(peer) {
      clients.add(peer);
      subscriptions.set(peer, new Set());
      peer.on("close", () => {
        clients.delete(peer);
        subscriptions.delete(peer);
      });
      send(peer, {
        kind: "resp",
        req_id: 0,
        msg: "authentication",
        code: 200,
        msg_data: { version: { api: "0.15.4", driver: "1.0.0" } }
      });

      peer.on("message", (raw) => {
        let request;
        try { request = JSON.parse(raw.toString()); } catch { return; }
        if (request.kind === "event" || request.kind !== "req") return;
        const data = request.msg_data || {};
        switch (request.msg) {
          case "get_driver_version":
            response(peer, request, "driver_version", { name: "Demo integration", version: { api: "0.15.4", driver: "1.0.0" } });
            break;
          case "get_driver_metadata":
            response(peer, request, "driver_metadata", {
              driver_id: DEMO_EXTERNAL_DRIVER_ID,
              version: "1.0.0",
              min_core_api: "0.17.0",
              name: translated("Virtual Remote demo"),
              description: translated("Standalone Integration API adapter over the same demo catalog and behavior used by Preview mode."),
              developer: { name: "jstnjx" },
              setup_data_schema: {
                title: translated("Demo setup"),
                settings: [{ id: "room", label: translated("Room name"), field: { text: { value: configuredName } } }]
              }
            });
            break;
          case "get_device_state":
            event(peer, "device_state", { state: "CONNECTED" }, "DEVICE");
            break;
          case "get_available_entities":
            response(peer, request, "available_entities", {
              available_entities: [...entities.values()].map(({ attributes, ...definition }) => definition)
            });
            break;
          case "subscribe_events":
            subscriptions.set(peer, new Set(data.entity_ids || []));
            response(peer, request);
            break;
          case "unsubscribe_events": {
            const selected = subscriptions.get(peer) || new Set();
            for (const id of data.entity_ids || []) selected.delete(id);
            subscriptions.set(peer, selected);
            response(peer, request);
            break;
          }
          case "get_entity_states":
            response(peer, request, "entity_states", [...entities.values()]
              .filter((entityRecord) => !data.entity_ids?.length || data.entity_ids.includes(entityRecord.entity_id))
              .map((entityRecord) => ({
                entity_id: entityRecord.entity_id,
                entity_type: entityRecord.entity_type,
                attributes: entityRecord.attributes
              })));
            break;
          case "entity_command": {
            const entityRecord = entities.get(data.entity_id);
            if (!entityRecord) {
              response(peer, request, "result", {}, 404);
              break;
            }
            command(entityRecord.entity_id, data.cmd_id, data.params || {});
            response(peer, request);
            break;
          }
          case "browse_media":
            response(peer, request, "browse_media", browseDemoMedia(data));
            break;
          case "search_media":
            response(peer, request, "search_media", searchDemoMedia(data));
            break;
          case "setup_driver":
            response(peer, request);
            event(peer, "driver_setup_change", { event_type: "SETUP", state: "SETUP" }, "DEVICE");
            setTimeout(() => event(peer, "driver_setup_change", {
              event_type: "SETUP",
              state: "WAIT_USER_ACTION",
              require_user_action: {
                input: {
                  title: translated("Configure demo integration"),
                  settings: [{ id: "room", label: translated("Room name"), field: { text: { value: configuredName, required: true } } }]
                }
              }
            }, "DEVICE"), 100);
            break;
          case "set_driver_user_data":
            configuredName = data.input_values?.room || configuredName;
            response(peer, request);
            event(peer, "driver_setup_change", { event_type: "STOP", state: "OK" }, "DEVICE");
            break;
          default:
            response(peer, request, "result", { message: `Unsupported ${request.msg}` }, 501);
        }
      });
    }
  });

  return {
    host,
    port,
    entities,
    tick,
    command,
    async listen() {
      await socketServer.listen();
      startTimer();
    },
    async close() {
      stopTimer();
      for (const peer of clients) peer.close();
      await socketServer.close();
    }
  };
}

export async function startStandaloneDemoIntegration(options = {}) {
  const integration = createStandaloneDemoIntegration(options);
  await integration.listen();
  return integration;
}
