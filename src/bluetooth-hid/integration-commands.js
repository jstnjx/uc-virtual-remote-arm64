function remoteKind(entity) {
  const explicit = String(entity?.kind || entity?.options?.kind || "").toUpperCase();
  if (explicit) return explicit;
  return entity?.bt || entity?.options?.bt ? "BT" : "IR";
}

export function registerBluetoothHidIntegrationCommands(platform) {
  if (platform.integrations.__ucvrBluetoothHidCommandCompatibility) return;
  const previousCommand = platform.integrations.command.bind(platform.integrations);
  platform.integrations.command = async (entityId, commandId, params = undefined) => {
    const entity = platform.db.getConfiguredEntity(entityId);
    if (entity?.entity_type === "remote" && remoteKind(entity) === "BT") {
      const command = String(commandId || "").toLowerCase();
      if (["remote.send_cmd", "send_cmd", "send_command", "remote.send_key", "send_key"].includes(command)) {
        return platform.bluetoothHid.sendRemoteCommand(entity, commandId, params || {});
      }
    }
    return previousCommand(entityId, commandId, params);
  };
  Object.defineProperty(platform.integrations, "__ucvrBluetoothHidCommandCompatibility", { value: true });
}
