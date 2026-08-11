import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bootstrap = fs.readFileSync(
  path.join(root, "web-configurator", "public", "assets", "unfolded-simulator-bootstrap.js"),
  "utf8",
);

test("virtual configurator removes the unavailable API definitions prompt", () => {
  assert.match(bootstrap, /Looking for API definitions\? Click here/);
  assert.match(bootstrap, /normalizedText\(element\) === unavailableApiDefinitionsPrompt/);
  assert.match(bootstrap, /element\.remove\(\)/);
  assert.match(bootstrap, /MutationObserver/);
});
