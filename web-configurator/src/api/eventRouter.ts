/**
 * EventRouter — single owner of WebSocket event normalization and routing
 * (docs/specs/004-ws-event-handling-rework.md §4.1).
 *
 * Every message is normalized exactly once (entity type from either payload
 * location, lowercased event type, id extraction, running-noise flag) and
 * routed to exactly one owning store per (msg, entityType) — duplicate
 * registration throws unless both sides explicitly opt into sharing.
 *
 * The five hand-copied store handler ladders diverged three times in the same
 * way (REVIEW-Claude-ws-events.md P1-2); this table makes that class of bug
 * structurally impossible.
 */
import ApiConnection from "@/api";
import type {
  WsEntityState,
  WsMessageData,
  WsMsgData,
} from "@/types/websocket";

export type NormalizedEvent = {
  msg: string;
  /** msg_data.new_state.entity_type ?? msg_data.entity_type — events are
   *  inconsistent about placement; normalized once, here, never again. */
  entityType?: string;
  /** Lowercased once. NOTE: msgData itself is NOT modified — discovery/setup
   *  handlers compare msg_data.event_type against UPPERCASE enums. */
  eventType?: string;
  /** entity_id / group_id / profile_id / dock_id / integration_id. */
  entityId?: string;
  newState?: WsEntityState;
  /** The raw, untouched msg_data. */
  msgData: WsMsgData;
  /** The raw, untouched message (some consumers need cat / the full frame). */
  raw: WsMessageData;
  /** Activity/macro running-sequence noise (state=running with step) —
   *  excluded from all overview handling (task doc OQ-3). */
  isRunningNoise: boolean;
};

export type RouteHandler = (e: NormalizedEvent) => void | Promise<unknown>;

type Route = {
  handlers: { name: string; handler: RouteHandler }[];
  shared: boolean;
};

function routeKey(msg: string, entityType?: string): string {
  return entityType ? `${msg}::${entityType}` : msg;
}

export function normalizeEvent(data: WsMessageData): NormalizedEvent {
  const msgData: WsMsgData = data.msg_data ?? {};
  const newState = msgData.new_state;
  const entityType: string | undefined =
    newState?.entity_type ?? msgData.entity_type ?? undefined;
  const eventType: string | undefined =
    typeof msgData.event_type === "string"
      ? msgData.event_type.toLowerCase()
      : undefined;
  const entityId: string | undefined =
    msgData.entity_id ??
    msgData.group_id ??
    msgData.profile_id ??
    msgData.dock_id ??
    msgData.integration_id ??
    undefined;
  const isRunningNoise =
    newState?.attributes?.state?.toLowerCase?.() === "running" &&
    !!newState?.attributes?.step;
  return {
    msg: data.msg,
    entityType,
    eventType,
    entityId,
    newState,
    msgData,
    raw: data,
    isRunningNoise,
  };
}

export class EventRouter {
  private routes = new Map<string, Route>();
  private unroutedLogged = new Set<string>();
  private attached = false;

  constructor(
    private readonly attach?: (dispatch: (data: WsMessageData) => void) => void,
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  /**
   * Register the single owner for (msg, entityType). `entityType` may be an
   * array for stores owning several types. Duplicate registration throws
   * unless BOTH registrations pass `shared: true` (the deliberate dual-owner
   * cases: remote entities → remotes + integrations; profile events →
   * profiles + profile).
   */
  route(
    msg: string,
    entityType: string | string[] | undefined,
    handler: RouteHandler,
    opts: { name?: string; shared?: boolean } = {},
  ): void {
    if (!this.attached && this.attach) {
      this.attached = true;
      this.attach((data) => this.dispatch(data));
    }
    const types = Array.isArray(entityType) ? entityType : [entityType];
    const name = opts.name ?? "anonymous";
    for (const type of types) {
      const key = routeKey(msg, type);
      const existing = this.routes.get(key);
      if (existing) {
        if (!existing.shared || !opts.shared) {
          throw new Error(
            `EventRouter: route "${key}" already owned by "${existing.handlers[0].name}" — ` +
              `exactly one owner per route (use shared:true on BOTH sides for deliberate dual-owners)`,
          );
        }
        existing.handlers.push({ name, handler });
        continue;
      }
      this.routes.set(key, {
        handlers: [{ name, handler }],
        shared: opts.shared === true,
      });
    }
  }

  dispatch(data: WsMessageData): void {
    const event = normalizeEvent(data);
    // most specific first: (msg, entityType), then msg-level
    const route =
      (event.entityType &&
        this.routes.get(routeKey(event.msg, event.entityType))) ||
      this.routes.get(routeKey(event.msg));
    if (!route) {
      const key = routeKey(event.msg, event.entityType);
      if (!this.unroutedLogged.has(key)) {
        this.unroutedLogged.add(key);
        this.log(`[events] no route for "${key}" (logged once)`);
      }
      return;
    }
    for (const { name, handler } of route.handlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((e) =>
            console.error(`[events] async route handler "${name}" rejected`, e),
          );
        }
      } catch (e) {
        // One faulty store handler must not silence a dual-owner peer.
        console.error(`[events] route handler "${name}" threw`, e);
      }
    }
  }
}

/**
 * App-wide router instance, lazily attached to the WebSocket transport on the
 * first route registration. Tests construct their own EventRouter directly.
 */
export const eventRouter = new EventRouter(
  (dispatch) =>
    ApiConnection.websocket().addMessageCallback("eventRouter", (data) =>
      dispatch(data),
    ),
  (line) => {
    if (localStorage.getItem("uc.debug.ws")) {
      console.info(line);
    }
  },
);
