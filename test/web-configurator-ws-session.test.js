import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("HTTP and dedicated WebSocket listeners share Web Configurator sessions", () => {
  const httpServer = source("src/api/server.js");
  const websocketServer = source("src/api/websocket-server.js");

  assert.match(
    httpServer,
    /this\.sessions = platform\.webConfiguratorSessions \|\| new Map\(\)/,
  );
  assert.match(
    httpServer,
    /platform\.webConfiguratorSessions = this\.sessions/,
  );

  assert.match(
    websocketServer,
    /const session = cookies\(request\)\.ucvr_session/,
  );
  assert.match(
    websocketServer,
    /this\.platform\.webConfiguratorSessions\?\.has\(session\)/,
  );
  assert.match(
    websocketServer,
    /this\.coreWs\.attach\(peer, \{ token, authenticated \}\)/,
  );
});


test("bundled configurator bypasses the public Core /ws route", () => {
  const httpServer = source("src/api/server.js");
  const bootstrap = source(
    "web-configurator/public/assets/unfolded-simulator-bootstrap.js",
  );
  const socket = source("web-configurator/src/api/connection/socket.ts");

  assert.match(
    httpServer,
    /\["\/ws", "\/configurator\/ws"\]\.includes\(url\.pathname\)/,
  );
  assert.match(
    bootstrap,
    /__UCVR_CONFIGURATOR_WS_URL__/,
  );
  assert.match(
    bootstrap,
    /\/configurator\/ws/,
  );
  assert.match(
    socket,
    /window\.__UCVR_CONFIGURATOR_WS_URL__/,
  );
});
