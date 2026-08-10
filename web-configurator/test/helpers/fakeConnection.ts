/**
 * Test doubles for ConnectionMonitor unit tests
 * (docs/specs/001-connection-monitor-rewrite.md §7.1).
 */
import ConnectionMonitor from "../../src/api/connection/ConnectionMonitor";
import { PingError } from "../../src/api/connection/monitorTypes";
import type {
  Clock,
  ConnectionSnapshot,
  MonitorConfig,
  PingFailureReason,
  TransportEvent,
  WakeEventSource,
  WakeHint,
  WsTransport,
} from "../../src/api/connection/monitorTypes";

// ---------------------------------------------------------------------------

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let pending promise callbacks (then/catch chains) run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------

/**
 * Deterministic clock. Timers only fire via advance(); microtasks are flushed
 * after each fired timer so promise chains settle in order.
 */
export class FakeClock implements Clock {
  private t = 0;
  private seq = 0;
  private tasks: { at: number; fn: () => void; id: number }[] = [];

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.tasks.push({ at: this.t + Math.max(ms, 0), fn, id });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks = this.tasks.filter((task) => task.id !== handle);
  }

  get pendingCount(): number {
    return this.tasks.length;
  }

  /** Advance time, firing due timers in order, flushing microtasks between. */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      const due = this.tasks
        .filter((task) => task.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) {
        break;
      }
      this.tasks = this.tasks.filter((task) => task.id !== due.id);
      this.t = due.at;
      due.fn();
      await flush();
    }
    this.t = target;
    await flush();
  }
}

// ---------------------------------------------------------------------------

export class FakeTransport implements WsTransport {
  connectCalls = 0;
  closeCalls = 0;
  connectShouldThrow = false;
  pendingPings: Deferred<void>[] = [];
  private handlers: Record<TransportEvent, Array<() => void>> = {
    ready: [],
    closed: [],
    error: [],
    auth_required: [],
  };

  connect(): void {
    this.connectCalls++;
    if (this.connectShouldThrow) {
      throw new Error("connect failed");
    }
  }

  close(): void {
    this.closeCalls++;
  }

  ping(timeoutMs: number): Promise<void> {
    void timeoutMs; // signature parity with WsTransport; the test settles pings manually
    const d = deferred<void>();
    this.pendingPings.push(d);
    return d.promise;
  }

  on(event: TransportEvent, handler: () => void): void {
    this.handlers[event].push(handler);
  }

  private emit(event: TransportEvent): void {
    this.handlers[event].forEach((h) => h());
  }

  emitReady(): void {
    this.emit("ready");
  }
  emitClosed(): void {
    this.emit("closed");
  }
  emitError(): void {
    this.emit("error");
  }
  emitAuthRequired(): void {
    this.emit("auth_required");
  }

  private takeNextPing(): Deferred<void> {
    const next = this.pendingPings.shift();
    if (!next) {
      throw new Error("no pending ping to settle");
    }
    return next;
  }

  async resolveNextPing(): Promise<void> {
    this.takeNextPing().resolve();
    await flush();
  }

  async rejectNextPing(reason: PingFailureReason): Promise<void> {
    this.takeNextPing().reject(new PingError(reason));
    await flush();
  }
}

// ---------------------------------------------------------------------------

export class FakeProbe {
  calls = 0;
  private queue: Deferred<void>[] = [];

  readonly fn = (timeoutMs: number): Promise<void> => {
    void timeoutMs; // signature parity with the probe contract
    this.calls++;
    const d = deferred<void>();
    this.queue.push(d);
    return d.promise;
  };

  get pendingCount(): number {
    return this.queue.length;
  }

  private takeNext(): Deferred<void> {
    const next = this.queue.shift();
    if (!next) {
      throw new Error("no pending probe to settle");
    }
    return next;
  }

  async ok(): Promise<void> {
    this.takeNext().resolve();
    await flush();
  }

  async fail(): Promise<void> {
    this.takeNext().reject(new Error("network error"));
    await flush();
  }
}

// ---------------------------------------------------------------------------

export class FakeWake implements WakeEventSource {
  subscribed = 0;
  unsubscribed = 0;
  private listener: ((hint: WakeHint) => void) | null = null;

  subscribe(onWake: (hint: WakeHint) => void): () => void {
    this.subscribed++;
    this.listener = onWake;
    return () => {
      this.unsubscribed++;
      this.listener = null;
    };
  }

  async fire(hint: WakeHint): Promise<void> {
    this.listener?.(hint);
    await flush();
  }
}

// ---------------------------------------------------------------------------

export type Harness = {
  monitor: ConnectionMonitor;
  clock: FakeClock;
  transport: FakeTransport;
  probe: FakeProbe;
  wake: FakeWake;
  changes: ConnectionSnapshot[];
  sessions: { reconnect: boolean }[];
  authRequiredCalls: () => number;
  setRandom: (r: () => number) => void;
};

export function setup(config: Partial<MonitorConfig> = {}): Harness {
  const clock = new FakeClock();
  const transport = new FakeTransport();
  const probe = new FakeProbe();
  const wake = new FakeWake();
  const changes: ConnectionSnapshot[] = [];
  const sessions: { reconnect: boolean }[] = [];
  let authRequired = 0;
  let random: () => number = () => 0.5; // jitter factor exactly 1.0 → deterministic delays

  const monitor = new ConnectionMonitor({
    transport,
    probe: probe.fn,
    onAuthRequired: () => {
      authRequired++;
    },
    onChange: (snap) => changes.push(snap),
    onSessionEstablished: (info) => sessions.push(info),
    clock,
    wakeEvents: wake,
    random: () => random(),
    config,
  });

  return {
    monitor,
    clock,
    transport,
    probe,
    wake,
    changes,
    sessions,
    authRequiredCalls: () => authRequired,
    setRandom: (r) => {
      random = r;
    },
  };
}

/** Drive the harness from cold start into CONNECTED. */
export async function connectHarness(h: Harness): Promise<void> {
  h.monitor.start();
  h.monitor.setAuthenticated(true);
  await h.probe.ok(); // PROBING → CONNECTING
  h.transport.emitReady(); // CONNECTING → CONNECTED
  await flush();
}
