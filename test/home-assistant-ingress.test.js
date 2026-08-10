import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function bootstrap(pathname) {
  const source = fs.readFileSync(
    new URL(
      "../web-configurator/public/assets/unfolded-simulator-bootstrap.js",
      import.meta.url,
    ),
    "utf8",
  );
  const window = { location: { pathname } };
  const classList = { add() {} };
  vm.runInNewContext(source, {
    window,
    document: {
      documentElement: { classList },
      body: { classList },
    },
    addEventListener() {},
  });
  return window.__UCVR_SIMULATOR__;
}

test("Home Assistant Ingress path is used as the self-hosted API base", () => {
  const config = bootstrap("/api/hassio_ingress/abc123/configurator/");
  assert.equal(config.enabled, true);
  assert.equal(config.public, false);
  assert.equal(config.basePath, "/api/hassio_ingress/abc123");
  assert.equal(config.sessionKey, "home-assistant-ingress");
  assert.deepEqual(Array.from(config.blockedRoutes), []);
});

test("normal self-hosted configurator keeps an empty API base", () => {
  const config = bootstrap("/configurator/");
  assert.equal(config.public, false);
  assert.equal(config.basePath, "");
  assert.equal(config.sessionKey, "self-hosted");
});
