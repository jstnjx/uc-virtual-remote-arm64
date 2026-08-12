import { DockService } from "./service.js";

export function installCurrentDockApiCompatibility() {
  if (DockService.prototype.command.__ucvrCurrentDockApi) return;
  const previousCommand = DockService.prototype.command;

  const command = function command(id, input = {}) {
    const commandId = String(input.command || input.cmd_id || "").toUpperCase();
    if (commandId !== "SET_VOLUME") return previousCommand.call(this, id, input);

    const dock = this.get(id);
    if (!dock) return null;
    const rawValue = input.volume ?? input.value;
    const volume = Math.max(0, Math.min(100, Math.round(Number(rawValue))));
    if (!Number.isFinite(volume)) {
      throw Object.assign(new Error("SET_VOLUME requires a numeric volume"), { status: 400 });
    }

    dock.volume = volume;
    this.save(dock);
    this.logOutput(id, null, "COMMAND", { ...input, command: commandId, volume });
    this.platform.events.publish("dock.state", {
      dock_id: id,
      state: dock.state,
      command: commandId,
      volume,
    });
    return { code: "OK", volume };
  };

  Object.defineProperty(command, "__ucvrCurrentDockApi", { value: true });
  DockService.prototype.command = command;
}
