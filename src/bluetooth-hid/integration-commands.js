import { IntegrationManager } from "../integrations/manager.js";

function remoteKind(entity) {
  const explicit = String(entity?.kind || entity?.options?.kind || "").toUpperCase();
  if (explicit) return explicit;
  return entity?.bt || entity?.options?.bt ? "BT" : "IR";
}

export function installBluetoothHidIntegrationCommands() {
  if (IntegrationManager.prototype.command.__ucvrBluetoothHidCommandCompatibility) return;
  const previousCommand = IntegrationManager.prototype.command;
  const command = async function command(entityId, commandId, params = undefined) {
    const entity = this.platform?.db?.getConfiguredEntity?.(entityId);
    if (entity?.entity_type === "remote" && remoteKind(entity) === "BT") {
      const commandIdValue = String(commandId || "").toLowerCase();
      if (["remote.send_cmd", "send_cmd", "send_command", "remote.send_key", "send_key"].includes(commandIdValue)) {
        return this.platform.bluetoothHid.sendRemoteCommand(entity, commandId, params || {});
      }
    }
    return previousCommand.call(this, entityId, commandId, params);
  };
  Object.defineProperty(command, "__ucvrBluetoothHidCommandCompatibility", { value: true });
  IntegrationManager.prototype.command = command;
}
