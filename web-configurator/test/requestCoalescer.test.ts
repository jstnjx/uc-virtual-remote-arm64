/**
 * Coalescer tests — docs/specs/004-ws-event-handling-rework.md §6.
 * Uses real timers with tiny delays to stay portable across vitest versions.
 */
import { describe, expect, test } from "vitest";
import { createCoalescer } from "../src/composables/requestCoalescer";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createCoalescer", () => {
  test("a burst of N triggers costs one execution after the quiet period", async () => {
    const coalesce = createCoalescer(20);
    let runs = 0;
    for (let i = 0; i < 10; i++) {
      coalesce("k", async () => {
        runs++;
      });
    }
    expect(runs).toBe(0); // trailing edge: nothing during the burst
    await sleep(40);
    expect(runs).toBe(1);
  });

  test("trigger during an in-flight run queues exactly one follow-up", async () => {
    const coalesce = createCoalescer(10);
    let runs = 0;
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((r) => (releaseFirst = r));

    coalesce("k", async () => {
      runs++;
      await firstDone; // hold the first run open
    });
    await sleep(20); // first run started, in flight
    expect(runs).toBe(1);

    coalesce("k", async () => {
      runs++;
    });
    coalesce("k", async () => {
      runs++;
    });
    await sleep(20);
    expect(runs).toBe(1); // still blocked behind the in-flight run

    releaseFirst();
    await sleep(40);
    expect(runs).toBe(2); // exactly one follow-up, not two
  });

  test("independent keys do not interfere", async () => {
    const coalesce = createCoalescer(10);
    const runs: string[] = [];
    coalesce("a", async () => {
      runs.push("a");
    });
    coalesce("b", async () => {
      runs.push("b");
    });
    await sleep(30);
    expect(runs.sort()).toEqual(["a", "b"]);
  });

  test("the latest registered function wins within a burst", async () => {
    const coalesce = createCoalescer(10);
    const runs: string[] = [];
    coalesce("k", async () => {
      runs.push("stale");
    });
    coalesce("k", async () => {
      runs.push("fresh");
    });
    await sleep(30);
    expect(runs).toEqual(["fresh"]);
  });

  test("a failing reload is swallowed and the key recovers", async () => {
    const coalesce = createCoalescer(10);
    let runs = 0;
    coalesce("k", async () => {
      runs++;
      throw new Error("device asleep");
    });
    await sleep(30);
    expect(runs).toBe(1);
    coalesce("k", async () => {
      runs++;
    });
    await sleep(30);
    expect(runs).toBe(2); // key usable again after a failure
  });

  test("a new burst after completion schedules again", async () => {
    const coalesce = createCoalescer(10);
    let runs = 0;
    coalesce("k", async () => {
      runs++;
    });
    await sleep(30);
    coalesce("k", async () => {
      runs++;
    });
    await sleep(30);
    expect(runs).toBe(2);
  });
});
