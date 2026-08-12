import { IntegrationConnection } from "./connection.js";
import { WebSocketPeer } from "../protocol/websocket.js";

const owners = new WeakMap();

function driverId(connection) {
  return String(
    connection.record?.driver_id
      || connection.record?.metadata?.driver_id
      || connection.record?.id
      || "unknown",
  );
}

function integrationInstanceIds(connection) {
  const platform = connection.platform;
  const recordId = connection.record?.id;
  if (!platform?.db?.listIntegrations || !recordId) return [];
  const values = [];
  for (const item of platform.db.listIntegrations()) {
    const resolved = platform.integrations?.resolveIntegration?.(item.id);
    if (resolved?.record_id !== recordId) continue;
    const id = String(item.id || "").trim();
    if (id && !values.includes(id)) values.push(id);
  }
  return values;
}

function logServiceId(connection) {
  const platform = connection.platform;
  const recordId = connection.record?.id;
  const candidates = [
    ...(platform?.nativeIntegrations?.services?.() || []),
    ...(platform?.externalIntegrations?.services?.() || []),
  ];
  const service = candidates.find((item) =>
    [item.id, item.driver_id, item.integration_id, item.record_id].filter(Boolean).includes(recordId),
  );
  return String(service?.service || service?.log_id || "").trim() || null;
}

function runtimeInfo(connection) {
  const intgIds = integrationInstanceIds(connection);
  const logId = logServiceId(connection);
  return {
    driver_id: driverId(connection),
    ...(intgIds.length ? { intg_ids: intgIds } : {}),
    ...(logId ? { log_id: logId } : {}),
  };
}

export function installIntegrationRuntimeInfoCompatibility() {
  if (!IntegrationConnection.prototype.connect.__ucvrRuntimeInfo) {
    const nativeConnect = IntegrationConnection.prototype.connect;
    const connect = async function connect(...args) {
      let current = this.socket;
      const descriptor = Object.getOwnPropertyDescriptor(this, "socket");
      if (!descriptor?.get && descriptor?.writable !== false) {
        Object.defineProperty(this, "socket", {
          configurable: true,
          enumerable: true,
          get: () => current,
          set: (value) => {
            current = value;
            if (value && typeof value === "object") owners.set(value, this);
          },
        });
      } else if (current && typeof current === "object") {
        owners.set(current, this);
      }
      return nativeConnect.apply(this, args);
    };
    Object.defineProperty(connect, "__ucvrRuntimeInfo", { value: true });
    IntegrationConnection.prototype.connect = connect;
  }

  if (!WebSocketPeer.prototype.send.__ucvrRuntimeInfo) {
    const nativeSend = WebSocketPeer.prototype.send;
    const send = function send(data, callback = undefined) {
      const owner = owners.get(this);
      if (owner && typeof data === "string") {
        try {
          const payload = JSON.parse(data);
          if (payload?.kind === "resp" && payload.msg === "runtime_info") {
            data = JSON.stringify({ ...payload, msg_data: runtimeInfo(owner) });
          }
        } catch {}
      }
      return nativeSend.call(this, data, callback);
    };
    Object.defineProperty(send, "__ucvrRuntimeInfo", { value: true });
    WebSocketPeer.prototype.send = send;
  }
}

export { runtimeInfo };
