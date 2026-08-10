import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { dockerfileBuildPath } from "../src/external-integrations/service.js";

const nativeService = fs.readFileSync(new URL("../src/native-integrations/service.js", import.meta.url), "utf8");
const apiServer = fs.readFileSync(new URL("../src/api/server.js", import.meta.url), "utf8");
const customUploadUi = fs.readFileSync(new URL("../web-configurator/src/components/integration/ImportCustomIntegration.vue", import.meta.url), "utf8");

test("registry source builds resolve repository Dockerfiles inside the cloned context", () => {
  const appDir = path.resolve("/data/external-integrations/apps/uc-remote-sync");
  assert.equal(dockerfileBuildPath(appDir, "Dockerfile"), path.join(appDir, "Dockerfile"));
  assert.equal(dockerfileBuildPath(appDir, "docker/Dockerfile"), path.join(appDir, "docker/Dockerfile"));
  assert.equal(dockerfileBuildPath(appDir, "-"), "-");
});

test("native integration tarball installation has no fixed archive byte cap", () => {
  assert.doesNotMatch(nativeService, /MAX_ARCHIVE_BYTES/);
  assert.doesNotMatch(nativeService, /Integration archive is too large/);
  assert.match(
    apiServer,
    /pathname === "\/intg\/install"[\s\S]{0,200}multipartFile\(request, Number\.POSITIVE_INFINITY\)/,
  );
});

test("custom integration uploader no longer advertises a fixed 100 MB limit", () => {
  assert.doesNotMatch(customUploadUi, /install_custom\.popup\.upload\.description/);
});
