import { defineStore } from "pinia";

import { ConnectionState } from "@/api/connection/monitorTypes";
import type { ConnectionSnapshot } from "@/api/connection/monitorTypes";
import type {
  ClipboardParamEntityType,
  ClipboardParamEntityItem,
} from "@/types/app";
import type { DeviceButton, TouchSlider } from "@/types/activity";

import { configStore } from "@/stores/config";
import { authStorage } from "@/stores/auth";

interface Clipboard {
  [key: string]: { [key: string]: any };
}

/**
 * Reconnect resync handlers (004-ws-event-handling-rework.md §4.5): WS events
 * missed while the device slept cannot be replayed, so stores register a
 * cheap, conditional refresh (populated lists only, coalesced per store).
 * Module-level: handler functions are not reactive state.
 */
const resyncHandlers = new Map<string, () => void>();

export const appStateStore = defineStore("appState", {
  state: () => ({
    menuOpen: false,
    /**
     * Backward-compatible connectivity flag, derived from the
     * ConnectionMonitor snapshot in applyConnectionSnapshot():
     * - authenticated: true only while the WebSocket session is up
     * - unauthenticated (login page): reflects REST reachability
     * Starts optimistic (true) until the first monitor snapshot arrives.
     */
    connected: true as boolean,
    /** Full connection state for UI that wants more than a boolean. */
    connectionState: ConnectionState.SUSPENDED as ConnectionState,
    /** Last evidence the device answered anything (probe or WebSocket). */
    deviceReachable: false as boolean,
    restarting: false as boolean,
    modalPool: [] as string[],
    modalPoolDisabled: false,
    /**
     * Ids of the open overlays that lock page scroll, a subset of modalPool
     * (ADR 015). Kept separate because dismissal order and scroll locking are
     * different concerns: small popovers join modalPool so ESC closes them, but
     * must not take the scrollbar away from the page behind them.
     */
    scrollLockPool: [] as string[],
    activeDropdown: false,
    editButton: null as DeviceButton | TouchSlider | null,
    // showActivityLists: {
    //   activity: true,
    //   macro: true,
    //   activity_group: false,
    // },
    clipboard: {
      activity: {
        page: null,
        pageItems: [],
        buttonMappingItems: [],
      },
      remote: {
        page: null,
        pageItems: [],
        buttonMappingItems: [],
      },
    } as Clipboard,
    memory: {} as { [key: string]: any },
  }),
  actions: {
    /**
     * Sole writer of the published connection state, fed exclusively by the
     * ConnectionMonitor (docs/specs/001-connection-monitor-rewrite.md §6.3).
     */
    applyConnectionSnapshot(snap: ConnectionSnapshot) {
      this.$state.connectionState = snap.state;
      this.$state.deviceReachable = snap.deviceReachable;
      this.$state.connected = authStorage().isAuthenticated
        ? snap.state === ConnectionState.CONNECTED
        : snap.deviceReachable;
      if (this.$state.connected && this.$state.restarting) {
        this.setRestarting(false);
      }
    },

    /**
     * Fired by the ConnectionMonitor when the WebSocket session is
     * authenticated and subscribed. Resync anchor: stores refresh state
     * that WS events may have missed while the device was asleep.
     *
     * The initial config load is the authentication-triggered REST bootstrap
     * in App.vue (ADR 0013), not this handler. So getAll() runs here only on a
     * reconnect/wake resync — or, on the first connect, as a backstop should the
     * bootstrap not have populated config yet. That avoids a redundant second
     * full fetch on every normal startup; getAll() is also single-flight, so a
     * bootstrap still in flight and this call share one REST round.
     */
    sessionEstablished(info: { reconnect: boolean }) {
      const config = configStore();
      if (info.reconnect || !config.config) {
        void config
          .getAll()
          .catch((e) => console.error("[resync] config refresh failed", e));
      }
      if (info.reconnect) {
        resyncHandlers.forEach((fn, name) => {
          try {
            fn();
          } catch (e) {
            console.error(`[resync] handler "${name}" threw`, e);
          }
        });
      }
    },

    /** Register a reconnect resync handler; last registration per name wins. */
    registerResyncHandler(name: string, fn: () => void) {
      resyncHandlers.set(name, fn);
    },

    toggleMenu() {
      this.$state.menuOpen = !this.$state.menuOpen;
    },

    // toggleActivityList(entityType: string) {
    //   if (entityType == 'activity') {
    //     this.$state.showActivityLists.activity = !this.$state.showActivityLists.activity;
    //   } else if (entityType == 'macro') {
    //     this.$state.showActivityLists.macro = !this.$state.showActivityLists.macro;
    //   } else if (entityType == 'activity_group') {
    //     this.$state.showActivityLists.activity_group = !this.$state.showActivityLists.activity_group;
    //   }
    // },

    setClipboard(
      msg: any,
      entityType: ClipboardParamEntityType,
      item: ClipboardParamEntityItem,
    ) {
      this.$state.clipboard[entityType][item] = msg;
    },

    setRestarting(state: boolean) {
      this.$state.restarting = state;
    },

    closeModal() {
      if (this.$state.modalPoolDisabled) {
        return false;
      }

      if (this.$state.modalPool && this.$state.modalPool.length > 0) {
        this.$state.modalPool.pop();
      }
    },

    setEditButton(button: DeviceButton | TouchSlider) {
      this.$state.editButton = button;
    },

    clearEditButton() {
      this.$state.editButton = null;
    },

    readMemory(key: string) {
      return this.$state.memory[key] || null;
    },

    writeMemory(key: string, value: any) {
      this.$state.memory[key] = value;
    },

    resetMemoryItem(key: string) {
      delete this.$state.memory[key];
    },
  },
});
