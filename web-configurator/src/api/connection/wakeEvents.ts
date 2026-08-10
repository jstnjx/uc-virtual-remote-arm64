/**
 * Default browser WakeEventSource for the ConnectionMonitor.
 *
 * Emits a hint whenever the app may have been asleep, hidden, or offline —
 * the monitor reacts with an immediate probe/ping/retry instead of waiting
 * for the next (possibly throttled) timer tick.
 *
 * Note: "pageshow" is only emitted for bfcache restores (event.persisted),
 * where the in-memory WebSocket object is a zombie even if it claims OPEN.
 */
import type { WakeEventSource, WakeHint } from "@/api/connection/monitorTypes";

export const browserWakeEvents: WakeEventSource = {
  subscribe(onWake: (hint: WakeHint) => void): () => void {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        onWake("visible");
      }
    };
    const onOnline = () => onWake("online");
    const onFocus = () => onWake("focus");
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        onWake("pageshow");
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  },
};
