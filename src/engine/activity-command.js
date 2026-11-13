// -----------------------------------------------------------------------------
// Activity command normalization
// -----------------------------------------------------------------------------

export function normalizeActivityAction(commandId) {
  const value = String(commandId || "").trim().toLowerCase();
  const action = value.includes(".") ? value.split(".").pop() : value;

  if (["on", "start"].includes(action)) return "on";
  if (action === "off") return "off";
  // Core-API 0.48.3: `activity.stop` aborts a running sequence.
  if (action === "stop") return "stop";

  throw Object.assign(new Error(`Unsupported activity command ${commandId || "<empty>"}`), {
    status: 400
  });
}
