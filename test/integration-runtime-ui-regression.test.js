// Regression coverage for integration failures observed on the Home Assistant AMD64 runtime.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ConfigurationService } from "../src/core/configuration.js";
import { validateArchiveSymlink, validateTarTypes } from "../src/native-integrations/service.js";
import { PlatformDatabase } from "../src/storage/database.js";

const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const entrypoint = fs.readFileSync(new URL("../docker-entrypoint.sh", import.meta.url), "utf8");
const syncMode = fs.readFileSync(new URL("../web-configurator/src/components/settings/SyncMode.vue", import.meta.url), "utf8");
const navBar = fs.readFileSync(new URL("../web-configurator/src/components/elements/NavBar.vue", import.meta.url), "utf8");
const configuratorConfigApi = fs.readFileSync(new URL("../web-configurator/src/api/services/config.ts", import.meta.url), "utf8");
const soundHaptic = fs.readFileSync(new URL("../web-configurator/src/components/settings/SoundHaptic.vue", import.meta.url), "utf8");
const platformSource = fs.readFileSync(new URL("../src/platform.js", import.meta.url), "utf8");

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
  assert.match(syncMode, />Automatic configuration synchronization</);
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
  assert.match(entrypoint, /CAP_SYS_ADMIN/);
  assert.match(entrypoint, /Supervisor can still restrict namespaces independently/);
});

test("read-only HAOS cgroups degrade external runtime instead of stopping the appliance", () => {
  assert.match(entrypoint, /mark_dind_unavailable/);
  assert.match(entrypoint, /UCVR_DIND_RUNTIME_AVAILABLE=false/);
  assert.match(entrypoint, /continuing without registry\/external integration containers/);
  assert.match(entrypoint, /if ! prepare_dind_cgroups; then[\s\S]*mark_dind_unavailable[\s\S]*return 0/);
  assert.doesNotMatch(entrypoint, /the cgroup v2 hierarchy is read-only or not delegated to this container\." >&2\n\s*exit 1/);
});

test("single setting updates never resend a stale cached section", () => {
  assert.match(configuratorConfigApi, /const cfg = \{ \[name\]: value \} as Cfg;/);
  assert.doesNotMatch(configuratorConfigApi, /\{ \.\.\.this\.cfg \}\?\.\[group\]/);
});

test("haptic feedback writes the haptic toggle value", () => {
  assert.match(soundHaptic, /hapticFeedbackChanged\(\)[\s\S]*?value: hapticFeedback\.value/);
  assert.doesNotMatch(soundHaptic, /hapticFeedbackChanged\(\)[\s\S]*?value: soundEffects\.value/);
});

test("persisted radio preferences are restored without applying defaults to the host", () => {
  assert.match(platformSource, /getSetting\("configuration", \{\}\)/);
  assert.match(platformSource, /hasOwnSetting\(persistedNetwork, "bt_enabled"\)[\s\S]*setBluetoothPower/);
  assert.match(platformSource, /hasOwnSetting\(persistedNetwork, "wifi_enabled"\)[\s\S]*setWifiPower/);
  assert.match(platformSource, /hasOwnSetting\(persistedBluetooth, "enable_hci_log"\)[\s\S]*setHciLogging/);
});

test("display, button, Bluetooth and Voice Control settings survive a database restart", () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".test-config-persistence-"));
  const platformFor = (db) => ({
    db,
    name: "Virtual Remote 3",
    locale: "en-US",
    timezone: "Europe/Berlin",
    hardware: null,
    syncMode: null,
    events: { publish() {} },
  });

  let db;
  try {
    db = new PlatformDatabase(root);
    let platform = platformFor(db);
    let configuration = new ConfigurationService(platform);

    configuration.update("display", { brightness: 23 });
    configuration.update("button", { brightness: 31 });
    configuration.update("button", { static_color: { rgb: [1, 2, 3] } });
    configuration.update("bt", { enable_hci_log: true });
    configuration.update("network", { bt_enabled: true, wifi_enabled: false });
    configuration.update("voice_control", {
      microphone: true,
      enabled: true,
      voice_assistant: { entity_id: "voice.test", profile_id: "de" },
    });
    db.close();

    db = new PlatformDatabase(root);
    platform = platformFor(db);
    configuration = new ConfigurationService(platform);

    assert.equal(configuration.get("display").brightness, 23);
    assert.equal(configuration.get("button").brightness, 31);
    assert.deepEqual(configuration.get("button").static_color.rgb, [1, 2, 3]);
    assert.equal(configuration.get("bt").enable_hci_log, true);
    assert.equal(configuration.get("network").bt_enabled, true);
    assert.equal(configuration.get("network").wifi_enabled, false);
    assert.equal(configuration.get("voice_control").microphone, true);
    assert.equal(configuration.get("voice_control").enabled, true);
    assert.equal(configuration.getAll().voice.microphone, true);
  } finally {
    try { db?.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});
