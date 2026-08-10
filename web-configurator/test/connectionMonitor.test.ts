/**
 * ConnectionMonitor unit tests — docs/specs/001-connection-monitor-rewrite.md §7.2.
 * Test numbers (T1–T20) reference the specification's required-test table.
 */
import { describe, expect, test } from "vitest";
import { ConnectionState } from "../src/api/connection/monitorTypes";
import {
  connectHarness,
  flush,
  setup,
  type Harness,
} from "./helpers/fakeConnection";

const S = ConnectionState;

/** From CONNECTED: device sleeps (close, retries fail, probing), then wakes. */
async function sleepWakeCycle(h: Harness): Promise<void> {
  h.transport.emitClosed(); // CONNECTED → RECONNECT_WAIT (immediate retry)
  await h.clock.advance(0); // → CONNECTING
  h.transport.emitClosed(); // attempt 1 → RECONNECT_WAIT (backoff 500)
  await h.clock.advance(500); // → CONNECTING
  h.transport.emitClosed(); // attempt 2 → PROBING (device presumed down)
  await h.probe.fail();
  await h.clock.advance(3000); // next probe — device is back now
  await h.probe.ok(); // → CONNECTING
  h.transport.emitReady(); // → CONNECTED
  await flush();
}

describe("connect / reconnect lifecycle", () => {
  test("cold start reaches CONNECTED via probe (T8)", async () => {
    const h = setup();
    h.monitor.start();
    expect(h.monitor.snapshot.state).toBe(S.PROBING);
    h.monitor.setAuthenticated(true);
    await h.probe.ok();
    // PROBE_OK while authenticated → CONNECTING immediately, no timer wait
    expect(h.monitor.snapshot.state).toBe(S.CONNECTING);
    expect(h.transport.connectCalls).toBe(1);
    h.transport.emitReady();
    await flush();
    expect(h.monitor.snapshot.state).toBe(S.CONNECTED);
  });

  test("10 consecutive sleep/wake cycles all reconnect (T1)", async () => {
    const h = setup();
    await connectHarness(h);
    for (let i = 0; i < 10; i++) {
      await sleepWakeCycle(h);
      expect(h.monitor.snapshot.state).toBe(S.CONNECTED);
    }
    // 1 initial + 3 per cycle (immediate retry, backoff retry, probe-ok connect)
    expect(h.transport.connectCalls).toBe(1 + 10 * 3);
  });

  test("retry guard reopens after every use — no latch (T2)", async () => {
    const h = setup();
    await connectHarness(h);
    h.transport.emitClosed();
    await h.clock.advance(0);
    expect(h.transport.connectCalls).toBe(2);
    h.transport.emitReady();
    await flush();
    expect(h.monitor.snapshot.state).toBe(S.CONNECTED);
    // second loss must schedule again
    h.transport.emitClosed();
    expect(h.monitor.snapshot.state).toBe(S.RECONNECT_WAIT);
    await h.clock.advance(0);
    expect(h.transport.connectCalls).toBe(3);
  });

  test("error followed by close collapses into one retry (T16)", async () => {
    const h = setup();
    await connectHarness(h);
    const closesBefore = h.transport.closeCalls;
    h.transport.emitError();
    h.transport.emitClosed(); // straggler from the same failure
    expect(h.monitor.snapshot.state).toBe(S.RECONNECT_WAIT);
    await h.clock.advance(0);
    expect(h.transport.connectCalls).toBe(2); // exactly one retry
    expect(h.transport.closeCalls).toBe(closesBefore + 1);
  });

  test("escalates to PROBING after wsAttemptsBeforeProbing failures (T6)", async () => {
    const h = setup();
    h.monitor.start();
    h.monitor.setAuthenticated(true);
    await h.probe.ok(); // → CONNECTING (attempt counter at 0)
    h.transport.emitClosed(); // attempt 1 → RECONNECT_WAIT
    expect(h.monitor.snapshot.state).toBe(S.RECONNECT_WAIT);
    await h.clock.advance(500);
    expect(h.transport.connectCalls).toBe(2);
    h.transport.emitClosed(); // attempt 2 → PROBING
    expect(h.monitor.snapshot.state).toBe(S.PROBING);
    expect(h.probe.pendingCount).toBe(1); // immediate probe
    // no further WS attempts until a probe succeeds
    await h.probe.fail();
    await h.clock.advance(60_000);
    expect(h.transport.connectCalls).toBe(2);
  });

  test("connect guard timeout abandons a hung attempt", async () => {
    const h = setup();
    h.monitor.start();
    h.monitor.setAuthenticated(true);
    await h.probe.ok(); // → CONNECTING, guard armed (4000)
    const closesBefore = h.transport.closeCalls;
    await h.clock.advance(4000); // neither ready nor close arrived
    expect(h.transport.closeCalls).toBe(closesBefore + 1);
    expect(h.monitor.snapshot.state).toBe(S.RECONNECT_WAIT);
  });

  test("transport.connect() throwing counts as attempt failure", async () => {
    const h = setup();
    h.monitor.start();
    h.monitor.setAuthenticated(true);
    h.transport.connectShouldThrow = true;
    await h.probe.ok();
    expect(h.monitor.snapshot.state).toBe(S.RECONNECT_WAIT);
  });
});

describe("backoff", () => {
  test("delays follow min(500·2^(n-1), 5000) with neutral jitter (T7)", async () => {
    const h = setup({ wsAttemptsBeforeProbing: 99 });
    h.monitor.start();
    h.monitor.setAuthenticated(true);
    await h.probe.ok(); // CONNECTING #1
    const expected = [500, 1000, 2000, 4000, 5000, 5000];
    for (const delay of expected) {
      const calls = h.transport.connectCalls;
      h.transport.emitClosed(); // attempt fails → RECONNECT_WAIT
      await h.clock.advance(delay - 1);
      expect(h.transport.connectCalls).toBe(calls);
      await h.clock.advance(1);
      expect(h.transport.connectCalls).toBe(calls + 1);
    }
  });

  test("jitter stays within ±20% bounds (T7)", async () => {
    for (const [rand, factor] of [
      [0, 0.8],
      [1, 1.2],
    ] as const) {
      const h = setup({ wsAttemptsBeforeProbing: 99 });
      h.setRandom(() => rand);
      h.monitor.start();
      h.monitor.setAuthenticated(true);
      await h.probe.ok();
      h.transport.emitClosed(); // attempt 1 → delay 500 * factor
      const delay = 500 * factor;
      await h.clock.advance(delay - 1);
      expect(h.transport.connectCalls).toBe(1);
      await h.clock.advance(1);
      expect(h.transport.connectCalls).toBe(2);
    }
  });

  test("first retry after a healthy session is immediate (T3 timing)", async () => {
    const h = setup();
    await connectHarness(h);
    h.transport.emitClosed();
    await h.clock.advance(0);
    expect(h.transport.connectCalls).toBe(2);
  });
});

describe("heartbeat", () => {
  test("definitive not_open failure reconnects without verification (T3)", async () => {
    const h = setup();
    await connectHarness(h);
    await h.clock.advance(5000); // heartbeat fires
    expect(h.transport.pendingPings.length).toBe(1);
    const closesBefore = h.transport.closeCalls;
    await h.transport.rejectNextPing("not_open");
    expect(h.transport.pendingPings.length).toBe(0); // no verification ping
    expect(h.monitor.snapshot.state).toBe(S.RECONNECT_WAIT);
    expect(h.transport.closeCalls).toBe(closesBefore + 1);
    await h.clock.advance(0);
    expect(h.monitor.snapshot.state).toBe(S.CONNECTING);
  });

  test("timeout triggers immediate verification; second miss is death (T4)", async () => {
    const h = setup();
    await connectHarness(h);
    await h.clock.advance(5000);
    await h.transport.rejectNextPing("timeout");
    expect(h.transport.pendingPings.length).toBe(1); // verification, no interval wait
    expect(h.monitor.snapshot.state).toBe(S.CONNECTED);
    await h.transport.rejectNextPing("timeout");
    expect(h.monitor.snapshot.state).toBe(S.RECONNECT_WAIT);
  });

  test("verification success keeps the session (T5)", async () => {
    const h = setup();
    await connectHarness(h);
    await h.clock.advance(5000);
    await h.transport.rejectNextPing("timeout");
    await h.transport.resolveNextPing(); // verification pong
    expect(h.monitor.snapshot.state).toBe(S.CONNECTED);
    expect(h.monitor.snapshot.attempt).toBe(0);
    await h.clock.advance(5000); // heartbeat continues on schedule
    expect(h.transport.pendingPings.length).toBe(1);
  });

  test("heartbeatIntervalMs is changeable at runtime (OQ-1)", async () => {
    const h = setup();
    await connectHarness(h);
    h.monitor.updateConfig({ heartbeatIntervalMs: 1000 });
    await h.clock.advance(1000);
    expect(h.transport.pendingPings.length).toBe(1);
    await h.transport.resolveNextPing();
    await h.clock.advance(1000);
    expect(h.transport.pendingPings.length).toBe(1);
  });
});

describe("probing", () => {
  test("probe success while unauthenticated only publishes reachability (T9)", async () => {
    const h = setup();
    h.monitor.start();
    await h.probe.ok();
    expect(h.monitor.snapshot.state).toBe(S.PROBING);
    expect(h.monitor.snapshot.deviceReachable).toBe(true);
    expect(h.transport.connectCalls).toBe(0);
    // reachability loss is published too (login page indicator)
    await h.clock.advance(3000);
    await h.probe.fail();
    expect(h.monitor.snapshot.deviceReachable).toBe(false);
  });

  test("probing slows down after probingSlowdownAfterMs unreachable (T12)", async () => {
    const h = setup({ probingSlowdownAfterMs: 10_000 });
    h.monitor.start();
    await h.probe.fail(); // unreachable since t=0
    for (let t = 3000; t <= 12_000; t += 3000) {
      await h.clock.advance(3000);
      await h.probe.fail();
    }
    // now past the slowdown threshold → next interval is 10s
    const calls = h.probe.calls;
    await h.clock.advance(9999);
    expect(h.probe.calls).toBe(calls);
    await h.clock.advance(1);
    expect(h.probe.calls).toBe(calls + 1);
  });

  test("wake hint during slow probing probes immediately at fast cadence (T11)", async () => {
    const h = setup({ probingSlowdownAfterMs: 10_000 });
    h.monitor.start();
    await h.probe.fail();
    for (let i = 0; i < 4; i++) {
      await h.clock.advance(3000);
      await h.probe.fail();
    }
    const calls = h.probe.calls;
    await h.wake.fire("visible");
    expect(h.probe.calls).toBe(calls + 1); // immediate, not after 10s
    await h.probe.fail();
    // back on the fast interval
    await h.clock.advance(3000);
    expect(h.probe.calls).toBe(calls + 2);
  });

  test("PROBING self-heals when an in-flight probe never settles (freeze regression)", async () => {
    // A tab freeze / OS suspend can orphan the in-flight probe request so its
    // promise never resolves or rejects. The old single-flight guard would then
    // latch probeInFlight forever: every runProbe short-circuited and no further
    // probe was ever issued — the app sat on "Reconnecting" with zero network
    // traffic until a manual reload. Recovery must not depend on a wake hint.
    const h = setup();
    h.monitor.start(); // PROBING; probe #1 issued and deliberately left un-settled
    expect(h.probe.calls).toBe(1);
    await h.clock.advance(3000); // interval watchdog fires; probe #1 is now stale
    expect(h.probe.calls).toBe(2); // fresh probe issued, not a silent bail
    await h.clock.advance(3000);
    expect(h.probe.calls).toBe(3);
  });

  test("wake hint replaces an orphaned in-flight probe (freeze regression)", async () => {
    const h = setup();
    h.monitor.start(); // probe #1 issued, left un-settled (frozen request)
    expect(h.probe.calls).toBe(1);
    await h.clock.advance(2500); // past probeTimeoutMs, before the 3s watchdog tick
    expect(h.probe.calls).toBe(1);
    await h.wake.fire("visible"); // returning to the tab
    expect(h.probe.calls).toBe(2); // a fresh probe, not a wait on the orphan
  });

  test("wake hint during a fresh probe preserves single-flight", async () => {
    const h = setup();
    h.monitor.start(); // probe #1 issued
    await h.clock.advance(500); // still well within probeTimeoutMs — fresh
    await h.wake.fire("visible");
    expect(h.probe.calls).toBe(1); // no duplicate probe; single-flight holds
  });

  test("stale probe result from a previous phase is dropped (T15)", async () => {
    const h = setup();
    h.monitor.start();
    h.monitor.setAuthenticated(true); // probe #1 in flight (would connect on ok)
    h.monitor.setAuthenticated(false); // phase change: generation bumped
    await h.probe.ok(); // stale settle
    expect(h.transport.connectCalls).toBe(0); // no CONNECTING from stale result
    expect(h.monitor.snapshot.state).toBe(S.PROBING);
    // and probing continues: the re-armed timer issues the next probe
    await h.clock.advance(3000);
    expect(h.probe.pendingCount).toBe(1);
  });
});

describe("auth transitions", () => {
  test("setAuthenticated(true) in PROBING probes immediately", async () => {
    const h = setup();
    h.monitor.start();
    await h.probe.fail();
    const calls = h.probe.calls;
    h.monitor.setAuthenticated(true);
    await flush();
    expect(h.probe.calls).toBe(calls + 1);
  });

  test("setAuthenticated(false) tears down WS from any active state (T14)", async () => {
    for (const target of [
      "connected",
      "reconnect_wait",
      "connecting",
    ] as const) {
      const h = setup();
      await connectHarness(h);
      if (target !== "connected") {
        h.transport.emitClosed(); // → RECONNECT_WAIT (retry pending)
      }
      if (target === "connecting") {
        await h.clock.advance(0); // → CONNECTING
      }
      const connects = h.transport.connectCalls;
      h.monitor.setAuthenticated(false);
      expect(h.monitor.snapshot.state).toBe(S.PROBING);
      await h.clock.advance(60_000);
      expect(h.transport.connectCalls).toBe(connects); // no WS activity anymore
    }
  });

  test("auth_required is forwarded once; session stays up (T18)", async () => {
    const h = setup();
    await connectHarness(h);
    h.transport.emitAuthRequired();
    expect(h.authRequiredCalls()).toBe(1);
    expect(h.monitor.snapshot.state).toBe(S.CONNECTED);
    await h.clock.advance(5000); // heartbeat still running
    expect(h.transport.pendingPings.length).toBe(1);
  });
});

describe("wake hints", () => {
  test("wake in RECONNECT_WAIT resets attempt and retries now (T10)", async () => {
    const h = setup({ wsAttemptsBeforeProbing: 99 });
    h.monitor.start();
    h.monitor.setAuthenticated(true);
    await h.probe.ok();
    h.transport.emitClosed(); // attempt 1
    await h.clock.advance(500);
    h.transport.emitClosed(); // attempt 2 → waiting 1000ms
    expect(h.monitor.snapshot.attempt).toBe(2);
    await h.wake.fire("online");
    expect(h.monitor.snapshot.attempt).toBe(0);
    await h.clock.advance(0);
    expect(h.monitor.snapshot.state).toBe(S.CONNECTING);
  });

  test("wake in CONNECTED sends an out-of-cycle ping", async () => {
    const h = setup();
    await connectHarness(h);
    await h.wake.fire("visible");
    expect(h.transport.pendingPings.length).toBe(1);
    await h.transport.resolveNextPing();
    expect(h.monitor.snapshot.state).toBe(S.CONNECTED);
  });

  test("bfcache pageshow in CONNECTED declares the socket dead (T20)", async () => {
    const h = setup();
    await connectHarness(h);
    const closesBefore = h.transport.closeCalls;
    await h.wake.fire("pageshow");
    expect(h.transport.closeCalls).toBe(closesBefore + 1);
    expect(h.monitor.snapshot.state).toBe(S.RECONNECT_WAIT);
    await h.clock.advance(0);
    expect(h.monitor.snapshot.state).toBe(S.CONNECTING);
  });
});

describe("stop / lifecycle hygiene", () => {
  test("stop() cancels everything from every state (T13)", async () => {
    const states: Array<(h: Harness) => Promise<void>> = [
      async (h) => {
        h.monitor.start(); // PROBING
      },
      async (h) => {
        h.monitor.start();
        h.monitor.setAuthenticated(true);
        await h.probe.ok(); // CONNECTING
      },
      async (h) => {
        await connectHarness(h); // CONNECTED
      },
      async (h) => {
        await connectHarness(h);
        h.transport.emitClosed(); // RECONNECT_WAIT
      },
    ];
    for (const arrange of states) {
      const h = setup();
      await arrange(h);
      h.monitor.stop();
      expect(h.monitor.snapshot.state).toBe(S.SUSPENDED);
      expect(h.clock.pendingCount).toBe(0);
      const connects = h.transport.connectCalls;
      const probes = h.probe.calls;
      await h.clock.advance(600_000);
      expect(h.transport.connectCalls).toBe(connects);
      expect(h.probe.calls).toBe(probes);
      expect(h.wake.unsubscribed).toBe(1);
    }
  });

  test("start() is idempotent", async () => {
    const h = setup();
    h.monitor.start();
    h.monitor.start();
    expect(h.wake.subscribed).toBe(1);
    expect(h.probe.calls).toBe(1);
  });
});

describe("state publication", () => {
  test("session-established fires with correct reconnect flag (T17)", async () => {
    const h = setup();
    await connectHarness(h);
    expect(h.sessions).toEqual([{ reconnect: false }]);
    await sleepWakeCycle(h);
    expect(h.sessions).toEqual([{ reconnect: false }, { reconnect: true }]);
  });

  test("onChange fires exactly on state/reachability changes (T19)", async () => {
    const h = setup();
    await connectHarness(h);
    await sleepWakeCycle(h);
    // no two consecutive published snapshots may be identical
    for (let i = 1; i < h.changes.length; i++) {
      const a = h.changes[i - 1];
      const b = h.changes[i];
      expect(
        a.state !== b.state || a.deviceReachable !== b.deviceReachable,
      ).toBe(true);
    }
    // heartbeat successes while CONNECTED publish nothing new
    const count = h.changes.length;
    await h.clock.advance(5000);
    await h.transport.resolveNextPing();
    expect(h.changes.length).toBe(count);
  });

  test("snapshot exposes state, reachability, attempt and since", async () => {
    const h = setup();
    h.monitor.start();
    await h.probe.fail();
    const snap = h.monitor.snapshot;
    expect(snap.state).toBe(S.PROBING);
    expect(snap.deviceReachable).toBe(false);
    expect(snap.attempt).toBe(0);
    expect(typeof snap.since).toBe("number");
  });
});
