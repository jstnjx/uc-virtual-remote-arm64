/**
 * Composition root for the ConnectionMonitor
 * (docs/specs/001-connection-monitor-rewrite.md §6.2).
 *
 * This is the only place where the connection layer and the Pinia stores meet:
 * the monitor and the transports must not import stores themselves. All store
 * access happens lazily inside callbacks, so module-evaluation order and the
 * Pinia lifecycle are never an issue.
 *
 * Debug logging: run `localStorage.setItem("uc.debug.connection", "1")` in the
 * browser console to get one log line per state transition.
 */
import ApiConnection from "@/api";
import ConnectionMonitor from "@/api/connection/ConnectionMonitor";
import { browserWakeEvents } from "@/api/connection/wakeEvents";
import { appStateStore } from "@/stores/appState";
import { authStorage } from "@/stores/auth";

export const connectionMonitor = new ConnectionMonitor({
  transport: ApiConnection.websocket(),
  probe: (timeoutMs) => ApiConnection.rest().probe(timeoutMs),
  onAuthRequired: () => {
    void authStorage().reAuthenticate();
  },
  onChange: (snap) => appStateStore().applyConnectionSnapshot(snap),
  onSessionEstablished: (info) => appStateStore().sessionEstablished(info),
  wakeEvents: browserWakeEvents,
  log: (line) => {
    if (localStorage.getItem("uc.debug.connection")) {
      console.info(line);
    }
  },
});
