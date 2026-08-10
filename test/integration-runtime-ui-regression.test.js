// Regression coverage for integration failures observed on the Home Assistant AMD64 runtime.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validateArchiveSymlink, validateTarTypes } from "../src/native-integrations/service.js";

const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const entrypoint = fs.readFileSync(new URL("../docker-entrypoint.sh", import.meta.url), "utf8");
const syncMode = fs.readFileSync(new URL("../web-configurator/src/components/settings/SyncMode.vue", import.meta.url), "utf8");
const navBar = fs.readFileSync(new URL("../web-configurator/src/components/elements/NavBar.vue", import.meta.url), "utf8");

test("safe npm package symlinks are accepted", () => {
  assert.equal(
    validateArchiveSymlink("./bin/node_modules/.bin/multicast-dns", "../multicast-dns/cli.js"),
    "bin/node_modules/multicast-dns/cli.js",
  );
  assert.doesNotThrow(() => validateTarTypes(
    "lrwxrwxrwx runner/runner 0 2026-08-09 11:18 ./bin/node_modules/.bin/multicast-dns -> ../multicast-dns/cli.js",
    ["./bin/node_modules/.bin/multicast-dns"],
  ));
});

test("unsafe links remain blocked", () => {
  assert.throws(
    () => validateArchiveSymlink("bin/node_modules/.bin/escape", "../../../../etc/passwd"),
    /Unsafe integration archive symbolic link/,
  );
  assert.throws(
    () => validateArchiveSymlink("bin/node_modules/.bin/escape", "/etc/passwd"),
    /Unsafe integration archive symbolic link/,
  );
  assert.throws(
    () => validateTarTypes(
      "hrwxrwxrwx user/group 0 2026-08-09 11:18 bin/hard link to target",
      ["bin/hard"],
    ),
    /unsupported link or special file/,
  );
});

test("AMD64 image includes ARM64 runtime libraries", () => {
  assert.match(dockerfile, /libstdc\+\+6-arm64-cross/);
  assert.match(dockerfile, /zlib1g:arm64/);
  assert.match(dockerfile, /libz\.so\.1/);
});

test("Sync Mode presents simple controls first", () => {
  assert.match(syncMode, />Automatic synchronization</);
  assert.match(syncMode, />What gets synchronized</);
  assert.match(syncMode, />Satellite remotes</);
  assert.match(syncMode, /<details class="sync-card sync-advanced">/);
  assert.match(syncMode, />Advanced settings</);
});

test("Web Configurator exposes Management", () => {
  assert.match(navBar, /managementHref/);
  assert.match(navBar, />Management</);
  assert.match(navBar, /__UCVR_BASE_PATH__/);
});


test("nested Docker checks mount namespace privilege", () => {
  assert.match(dockerfile, /util-linux/);
  assert.match(entrypoint, /unshare --mount/);
  assert.match(entrypoint, /disable Protection mode/);
});
