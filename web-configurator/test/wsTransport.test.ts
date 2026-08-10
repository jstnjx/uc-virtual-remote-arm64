/**
 * ConnectionWebSocket transport tests — docs/specs/001-connection-monitor-rewrite.md §7.3.
 * Runs against a mocked global WebSocket; no network, no monitor.
 */
import { describe, expect, test } from "vitest";
import ConnectionWebSocket from "../src/api/connection/socket";
import { PingError } from "../src/api/connection/monitorTypes";

type Listener = (ev: unknown) => void;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  static get last(): MockWebSocket {
    const inst = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    if (!inst) {
      throw new Error("no MockWebSocket instance created");
    }
    return inst;
  }

  readyState = MockWebSocket.CONNECTING;
  sent: Array<Record<string, unknown>> = [];
  closeCalls = 0;
  private listeners: Record<string, Listener[]> = {};

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(event: string, fn: Listener): void {
    (this.listeners[event] = this.listeners[event] ?? []).push(fn);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closeCalls++;
    this.readyState = MockWebSocket.CLOSED;
  }

  private emit(event: string, ev: unknown): void {
    (this.listeners[event] ?? []).forEach((fn) => fn(ev));
  }

  // ---- test controls simulating the server / browser
  serverOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open", {});
  }
  serverMessage(obj: unknown): void {
    this.emit("message", { data: JSON.stringify(obj) });
  }
  serverRawMessage(raw: string): void {
    this.emit("message", { data: raw });
  }
  serverClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", { code: 1006, reason: "" });
  }
  serverError(): void {
    this.emit("error", {});
  }
}

// socket.ts resolves the WebSocket constructor and its readyState constants
// from the global scope at call time, so installing the mock once is enough.
(globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;

function makeTransport(): ConnectionWebSocket {
  MockWebSocket.instances = [];
  return new ConnectionWebSocket({
    baseUrl: "http://device.local/",
  });
}

function openTransport(ws: ConnectionWebSocket): MockWebSocket {
  ws.connect();
  const sock = MockWebSocket.last;
  sock.serverOpen();
  return sock;
}

async function expectPingError(p: Promise<void>): Promise<PingError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PingError) {
      return e;
    }
    throw new Error(`expected PingError, got ${String(e)}`);
  }
  throw new Error("expected ping to reject");
}

describe("transport events", () => {
  test("ready fires only after the authentication message, with subscribe_events sent", () => {
    const ws = makeTransport();
    let ready = 0;
    ws.on("ready", () => ready++);
    const sock = openTransport(ws);
    expect(ready).toBe(0); // open ≠ ready (spec P3-2)
    sock.serverMessage({ kind: "resp", msg: "authentication" });
    expect(ready).toBe(1);
    expect(sock.sent.length).toBe(1);
    expect(sock.sent[0].msg).toBe("subscribe_events");
    expect((sock.sent[0].msg_data as { channels: string[] }).channels).toEqual([
      "all",
    ]);
  });

  test("auth_required is emitted and not dispatched to message callbacks", () => {
    const ws = makeTransport();
    let authRequired = 0;
    let dispatched = 0;
    ws.on("auth_required", () => authRequired++);
    ws.addMessageCallback("probe", () => dispatched++);
    const sock = openTransport(ws);
    sock.serverMessage({ kind: "event", msg: "auth_required" });
    expect(authRequired).toBe(1);
    expect(dispatched).toBe(0);
  });

  test("server close emits closed once and allows a fresh connect()", () => {
    const ws = makeTransport();
    let closed = 0;
    ws.on("closed", () => closed++);
    const sock = openTransport(ws);
    sock.serverClose();
    expect(closed).toBe(1);
    ws.connect(); // socket slot was cleared → no throw
    expect(MockWebSocket.instances.length).toBe(2);
  });

  test("close() detaches: no closed event, pending pings rejected as not_open", async () => {
    const ws = makeTransport();
    let closed = 0;
    ws.on("closed", () => closed++);
    const sock = openTransport(ws);
    const pending = ws.ping(1000);
    ws.close();
    expect(sock.closeCalls).toBe(1);
    expect((await expectPingError(pending)).reason).toBe("not_open");
    sock.serverClose(); // browser firing close after our explicit close()
    expect(closed).toBe(0);
  });

  test("connect() throws while a socket is active", () => {
    const ws = makeTransport();
    openTransport(ws);
    let threw = false;
    try {
      ws.connect();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(MockWebSocket.instances.length).toBe(1);
  });
});

describe("ping / pong", () => {
  test("resolves on the matching pong via central dispatch", async () => {
    const ws = makeTransport();
    const sock = openTransport(ws);
    const p = ws.ping(1000);
    const sentPing = sock.sent[0];
    expect(sentPing.msg).toBe("ping");
    const time = (sentPing.msg_data as { time: number }).time;
    sock.serverMessage({ kind: "resp", msg: "pong", msg_data: { time } });
    await p; // resolves — otherwise the test times out
  });

  test("stale pong (wrong echo value) is ignored", async () => {
    const ws = makeTransport();
    const sock = openTransport(ws);
    const p = ws.ping(30);
    sock.serverMessage({ kind: "resp", msg: "pong", msg_data: { time: -1 } });
    expect((await expectPingError(p)).reason).toBe("timeout");
  });

  test("rejects not_open without a socket and after close()", async () => {
    const ws = makeTransport();
    expect((await expectPingError(ws.ping(10))).reason).toBe("not_open");
    openTransport(ws);
    ws.close();
    expect((await expectPingError(ws.ping(10))).reason).toBe("not_open");
  });

  test("rejects timeout when no pong arrives in time", async () => {
    const ws = makeTransport();
    openTransport(ws);
    const start = Date.now();
    expect((await expectPingError(ws.ping(20))).reason).toBe("timeout");
    expect(Date.now() - start >= 15).toBe(true);
  });

  test("pongs are not dispatched to store message callbacks", async () => {
    const ws = makeTransport();
    let dispatched = 0;
    ws.addMessageCallback("probe", () => dispatched++);
    const sock = openTransport(ws);
    const p = ws.ping(1000);
    const time = (sock.sent[0].msg_data as { time: number }).time;
    sock.serverMessage({ kind: "resp", msg: "pong", msg_data: { time } });
    await p;
    expect(dispatched).toBe(0);
  });
});

describe("message dispatch", () => {
  test("delivers parsed messages to all callbacks; one throwing callback does not block the next", () => {
    const ws = makeTransport();
    const received: string[] = [];
    ws.addMessageCallback("first", () => {
      throw new Error("boom");
    });
    ws.addMessageCallback("second", (data) => received.push(data.msg));
    const sock = openTransport(ws);
    sock.serverMessage({ kind: "event", msg: "entity_change", msg_data: {} });
    expect(received).toEqual(["entity_change"]);
  });

  test("malformed JSON is ignored without breaking the connection", () => {
    const ws = makeTransport();
    const received: string[] = [];
    ws.addMessageCallback("probe", (data) => received.push(data.msg));
    const sock = openTransport(ws);
    sock.serverRawMessage("{not json");
    sock.serverMessage({ kind: "event", msg: "still_alive", msg_data: {} });
    expect(received).toEqual(["still_alive"]);
  });

  test("doSend appends an incrementing id", () => {
    const ws = makeTransport();
    const sock = openTransport(ws);
    ws.doSend({ kind: "req", msg: "a" });
    ws.doSend({ kind: "req", msg: "b" });
    expect(sock.sent[0].id).toBe(1);
    expect(sock.sent[1].id).toBe(2);
  });

  test("duplicate message callback name throws unless replace is set", () => {
    const ws = makeTransport();
    ws.addMessageCallback("dup", () => undefined);
    let threw = false;
    try {
      ws.addMessageCallback("dup", () => undefined);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    ws.addMessageCallback("dup", () => undefined, true); // replace → no throw
  });
});
