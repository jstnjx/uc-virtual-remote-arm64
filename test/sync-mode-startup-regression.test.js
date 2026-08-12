import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const adapter = fs.readFileSync(
  new URL("../src/sync-mode/config-adapter.js", import.meta.url),
  "utf8",
);

test("Sync Mode status refresh waits for platform initialization", () => {
  assert.match(adapter, /function statusRefreshReady\(service\)/);
  assert.match(adapter, /service\.platform\.configuration/);
  assert.match(
    adapter,
    /typeof service\.platform\.hardware\?\.status === "function"/,
  );
  assert.match(
    adapter,
    /refresh &&\s*statusRefreshReady\(service\) &&/,
  );
});

test("Sync Mode clears pre-start errors and hides disabled provisioning warnings", () => {
  assert.match(
    adapter,
    /service\.networkBridgeInstalled = true;\s*}\s*service\.commandError = null;/,
  );
  assert.match(
    adapter,
    /\.\.\.\(settings\.enabled \? cached\?\.warnings \|\| \[\] : \[\]\)/,
  );
});
