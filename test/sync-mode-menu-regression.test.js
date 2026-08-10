import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const prepare = fs.readFileSync(
  new URL("../tools/prepare-web-configurator.js", import.meta.url),
  "utf8",
);
const menu = fs.readFileSync(
  new URL("../web-configurator/src/composables/menuItems.ts", import.meta.url),
  "utf8",
);
const router = fs.readFileSync(
  new URL("../web-configurator/src/composables/router.ts", import.meta.url),
  "utf8",
);

test("Sync Mode is provided only by the native settings route", () => {
  assert.match(menu, /value:\s*"sync-mode"/);
  assert.match(router, /path:\s*"sync-mode"/);
  assert.doesNotMatch(prepare, /ucvr-sync-mode-runtime\.js/);
});

test("legacy Sync Mode runtime injector is not shipped", () => {
  assert.equal(
    fs.existsSync(
      new URL(
        "../web-configurator/public/assets/ucvr-sync-mode-runtime.js",
        import.meta.url,
      ),
    ),
    false,
  );
});
