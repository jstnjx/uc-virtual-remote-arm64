/**
 * Types and contracts for the connection lifecycle monitor.
 * See docs/specs/001-connection-monitor-rewrite.md for the full specification.
 *
 * IMPORTANT: nothing in src/api/connection may import from @/stores.
 * State is published exclusively through ConnectionMonitorDeps.onChange.
 */

export enum ConnectionState {
  /** Monitor stopped (app teardown) or never started. */
  SUSPENDED = "suspended",
  /** No usable WebSocket; REST reachability probing. Resting state while unauthenticated. */
  PROBING = "probing",
  /** WebSocket connecting + authenticating (until the server "ready" signal). */
  CONNECTING = "connecting",
  /** WebSocket session authenticated and subscribed; heartbeat active. */
  CONNECTED = "connected",
  /** Connection just lost; short backoff before the next WebSocket attempt. */
  RECONNECT_WAIT = "reconnect_wait",
}

export interface MonitorConfig {
  /** Interval between WebSocket heartbeat pings while CONNECTED. Runtime-changeable. */
  heartbeatIntervalMs: number;
  /** Time to wait for a pong before a heartbeat counts as missed. */
  pongTimeoutMs: number;
  /** Budget for connect + auth handshake before an attempt is abandoned. */
  connectGuardMs: number;
  /** Reconnect backoff: min(retryBaseMs * 2^(attempt-1), retryMaxMs), with jitter. */
  retryBaseMs: number;
  retryMaxMs: number;
  /** Jitter fraction: delay * (1 - j + 2j * random()). */
  retryJitter: number;
  /** Consecutive failed WS attempts before falling back to REST probing. */
  wsAttemptsBeforeProbing: number;
  /** REST probe interval while the device is presumed down. */
  probeIntervalMs: number;
  /** Timeout passed to the probe function. */
  probeTimeoutMs: number;
  /** After this long unreachable, stretch probing to probeIntervalSlowMs. */
  probingSlowdownAfterMs: number;
  probeIntervalSlowMs: number;
}

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  heartbeatIntervalMs: 5_000,
  pongTimeoutMs: 2_000,
  connectGuardMs: 4_000,
  retryBaseMs: 500,
  retryMaxMs: 5_000,
  retryJitter: 0.2,
  wsAttemptsBeforeProbing: 2,
  probeIntervalMs: 3_000,
  probeTimeoutMs: 2_000,
  probingSlowdownAfterMs: 300_000,
  probeIntervalSlowMs: 10_000,
};

export type ConnectionSnapshot = {
  state: ConnectionState;
  /** Last evidence that the device answered anything (probe or WebSocket). */
  deviceReachable: boolean;
  /** Current reconnect attempt counter (telemetry / UI). */
  attempt: number;
  /** clock.now() timestamp of the last state change. */
  since: number;
};

/** Injectable time source so the monitor is fully unit-testable. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type WakeHint = "visible" | "online" | "focus" | "pageshow";

/** Source of "the app may have been asleep/hidden" hints (browser events in production). */
export interface WakeEventSource {
  /** Returns an unsubscribe function. */
  subscribe(onWake: (hint: WakeHint) => void): () => void;
}

export type PingFailureReason =
  /** No pong within the timeout — indeterminate, verify before declaring death. */
  | "timeout"
  /** Socket is not OPEN — definitive, the connection is known dead. */
  | "not_open";

export class PingError extends Error {
  constructor(readonly reason: PingFailureReason) {
    super(`ping failed: ${reason}`);
    this.name = "PingError";
  }
}

export type TransportEvent = "ready" | "closed" | "error" | "auth_required";

/**
 * Passive WebSocket transport contract (implemented by ConnectionWebSocket).
 * The transport performs no reconnection, no scheduling, and no store access.
 */
export interface WsTransport {
  /** Open a fresh socket. Throws if a socket is CONNECTING/OPEN/CLOSING. */
  connect(): void;
  /** Idempotent. Detaches handlers first so no events fire after close(). */
  close(): void;
  /**
   * Application-level ping. Resolves on the matching pong; rejects with
   * PingError("timeout") or PingError("not_open").
   */
  ping(timeoutMs: number): Promise<void>;
  on(event: TransportEvent, handler: () => void): void;
}

export interface ConnectionMonitorDeps {
  transport: WsTransport;
  /**
   * REST reachability probe. Must resolve on any HTTP response (a 401 still
   * proves reachability) and reject only on network error / timeout.
   */
  probe: (timeoutMs: number) => Promise<void>;
  /** Called on server auth_required. Fire-and-forget from the monitor's view. */
  onAuthRequired: () => void;
  /** Sole sink for state publication (wired to appStateStore). */
  onChange: (snap: ConnectionSnapshot) => void;
  /** Resync anchor; reconnect=false on the first session of this monitor run. */
  onSessionEstablished: (info: { reconnect: boolean }) => void;
  clock?: Clock;
  wakeEvents?: WakeEventSource;
  /** Randomness source for backoff jitter (injectable for tests). */
  random?: () => number;
  /** Optional debug logger; one line per transition / notable decision. */
  log?: (line: string) => void;
  config?: Partial<MonitorConfig>;
}
