/**
 * Request coalescing for WebSocket-event-triggered reloads
 * (docs/specs/004-ws-event-handling-rework.md §3.2).
 *
 * Trailing-edge debounced, single-flight execution per key:
 * - a burst of N triggers costs ONE execution, after the burst quiets
 * - a trigger arriving while an execution is in flight queues exactly one
 *   follow-up run (the data may have changed since the running request began)
 * - independent keys do not affect each other
 */

type Entry = {
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  rerun: boolean;
  fn: () => Promise<unknown>;
};

export type Coalesce = (key: string, fn: () => Promise<unknown>) => void;

export function createCoalescer(delayMs = 250): Coalesce {
  const entries = new Map<string, Entry>();

  function run(key: string): void {
    const entry = entries.get(key);
    if (!entry) {
      return;
    }
    entry.timer = null;
    if (entry.inFlight) {
      entry.rerun = true; // follow up once the active run settles
      return;
    }
    entry.inFlight = true;
    entry
      .fn()
      .catch((e) => {
        // Reloads are best-effort cache refreshes; failures must not propagate
        // into the WS dispatch. The next event triggers a new attempt anyway.
        console.warn(`[coalesce] "${key}" reload failed`, e);
      })
      .finally(() => {
        entry.inFlight = false;
        if (entry.rerun) {
          entry.rerun = false;
          entry.timer = setTimeout(() => run(key), delayMs);
        } else {
          entries.delete(key);
        }
      });
  }

  return function coalesce(key: string, fn: () => Promise<unknown>): void {
    const entry = entries.get(key) ?? {
      timer: null,
      inFlight: false,
      rerun: false,
      fn,
    };
    entry.fn = fn; // latest closure wins (fresh page/filter arguments)
    entries.set(key, entry);
    if (entry.inFlight) {
      entry.rerun = true;
      return;
    }
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
    }
    entry.timer = setTimeout(() => run(key), delayMs);
  };
}
