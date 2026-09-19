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
