import http from "node:http";
import { acceptWebSocketUpgrade, rejectWebSocketUpgrade } from "../protocol/websocket.js";
import { CoreWebSocketFacade } from "../core/websocket-facade.js";
import { logger } from "../shared/logger.js";

const log = logger("websocket-server");

export class PlatformWebSocketServer {
  constructor(platform) {
    this.platform = platform;
    this.coreWs = new CoreWebSocketFacade(platform);
    this.sockets = new Set();
    this.server = http.createServer((request, response) => {
      response.writeHead(426, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        Upgrade: "websocket"
      });
      response.end("UC Virtual Remote Core WebSocket endpoint\n");
    });
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.once("close", () => this.sockets.delete(socket));
    });
    this.server.on("upgrade", (request, socket, head) => this.#upgrade(request, socket, head));
  }

  async listen() {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.platform.websocketPort, this.platform.host);
    });
    log.info(`Core WebSocket listening on ws://${this.platform.host}:${this.platform.websocketPort}/ws`);
  }

  async close(options = {}) {
    this.coreWs.close();
    if (!this.server.listening && this.sockets.size === 0) return;
    const gracePeriodMs = Math.max(50, Number(options.gracePeriodMs ?? process.env.UCVR_SHUTDOWN_GRACE_MS ?? 1000));
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceTimer);
        resolve();
      };
      const forceTimer = setTimeout(() => {
        if (this.sockets.size) log.warn(`Forcing ${this.sockets.size} remaining Core WebSocket connection(s) closed`);
        try { this.server.closeAllConnections?.(); } catch {}
        for (const socket of this.sockets) socket.destroy();
        finish();
      }, gracePeriodMs);
      try {
        this.server.close(finish);
        this.server.closeIdleConnections?.();
      } catch {
        for (const socket of this.sockets) socket.destroy();
        finish();
      }
    });
  }

  #upgrade(request, socket, head) {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname !== "/ws") return rejectWebSocketUpgrade(socket, 404, "Not Found");
    const authorization = String(request.headers.authorization || "");
    const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
    const token = request.headers["api-key"] || bearer || url.searchParams.get("token") || null;
    const peer = acceptWebSocketUpgrade(request, socket, head);
    if (peer) this.coreWs.attach(peer, { token });
  }
}
