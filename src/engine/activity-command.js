// -----------------------------------------------------------------------------
// Activity command normalization
// -----------------------------------------------------------------------------

export function normalizeActivityAction(commandId) {
  const value = String(commandId || "").trim().toLowerCase();
  const action = value.includes(".") ? value.split(".").pop() : value;

  if (["on", "start"].includes(action)) return "on";
  if (["off", "stop"].includes(action)) return "off";

  throw Object.assign(new Error(`Unsupported activity command ${commandId || "<empty>"}`), {
    status: 400
  });
}
