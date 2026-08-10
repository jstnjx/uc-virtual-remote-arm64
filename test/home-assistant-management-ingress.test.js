import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { appUrl } from "../public/management-base.js";

const managementIndex = fs.readFileSync(
  new URL("../public/index.html", import.meta.url),
  "utf8",
);

const INGRESS = "http://ha.local:8123/api/hassio_ingress/abc123/";

test("management URLs stay inside Home Assistant Ingress", () => {
  assert.equal(
    appUrl("styles.css?v=0.14.1", INGRESS),
    `${INGRESS}styles.css?v=0.14.1`,
  );
  assert.equal(
    appUrl("management/system/status", INGRESS),
    `${INGRESS}management/system/status`,
  );
  assert.equal(
    appUrl("pub/status", INGRESS),
    `${INGRESS}pub/status`,
  );
});

test("management HTML contains no root-relative local assets", () => {
  assert.match(managementIndex, /<base id="ucvr-base" href="\/">/);
  for (const asset of [
    "styles.css",
    "management-navigation.css",
    "integrations-management.css",
    "management-navigation.js",
    "app.js",
    "integrations-management.js",
  ]) {
    assert.doesNotMatch(managementIndex, new RegExp(`["']/${asset.replace(".", "\\.")}`));
  }
  assert.doesNotMatch(managementIndex, /href="\/configurator\//);
});

test("management HTML sets the Home Assistant Ingress base before assets load", () => {
  assert.match(managementIndex, /window\.location\.pathname\.match\(\/\^\(\\\/api\\\/hassio_ingress/);
  const basePosition = managementIndex.indexOf('<base id="ucvr-base"');
  const scriptPosition = managementIndex.indexOf('<script>', basePosition);
  const stylePosition = managementIndex.indexOf('styles.css', scriptPosition);
  assert.ok(basePosition >= 0 && scriptPosition > basePosition && stylePosition > scriptPosition);
});
