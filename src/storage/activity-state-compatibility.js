import { PlatformDatabase } from "./database.js";

const installMarker = Symbol.for("ucvr.passive-activity-state-persistence");

export function installPassiveActivityStatePersistence() {
  const prototype = PlatformDatabase.prototype;
  if (prototype[installMarker]) return;

  const saveActivity = prototype.saveActivity;
  Object.defineProperty(prototype, installMarker, { value: true });

  prototype.saveActivity = function saveActivityWithPassiveState(input = {}) {
    const hasRequestedState = Boolean(
      input?.attributes
      && Object.prototype.hasOwnProperty.call(input.attributes, "state")
      && input.attributes.state !== undefined
      && input.attributes.state !== null
    );
    const requestedState = hasRequestedState ? String(input.attributes.state) : null;
    const saved = saveActivity.call(this, input);

    if (!hasRequestedState || !saved || String(saved.state) === requestedState) return saved;
    return this.setActivityState(saved.id, requestedState);
  };
}
