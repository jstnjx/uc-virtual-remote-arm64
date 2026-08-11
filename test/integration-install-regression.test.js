import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { customGhcrEntry, dockerfileBuildPath, pythonLaunchTarget } from "../src/external-integrations/service.js";
import { ensureRuntimeDriverManifest, pyInstallerOnedirEnvironment } from "../src/native-integrations/service.js";

const nativeService = fs.readFileSync(new URL("../src/native-integrations/service.js", import.meta.url), "utf8");
const apiServer = fs.readFileSync(new URL("../src/api/server.js", import.meta.url), "utf8");
const syncModeService = fs.readFileSync(new URL("../src/sync-mode/service.js", import.meta.url), "utf8");
const customUploadUi = fs.readFileSync(new URL("../web-configurator/src/components/integration/ImportCustomIntegration.vue", import.meta.url), "utf8");
const externalService = fs.readFileSync(new URL("../src/external-integrations/service.js", import.meta.url), "utf8");
const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const simulator = fs.readFileSync(new URL("../web-configurator/public/assets/ucvr-simulator.js", import.meta.url), "utf8");

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


test("Home Assistant without nested Docker uses the supervised source process runtime", () => {
  assert.match(dockerfile, /python3-venv/);
  assert.match(externalService, /UCVR_DIND_RUNTIME_AVAILABLE/);
  assert.match(externalService, /runtime: "process"/);
  assert.match(externalService, /Starting integration process/);
  assert.match(externalService, /pip.*install/s);
});

test("Remote Simulator keeps all configured profiles and exposes its event stream before Core compatibility routing", () => {
  assert.doesNotMatch(simulator, /ucvr-demo-profile/);
  assert.match(simulator, /openEntityControl/);
  assert.match(simulator, /openProfileSelector/);
  const eventRoute = apiServer.indexOf('if (pathname === "/api/events"');
  const officialRoute = apiServer.indexOf('if (pathname.startsWith("/api/") && this.#officialRequest(request))');
  assert.ok(eventRoute >= 0 && officialRoute >= 0 && eventRoute < officialRoute);
});


test("Python registry runtime prefers a package __main__ over an internal driver.py", () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".test-python-launch-"));
  try {
    fs.mkdirSync(path.join(root, "uc_intg_spotify"));
    fs.writeFileSync(path.join(root, "uc_intg_spotify", "__init__.py"), "");
    fs.writeFileSync(path.join(root, "uc_intg_spotify", "__main__.py"), "");
    fs.writeFileSync(path.join(root, "uc_intg_spotify", "driver.py"), "");
    assert.deepEqual(pythonLaunchTarget(root), { kind: "module", value: "uc_intg_spotify" });
    assert.deepEqual(
      pythonLaunchTarget(root, { python_entrypoint: "uc_intg_spotify/driver.py" }),
      { kind: "script", value: "uc_intg_spotify/driver.py" }
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native package runtime mirrors root driver.json beside bin/driver without overwriting package data", () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".test-driver-manifest-"));
  try {
    fs.mkdirSync(path.join(root, "bin"));
    fs.writeFileSync(path.join(root, "driver.json"), '{"driver_id":"spotify"}');
    fs.writeFileSync(path.join(root, "bin", "driver"), "binary");
    const copied = ensureRuntimeDriverManifest(root, path.join(root, "bin", "driver"));
    assert.equal(copied, path.join(root, "bin", "driver.json"));
    assert.equal(fs.readFileSync(copied, "utf8"), '{"driver_id":"spotify"}');
    fs.writeFileSync(copied, "keep-me");
    assert.equal(ensureRuntimeDriverManifest(root, path.join(root, "bin", "driver")), null);
    assert.equal(fs.readFileSync(copied, "utf8"), "keep-me");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("emulated ARM64 PyInstaller integrations disable OpenSSL ARM acceleration by default", () => {
  const env = pyInstallerOnedirEnvironment(
    { executable: "/tmp/pkg/bin/driver", architecture: "arm64" },
    { runtimeArch: "x64", isDirectory: () => true, ldLibraryPath: "" }
  );
  assert.equal(env.OPENSSL_armcap, "0");
  assert.equal(env._PYI_PARENT_PROCESS_LEVEL, "0");
});


test("custom GHCR entries retain an optional GitHub source repository", () => {
  const entry = customGhcrEntry({
    id: "uc-remote-sync",
    driver_id: "remote_sync",
    image: "ghcr.io/jstnjx/uc-remote-sync",
    repository: "https://github.com/jstnjx/uc-remote-sync.git"
  });
  assert.equal(entry.repository, "https://github.com/jstnjx/uc-remote-sync");
  assert.throws(
    () => customGhcrEntry({ id: "invalid", driver_id: "invalid", image: "ghcr.io/jstnjx/invalid", repository: "https://example.com/not-github" }),
    /valid GitHub repository URL/
  );
});

test("Sync Mode uses Automatic so HAOS can fall back to the Remote Sync source checkout", () => {
  assert.match(syncModeService, /const REPOSITORY = "https:\/\/github\.com\/jstnjx\/uc-remote-sync"/);
  assert.match(syncModeService, /repository: REPOSITORY/);
  assert.match(syncModeService, /ucvr_install_source: "auto"/);
  assert.doesNotMatch(syncModeService, /ucvr_install_source: "image"/);
});
