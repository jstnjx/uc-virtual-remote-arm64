/**
 * ConnectionMonitor — single owner of the connection lifecycle.
 *
 * Implements the state machine specified in docs/specs/001-connection-monitor-rewrite.md
 * (§4). The transition table in that document is normative; if this code and the
 * table disagree, one of them has a bug — fix both together.
 *
 * Ownership rules:
 *  - Every connection-related timer lives here and nowhere else.
 *  - The transport and the probe are passive; they never decide to (re)connect.
 *  - No imports from @/stores — state is published via deps.onChange only.
 */
import {
  ConnectionState,
  DEFAULT_MONITOR_CONFIG,
  PingError,
} from "@/api/connection/monitorTypes";
import type {
  Clock,
  ConnectionMonitorDeps,
  ConnectionSnapshot,
  MonitorConfig,
  WakeEventSource,
  WakeHint,
  WsTransport,
} from "@/api/connection/monitorTypes";

type TimerName = "heartbeat" | "retry" | "probe" | "guard";

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const noop = (): void => undefined;

const noWakeEvents: WakeEventSource = {
  subscribe: () => noop,
};

export default class ConnectionMonitor {
  private state: ConnectionState = ConnectionState.SUSPENDED;
  private authenticated = false;
  private deviceReachable = false;
  private attempt = 0;
  private since: number;

  /** Incremented on every state entry; async results from older generations are dropped. */
  private generation = 0;
  private hadSession = false;
  /**
   * In-flight guards. The token ensures only the call that set the flag clears
   * it — a stale settle must not release a flag owned by a newer call.
   */
  private probeInFlight = false;
  private probeToken = 0;
  /** clock.now() when the in-flight probe was issued (staleness detection). */
  private probeStartedAt = 0;
  private heartbeatInFlight = false;
  private heartbeatToken = 0;
  /** Set on the first failed probe after reachability, cleared on success. */
  private unreachableSince: number | null = null;

  private timers: Record<TimerName, unknown> = {
    heartbeat: null,
    retry: null,
    probe: null,
    guard: null,
  };

  private cfg: MonitorConfig;
  private readonly transport: WsTransport;
  private readonly probeFn: (timeoutMs: number) => Promise<void>;
  private readonly onAuthRequired: () => void;
  private readonly onChange: (snap: ConnectionSnapshot) => void;
  private readonly onSessionEstablished: (info: { reconnect: boolean }) => void;
  private readonly clock: Clock;
  private readonly wakeEvents: WakeEventSource;
  private readonly random: () => number;
  private readonly log: (line: string) => void;

  private unsubscribeWake: (() => void) | null = null;
  private lastPublished: {
    state: ConnectionState;
    deviceReachable: boolean;
  } | null = null;

  constructor(deps: ConnectionMonitorDeps) {
    this.transport = deps.transport;
    this.probeFn = deps.probe;
    this.onAuthRequired = deps.onAuthRequired;
    this.onChange = deps.onChange;
    this.onSessionEstablished = deps.onSessionEstablished;
    this.clock = deps.clock ?? realClock;
    this.wakeEvents = deps.wakeEvents ?? noWakeEvents;
    this.random = deps.random ?? Math.random;
    this.log = deps.log ?? noop;
    this.cfg = { ...DEFAULT_MONITOR_CONFIG, ...deps.config };
    this.since = this.clock.now();

    this.transport.on("ready", () => this.onWsReady());
    this.transport.on("closed", () => this.onWsClosedOrError("closed"));
    this.transport.on("error", () => this.onWsClosedOrError("error"));
    this.transport.on("auth_required", () => this.onWsAuthRequired());
  }

  // ------------------------------------------------------------------ public

  get snapshot(): ConnectionSnapshot {
    return {
      state: this.state,
      deviceReachable: this.deviceReachable,
      attempt: this.attempt,
      since: this.since,
    };
  }

  start(): void {
    if (this.state !== ConnectionState.SUSPENDED) {
      return;
    }
    this.unsubscribeWake = this.wakeEvents.subscribe((hint) =>
      this.wakeHintInternal(hint),
    );
    this.enterProbing("start");
  }

  stop(): void {
    this.generation++;
    this.clearAllTimers();
    this.transport.close();
    if (this.unsubscribeWake) {
      this.unsubscribeWake();
      this.unsubscribeWake = null;
    }
    this.deviceReachable = false;
    this.attempt = 0;
    this.setState(ConnectionState.SUSPENDED, "stop");
  }

  /** Definitive auth transitions only (AUTHORISED / ANONYMOUS). */
  setAuthenticated(authenticated: boolean): void {
    if (this.authenticated === authenticated) {
      return;
    }
    this.authenticated = authenticated;
    if (this.state === ConnectionState.SUSPENDED) {
      return;
    }
    if (!authenticated) {
      // Any active WS machinery must stop; fall back to reachability probing.
      this.transport.close();
      this.enterProbing("auth lost");
      return;
    }
    if (this.state === ConnectionState.PROBING) {
      // Fast path to CONNECTING via an immediate probe.
      this.clearTimer("probe");
      void this.runProbe();
    }
  }

  /** Manual wake hint (e.g. a "check now" UI action). */
  wakeHint(): void {
    this.wakeHintInternal("visible");
  }

  /**
   * Merge new config values at runtime (OQ-1: heartbeat cadence is an expert
   * user option). Takes effect immediately: the currently armed periodic timer
   * is re-armed with the new interval.
   */
  updateConfig(partial: Partial<MonitorConfig>): void {
    this.cfg = { ...this.cfg, ...partial };
    if (
      this.state === ConnectionState.CONNECTED &&
      this.timers.heartbeat !== null
    ) {
      this.armHeartbeat();
    }
    if (this.state === ConnectionState.PROBING && this.timers.probe !== null) {
      this.armProbe();
    }
  }

  // ----------------------------------------------------------- transport events

  private onWsReady(): void {
    if (this.state !== ConnectionState.CONNECTING) {
      this.log(`[conn] ignoring ready in ${this.state}`);
      return;
    }
    this.clearTimer("guard");
    this.attempt = 0;
    this.deviceReachable = true;
    const reconnect = this.hadSession;
    this.hadSession = true;
    this.setState(ConnectionState.CONNECTED, "ws ready");
    this.armHeartbeat();
    this.onSessionEstablished({ reconnect });
  }

  private onWsClosedOrError(kind: "closed" | "error"): void {
    switch (this.state) {
      case ConnectionState.CONNECTING:
        this.attemptFailed(`ws ${kind} while connecting`);
        return;
      case ConnectionState.CONNECTED:
        this.connectionLost(`ws ${kind}`);
        return;
      default:
        // Stragglers from an already-abandoned socket: nothing to do.
        this.log(`[conn] ignoring ws ${kind} in ${this.state}`);
    }
  }

  private onWsAuthRequired(): void {
    if (
      this.state !== ConnectionState.CONNECTED &&
      this.state !== ConnectionState.CONNECTING
    ) {
      return;
    }
    // Re-auth runs over REST beside the open socket (OQ-2: a new session can be
    // established in place). A definitive auth failure arrives later via
    // setAuthenticated(false).
    this.onAuthRequired();
  }

  // ------------------------------------------------------------------ probing

  private enterProbing(reason: string): void {
    this.generation++;
    this.clearAllTimers();
    this.attempt = 0;
    this.unreachableSince = null;
    this.setState(ConnectionState.PROBING, reason);
    void this.runProbe();
  }

  private async runProbe(): Promise<void> {
    if (this.state !== ConnectionState.PROBING) {
      return;
    }
    if (this.probeInFlight && !this.probeStalled()) {
      // Single-flight: a probe issued moments ago is still pending. Re-arm the
      // interval timer instead of bailing silently so PROBING can never end up
      // with neither a timer nor an in-flight probe.
      this.armProbe();
      return;
    }
    // No probe in flight, or the previous one has outlived its own timeout and
    // is presumed orphaned: a tab freeze / OS suspend can leave an in-flight
    // request suspended so its promise never settles. Without replacing it,
    // probeInFlight would latch forever and every future probe would short-
    // circuit above — the app would sit on "Reconnecting" with zero network
    // traffic until a manual reload. Bumping the token below detaches any late
    // settle of the orphaned probe. armProbe() is called up front so probing
    // keeps ticking even if this probe never settles: recovery must not depend
    // on a wake hint firing.
    this.probeInFlight = true;
    this.probeStartedAt = this.clock.now();
    const token = ++this.probeToken;
    const gen = this.generation;
    this.armProbe();
    let ok: boolean;
    try {
      await this.probeFn(this.cfg.probeTimeoutMs);
      ok = true;
    } catch {
      ok = false;
    }
    if (token !== this.probeToken) {
      return; // superseded by a newer probe — it owns the guard and the decision
    }
    this.probeInFlight = false;
    if (gen !== this.generation || this.state !== ConnectionState.PROBING) {
      return; // stale result from a previous lifecycle phase (spec P2-3)
    }
    if (ok) {
      this.unreachableSince = null;
      this.setReachable(true);
      if (this.authenticated) {
        this.startConnecting("probe ok");
        return;
      }
      this.armProbe();
    } else {
      if (this.unreachableSince === null) {
        this.unreachableSince = this.clock.now();
      }
      this.setReachable(false);
      this.armProbe();
    }
  }

  /**
   * True when the in-flight probe has outlived its own request timeout and is
   * therefore presumed orphaned — e.g. its underlying request was suspended by
   * a tab freeze and will never settle. This separates a genuinely fresh probe
   * (single-flight should wait for it) from a stuck one that must be replaced
   * so probing keeps making progress. A healthy probe always settles within
   * probeTimeoutMs, well before the next interval tick.
   */
  private probeStalled(): boolean {
    return this.clock.now() - this.probeStartedAt >= this.cfg.probeTimeoutMs;
  }

  private currentProbeInterval(): number {
    if (
      this.unreachableSince !== null &&
      this.clock.now() - this.unreachableSince > this.cfg.probingSlowdownAfterMs
    ) {
      return this.cfg.probeIntervalSlowMs;
    }
    return this.cfg.probeIntervalMs;
  }

  private armProbe(): void {
    this.armTimer(
      "probe",
      this.currentProbeInterval(),
      () => void this.runProbe(),
    );
  }

  // --------------------------------------------------------------- connecting

  private startConnecting(reason: string): void {
    this.generation++;
    this.clearAllTimers();
    this.setState(ConnectionState.CONNECTING, reason);
    this.armTimer("guard", this.cfg.connectGuardMs, () => {
      this.transport.close();
      this.attemptFailed("connect guard timeout");
    });
    try {
      this.transport.connect();
    } catch (e) {
      this.log(`[conn] transport.connect() threw: ${String(e)}`);
      this.clearTimer("guard");
      this.attemptFailed("connect threw");
    }
  }

  private attemptFailed(reason: string): void {
    this.clearTimer("guard");
    this.attempt++;
    if (this.attempt >= this.cfg.wsAttemptsBeforeProbing) {
      // Device presumed down: REST probing is cheaper than WS upgrade attempts.
      const attempt = this.attempt;
      this.enterProbing(`${reason} (attempt ${attempt})`);
      return;
    }
    this.setState(ConnectionState.RECONNECT_WAIT, reason);
    this.armRetry(this.retryDelay());
  }

  /** Connection lost from CONNECTED: first retry is immediate (LAN blips are common). */
  private connectionLost(reason: string): void {
    this.generation++;
    this.clearAllTimers();
    this.transport.close(); // idempotent; forces closure when we declared death ourselves
    this.attempt = 0;
    this.setReachable(false);
    this.setState(ConnectionState.RECONNECT_WAIT, reason);
    this.armRetry(0);
  }

  private retryDelay(): number {
    const exp = Math.min(
      this.cfg.retryBaseMs * 2 ** Math.max(this.attempt - 1, 0),
      this.cfg.retryMaxMs,
    );
    const j = this.cfg.retryJitter;
    return Math.round(exp * (1 - j + 2 * j * this.random()));
  }

  private armRetry(delayMs: number): void {
    this.armTimer("retry", delayMs, () => {
      if (this.state === ConnectionState.RECONNECT_WAIT) {
        this.startConnecting("retry timer");
      }
    });
  }

  // ---------------------------------------------------------------- heartbeat

  private armHeartbeat(): void {
    this.armTimer(
      "heartbeat",
      this.cfg.heartbeatIntervalMs,
      () => void this.runHeartbeat(false),
    );
  }

  private async runHeartbeat(verification: boolean): Promise<void> {
    if (this.state !== ConnectionState.CONNECTED) {
      return;
    }
    if (this.heartbeatInFlight) {
      // An older ping (from before a reconnect) hasn't settled; keep the
      // heartbeat alive rather than silently dropping the cycle.
      this.armHeartbeat();
      return;
    }
    this.heartbeatInFlight = true;
    const token = ++this.heartbeatToken;
    const gen = this.generation;
    let failure: PingError | null = null;
    try {
      await this.transport.ping(this.cfg.pongTimeoutMs);
    } catch (e) {
      failure = e instanceof PingError ? e : new PingError("timeout");
    }
    if (token === this.heartbeatToken) {
      this.heartbeatInFlight = false;
    }
    if (gen !== this.generation || this.state !== ConnectionState.CONNECTED) {
      return;
    }
    if (failure === null) {
      this.setReachable(true);
      this.armHeartbeat();
      return;
    }
    if (failure.reason === "not_open") {
      // Definitive: no counting, no verification (spec P1-1).
      this.connectionLost("heartbeat: socket not open");
      return;
    }
    if (verification) {
      this.connectionLost("heartbeat: verification ping missed");
      return;
    }
    // Indeterminate single miss: verify immediately instead of waiting a full interval.
    this.log("[conn] heartbeat miss, sending verification ping");
    void this.runHeartbeat(true);
  }

  // -------------------------------------------------------------- wake hints

  private wakeHintInternal(hint: WakeHint): void {
    switch (this.state) {
      case ConnectionState.PROBING:
        // Reset the slow-probing clock and probe right now.
        this.unreachableSince = null;
        this.clearTimer("probe");
        void this.runProbe();
        return;
      case ConnectionState.RECONNECT_WAIT:
        this.attempt = 0;
        this.clearTimer("retry");
        this.armRetry(0);
        return;
      case ConnectionState.CONNECTED:
        if (hint === "pageshow") {
          // bfcache restore: the socket object is a zombie even if it claims
          // OPEN. Declaring death directly is cheaper and always correct here.
          this.connectionLost("pageshow (bfcache restore)");
          return;
        }
        // Out-of-cycle ping for fast zombie detection after sleep/hide.
        this.clearTimer("heartbeat");
        void this.runHeartbeat(false);
        return;
      default:
        return; // CONNECTING and SUSPENDED: nothing useful to do
    }
  }

  // ------------------------------------------------------------------ helpers

  private armTimer(name: TimerName, ms: number, fn: () => void): void {
    this.clearTimer(name);
    this.timers[name] = this.clock.setTimeout(() => {
      this.timers[name] = null; // reopen before running — never a latched guard
      fn();
    }, ms);
  }

  private clearTimer(name: TimerName): void {
    if (this.timers[name] !== null) {
      this.clock.clearTimeout(this.timers[name]);
      this.timers[name] = null;
    }
  }

  private clearAllTimers(): void {
    (Object.keys(this.timers) as TimerName[]).forEach((name) =>
      this.clearTimer(name),
    );
  }

  private setState(next: ConnectionState, reason: string): void {
    if (next !== this.state) {
      this.log(
        `[conn] ${this.state} -> ${next} (${reason}) attempt=${this.attempt}`,
      );
      this.state = next;
      this.since = this.clock.now();
    }
    this.publish();
  }

  private setReachable(reachable: boolean): void {
    this.deviceReachable = reachable;
    this.publish();
  }

  /** Publish exactly when state or reachability changed (spec §7.2 T19). */
  private publish(): void {
    const last = this.lastPublished;
    if (
      last &&
      last.state === this.state &&
      last.deviceReachable === this.deviceReachable
    ) {
      return;
    }
    this.lastPublished = {
      state: this.state,
      deviceReachable: this.deviceReachable,
    };
    this.onChange(this.snapshot);
  }
}
