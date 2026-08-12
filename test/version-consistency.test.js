import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const versionFile = fs.readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim();

test("package.json and VERSION stay in sync", () => {
  assert.equal(versionFile, packageJson.version);
});
