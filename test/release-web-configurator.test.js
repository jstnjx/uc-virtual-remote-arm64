import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("software updates build the release's own Web Configurator", () => {
  const service = source("src/system-update/local-service.js");
  assert.match(service, /export function buildReleaseWebConfigurator/);
  assert.match(service, /await this\.buildWebConfigurator\(staging\)/);
  assert.match(service, /UCVR_WEB_CONFIGURATOR_DIR: path\.join\(releaseRoot, "web-configurator-build"\)/);
});

test("a release's own configurator build wins over the base installation bundle", () => {
  const manager = source("src/web-configurator.js");
  assert.match(manager, /ownBuild \? defaultRoot : process\.env\.UCVR_WEB_CONFIGURATOR_DIR/);
});

test("the build installs dev dependencies under NODE_ENV=production", () => {
  assert.match(source("tools/prepare-web-configurator.js"), /\["ci", "--include=dev"\]/);
});

test("npm start and dev prepare the configurator with the existing script", () => {
  const pkg = JSON.parse(source("package.json"));
  assert.ok(pkg.scripts["prepare:web-configurator"]);
  assert.equal(pkg.scripts.prestart, "npm run prepare:web-configurator");
  assert.equal(pkg.scripts.predev, "npm run prepare:web-configurator");
});

test("no stale prebuilt configurator bundle is tracked in the repository", () => {
  assert.match(source(".gitignore"), /^\/web-configurator\/dist\/$/m);
});
