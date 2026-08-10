/**
 * ConnectionWebSocket — passive WebSocket transport.
 *
 * Implements the WsTransport contract used by ConnectionMonitor
 * (docs/specs/001-connection-monitor-rewrite.md §5.2). The transport performs no
 * reconnection, no scheduling and no store access — the ConnectionMonitor owns
 * the connection lifecycle and is the only caller of connect()/close()/ping().
 *
 * Store-facing message dispatch (addMessageCallback) is unchanged.
 */
import type { WsMessageCallback } from "@/types/websocket";
import type { ConnectionSetup } from "@/api/connection/index";
import { PingError } from "@/api/connection/monitorTypes";
import type {
  TransportEvent,
  WsTransport,
} from "@/api/connection/monitorTypes";

type PendingPing = {
  resolve: () => void;
  reject: (e: PingError) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Per-message logging is opt-in via localStorage (also works in production
 * builds for support diagnostics). The former bare import.meta.env.DEV gating
 * made everyone profiling on the dev server measure the logger's
 * console.trace() instead of the app (004-ws-event-handling-rework.md §4.6).
 */
function wsDebug(): boolean {
  return (
    typeof localStorage !== "undefined" && !!localStorage.getItem("uc.debug.ws")
  );
}

export default class ConnectionWebSocket implements WsTransport {
  /**
   * API host.
   * @protected
   */
  protected _host: string;
  protected _config: ConnectionSetup;
  protected socket: WebSocket | null = null;

  protected counter = 0;
  protected pingSeq = 0;

  protected message: Map<string, WsMessageCallback> = new Map();
  protected listeners: Record<TransportEvent, Array<() => void>> = {
    ready: [],
    closed: [],
    error: [],
    auth_required: [],
  };
  /** In-flight pings keyed by the echoed msg_data.time value. */
  protected pendingPings: Map<number, PendingPing> = new Map();

  constructor(config: ConnectionSetup) {
    this._config = { ...config };
    let url = this._config.baseUrl;
    if (url === "/") {
      url = location.protocol + "//" + location.host;
    }

    if (url.match(/^https?:\/\//)) {
      url = url.replace(/http?/, "ws");
    }
    url = url.replace(/\/$/, "");
    this._host = `${url}/ws`;
  }

  // ------------------------------------------------------- WsTransport contract

  on(event: TransportEvent, handler: () => void): void {
    this.listeners[event].push(handler);
  }

  /**
   * Open a fresh socket. Throws if a socket is CONNECTING/OPEN/CLOSING —
   * the monitor guarantees it never double-connects; a throw here means a
   * lifecycle bug, not a condition to paper over.
   */
  connect(): void {
    if (this.hasActiveOrClosingSocket()) {
      throw new Error("WebSocket already active");
    }

    const socket = new WebSocket(this._host);
    this.socket = socket;

    socket.addEventListener("error", (ev: Event) => {
      if (import.meta.env.DEV) {
        console.info("[WS:event:error]", ev);
      }
      if (this.socket === socket) {
        this.emit("error");
      }
    });

    socket.addEventListener("open", () => {
      // open ≠ ready: the session is usable only after the server's
      // "authentication" message (see the message handler below).
      if (import.meta.env.DEV) {
        console.info("[WS:event:open]");
      }
    });

    socket.addEventListener("message", (ev: MessageEvent) => {
      if (this.socket === socket) {
        this.handleMessage(ev);
      }
    });

    socket.addEventListener("close", (ev: CloseEvent) => {
      if (import.meta.env.DEV) {
        console.info("[WS:event:close]", ev.code, ev.reason);
      }
      if (this.socket === socket) {
        this.socket = null;
        this.rejectAllPings();
        this.emit("closed");
      }
    });
  }

  /** Idempotent. Detaches first so no transport events fire after close(). */
  close(): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    this.socket = null; // identity guards turn the socket's events into no-ops
    this.rejectAllPings();
    try {
      socket.close();
    } catch {
      // closing an already-dead socket must never throw into the monitor
    }
  }

  /**
   * Application-level ping. Resolves on the matching pong; rejects with
   * PingError("not_open") when no open socket exists (definitive) or
   * PingError("timeout") when no pong arrives in time (indeterminate).
   */
  ping(timeoutMs: number): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new PingError("not_open"));
    }
    const time = ++this.pingSeq; // opaque echo value; only uniqueness matters
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPings.delete(time);
        reject(new PingError("timeout"));
      }, timeoutMs);
      this.pendingPings.set(time, { resolve, reject, timer });
      this.doSend({
        kind: "req",
        msg: "ping",
        msg_data: {
          time,
        },
      });
    });
  }

  // ------------------------------------------------------------------ messages

  protected handleMessage(ev: MessageEvent): void {
    let data;
    try {
      data = JSON.parse(ev.data);
    } catch (e) {
      console.warn("[WS] malformed message ignored", e);
      return;
    }
    if (data.msg === "auth_required") {
      this.emit("auth_required");
      return;
    }
    if (data.msg === "authentication") {
      // WebSocket connection is authenticated and ready.
      // Subscribe to all events, core doesn't auto-subscribe anymore
      this.doSend({
        kind: "req",
        msg: "subscribe_events",
        msg_data: {
          channels: ["all"],
        },
      });
      this.emit("ready");
      return;
    }
    if (data.msg === "pong") {
      this.resolvePong(data.msg_data?.time);
      return;
    }
    if (wsDebug()) {
      console.groupCollapsed(`[WS:event:message received] ${data.msg}`);
      console.info(ev);
      console.info({ ...data.msg_data });
      console.trace();
      console.groupEnd();
    }
    this.message.forEach((callback, name) => {
      try {
        callback(data, ev);
      } catch (e) {
        // One faulty handler must not silence the stores registered after it.
        console.error(`[WS] message callback "${name}" threw`, e);
      }
    });
  }

  doSend(data: any) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (wsDebug() && data.msg !== "ping") {
      console.groupCollapsed(`[WS:event:message send] ${data.msg}`);
      console.info({ ...data });
      console.trace();
      console.groupEnd();
    }
    this.socket.send(
      JSON.stringify({
        ...data,
        id: ++this.counter,
      }),
    );
  }

  addMessageCallback(
    name: string,
    callback: WsMessageCallback,
    replace = false,
  ) {
    if (this.message.has(name) && !replace) {
      throw new Error(`Message callback with name: "${name}" already exists`);
    }
    this.message.set(name, callback);
  }

  // ------------------------------------------------------------------- helpers

  protected emit(event: TransportEvent): void {
    this.listeners[event].forEach((handler) => {
      try {
        handler();
      } catch (e) {
        console.error(`[WS] "${event}" listener threw`, e);
      }
    });
  }

  protected resolvePong(time: unknown): void {
    const entry = this.pendingPings.get(time as number);
    if (!entry) {
      return; // pong for an already timed-out or stale ping
    }
    clearTimeout(entry.timer);
    this.pendingPings.delete(time as number);
    entry.resolve();
  }

  protected rejectAllPings(): void {
    this.pendingPings.forEach((entry) => {
      clearTimeout(entry.timer);
      entry.reject(new PingError("not_open"));
    });
    this.pendingPings.clear();
  }

  private hasActiveOrClosingSocket(): boolean {
    return (
      !!this.socket &&
      (this.socket.readyState === WebSocket.CONNECTING ||
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CLOSING)
    );
  }
}
