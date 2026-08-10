export type WsMessageData = {
  kind: string;
  msg: string;
  cat?: string;
  ts?: string;
  // Raw socket-frame payload — the untyped ingress boundary (ADR 0002).
  // `normalizeEvent()` derives the typed `WsMsgData` view from this.
  msg_data?: Record<string, any>;
};
export type WsMessageCallback = (
  data: WsMessageData,
  event: MessageEvent,
) => void;

/**
 * Entity-event read models (openspec: ws-and-integration-payload-typing).
 *
 * These are OPEN read models, not validators: every field is optional and an
 * index signature admits unmodelled fields, so a payload carrying an extra key
 * still delivers without a type error (spec `websocket-event-typing`: "Tolerate
 * unmodelled payload fields"). Leaves the app does not model stay `unknown`,
 * never `any`, so reads must narrow (ADR 0002 — contain, don't ban `any`).
 */

/** Running-sequence step carried on activity/macro `attributes.step`. */
export type WsEntityStep = {
  index?: number;
  state?: string;
  [key: string]: unknown;
};

/** `new_state.attributes` as read by subscribers: the running-sequence `state`
 *  / `step` plus any per-entity-type attribute bag (open, `unknown` leaves). */
export type WsEntityAttributes = {
  state?: string;
  step?: WsEntityStep;
  [key: string]: unknown;
};

/** Read model for `new_state`: a superset of every field any current
 *  subscriber reads off the entity state. Merged wholesale into cached
 *  entities; typed reads (`entity_type`, `attributes.state`, …) become compile
 *  errors on a typo instead of silent `undefined`. */
export type WsEntityState = {
  entity_id?: string;
  entity_type?: string;
  group_id?: string;
  attributes?: WsEntityAttributes;
  [key: string]: unknown;
};

/** Read model for `msg_data`: the entity-event envelope delivered to
 *  `socketUpdate` subscribers. `event_type` keeps the raw UPPERCASE casing
 *  (the router lowercases a separate copy). */
export type WsMsgData = {
  entity_id?: string;
  entity_type?: string;
  group_id?: string;
  profile_id?: string;
  dock_id?: string;
  integration_id?: string;
  driver_id?: string;
  event_type?: string;
  new_state?: WsEntityState;
  [key: string]: unknown;
};
