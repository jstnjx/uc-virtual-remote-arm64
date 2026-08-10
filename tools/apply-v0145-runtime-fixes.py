from pathlib import Path
import json

root = Path.cwd()


def replace_once(path, old, new):
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")

# Version bump.
(root / "VERSION").write_text("0.14.5\n", encoding="utf-8")
for filename in ["package.json", "package-lock.json"]:
    path = root / filename
    text = path.read_text(encoding="utf-8").replace('"version": "0.14.4"', '"version": "0.14.5"')
    path.write_text(text, encoding="utf-8")

# The nested Docker daemon can start without being allowed to create the mount
# namespaces required by actual container builds/runs. Test the exact primitive
# up front and give Home Assistant users an actionable error.
dockerfile = root / "Dockerfile"
replace_once(
    dockerfile,
    "bluez ca-certificates docker.io fuse-overlayfs git gosu iproute2 iptables iw libcap2-bin network-manager rfkill tar usbutils",
    "bluez ca-certificates docker.io fuse-overlayfs git gosu iproute2 iptables iw libcap2-bin network-manager rfkill tar usbutils util-linux",
)

entrypoint = root / "docker-entrypoint.sh"
text = entrypoint.read_text(encoding="utf-8")
anchor = '''wait_for_docker() {\n'''
preflight = '''require_dind_namespace_access() {\n  if command -v unshare >/dev/null 2>&1 && unshare --mount /bin/true >/dev/null 2>&1; then\n    return 0\n  fi\n\n  echo "UC Virtual Remote: internal Docker cannot create mount namespaces in this container." >&2\n  echo "UC Virtual Remote: registry/external integrations require the top-level container to run fully privileged." >&2\n  echo "UC Virtual Remote: Home Assistant users must disable Protection mode for this add-on before starting it; full_access is only effective for unprotected add-ons." >&2\n  echo "UC Virtual Remote: standalone Docker users must start the appliance with --privileged." >&2\n  exit 1\n}\n\n'''
if preflight not in text:
    if anchor not in text:
        raise SystemExit("entrypoint function anchor not found")
    text = text.replace(anchor, preflight + anchor, 1)
call_anchor = '''  if [ "$(id -u)" != "0" ]; then\n    echo "UC Virtual Remote ARM64: internal Docker requires the top-level container to run as root." >&2\n    exit 1\n  fi\n\n  mkdir -p "$DIND_DATA_ROOT" /var/run/docker\n'''
call_replacement = '''  if [ "$(id -u)" != "0" ]; then\n    echo "UC Virtual Remote ARM64: internal Docker requires the top-level container to run as root." >&2\n    exit 1\n  fi\n\n  require_dind_namespace_access\n  mkdir -p "$DIND_DATA_ROOT" /var/run/docker\n'''
if call_anchor not in text:
    raise SystemExit("entrypoint start_dockerd anchor not found")
entrypoint.write_text(text.replace(call_anchor, call_replacement, 1), encoding="utf-8")

native = root / "src/native-integrations/service.js"
text = native.read_text(encoding="utf-8")

# Pass the package-scoped emulator settings to helper wrappers created below.
old_env = '''    UC_CLIENT_NAME: `ucvr-${record.driver_id}`,\n    UC_LOG_LEVEL: String(process.env.UCVR_NATIVE_LOG_LEVEL || process.env.LOG_LEVEL || "INFO").toUpperCase(),\n    PYTHONUNBUFFERED: "1"\n'''
new_env = '''    UC_CLIENT_NAME: `ucvr-${record.driver_id}`,\n    UC_LOG_LEVEL: String(process.env.UCVR_NATIVE_LOG_LEVEL || process.env.LOG_LEVEL || "INFO").toUpperCase(),\n    UCVR_ARM64_EMULATOR: String(process.env.UCVR_ARM64_EMULATOR || "/usr/local/bin/qemu-aarch64-static"),\n    UCVR_ARM64_LD_PREFIX: String(process.env.UCVR_ARM64_LD_PREFIX || "/usr/aarch64-linux-gnu"),\n    PYTHONUNBUFFERED: "1"\n'''
if old_env not in text:
    raise SystemExit("native environment anchor not found")
text = text.replace(old_env, new_env, 1)

insert_anchor = '''export function driverLaunchCommand(record, options = {}) {\n'''
helpers = r'''export function pyInstallerOnedirEnvironment(record, options = {}) {
  const runtimeArch = String(options.runtimeArch || process.arch);
  const executable = String(record?.executable || "");
  const architecture = record?.architecture || (executable ? executableArchitecture(executable) : null);
  if (architecture !== "arm64" || !["x64", "amd64"].includes(runtimeArch) || !executable) return {};

  const internalDir = path.join(path.dirname(executable), "_internal");
  const isDirectory = options.isDirectory || ((filename) => {
    try { return fs.statSync(filename).isDirectory(); }
    catch { return false; }
  });
  if (!isDirectory(internalDir)) return {};

  // PyInstaller 6.x onedir applications normally restart their bootloader once
  // after modifying LD_LIBRARY_PATH. Under process-scoped QEMU that guest
  // execve would escape the emulator. Seed the post-restart environment so the
  // bootloader proceeds directly as its main process instead.
  const inheritedLd = String(options.ldLibraryPath ?? process.env.LD_LIBRARY_PATH ?? "").trim();
  return {
    _PYI_ARCHIVE_FILE: executable,
    _PYI_PARENT_PROCESS_LEVEL: "-1",
    LD_LIBRARY_PATH: [internalDir, inheritedLd].filter(Boolean).join(":")
  };
}

function arm64HelperWrapper(realSuffix = ".ucvr-arm64") {
  return `#!/bin/sh\nset -eu\nemulator="${'${UCVR_ARM64_EMULATOR:-/usr/local/bin/qemu-aarch64-static}'}"\nld_prefix="${'${UCVR_ARM64_LD_PREFIX:-/usr/aarch64-linux-gnu}'}"\nreal="${'${0}'}${realSuffix}"\nif [ -n "$ld_prefix" ]; then\n  exec "$emulator" -L "$ld_prefix" "$real" "$@"\nfi\nexec "$emulator" "$real" "$@"\n`;
}

export function wrapArm64HelperExecutables(root, mainExecutable, options = {}) {
  const runtimeArch = String(options.runtimeArch || process.arch);
  if (!["x64", "amd64"].includes(runtimeArch)) return [];
  const architectureOf = options.architectureOf || executableArchitecture;
  const suffix = String(options.suffix || ".ucvr-arm64");
  const wrapped = [];
  const resolvedMain = path.resolve(mainExecutable);
  const stack = [path.resolve(root)];

  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(filename);
        continue;
      }
      if (!entry.isFile() || path.resolve(filename) === resolvedMain || filename.endsWith(suffix)) continue;
      const stat = fs.statSync(filename);
      if (!(stat.mode & 0o111)) continue;
      let architecture = null;
      try { architecture = architectureOf(filename); }
      catch { continue; }
      if (architecture !== "arm64") continue;

      const real = `${filename}${suffix}`;
      if (fs.existsSync(real)) continue;
      fs.renameSync(filename, real);
      fs.writeFileSync(filename, arm64HelperWrapper(suffix), { mode: 0o755 });
      fs.chmodSync(real, stat.mode & 0o777);
      wrapped.push(path.relative(root, filename));
    }
  }
  return wrapped;
}

'''
if helpers not in text:
    if insert_anchor not in text:
        raise SystemExit("driver launch anchor not found")
    text = text.replace(insert_anchor, helpers + insert_anchor, 1)

# Adapt secondary packaged executables such as bundled Node/whisper binaries.
arch_anchor = '''      const architecture = executableArchitecture(executable);\n      if (architecture && architecture !== "arm64") {\n        throw Object.assign(new Error(`Integration executable is ${architecture}; an ARM64/aarch64 package is required`), { status: 409 });\n      }\n\n      const existing = this.managedRecord(driverId);\n'''
arch_replacement = '''      const architecture = executableArchitecture(executable);\n      if (architecture && architecture !== "arm64") {\n        throw Object.assign(new Error(`Integration executable is ${architecture}; an ARM64/aarch64 package is required`), { status: 409 });\n      }\n      const emulatedHelpers = architecture === "arm64"\n        ? wrapArm64HelperExecutables(sourceRoot, executable)\n        : [];\n\n      const existing = this.managedRecord(driverId);\n'''
if arch_anchor not in text:
    raise SystemExit("architecture install anchor not found")
text = text.replace(arch_anchor, arch_replacement, 1)

record_anchor = '''        architecture: architecture || "script",\n        metadata,\n'''
record_replacement = '''        architecture: architecture || "script",\n        emulated_helpers: emulatedHelpers,\n        metadata,\n'''
if record_anchor not in text:
    raise SystemExit("record architecture anchor not found")
text = text.replace(record_anchor, record_replacement, 1)

spawn_anchor = '''    const logFile = path.join(this.logsDir, `${record.driver_id}.log`);\n    const launch = driverLaunchCommand(record);\n    if (launch.emulated) {\n      log.info(`Starting ARM64 integration ${record.driver_id} through ${path.basename(launch.command)} on ${process.arch}`);\n    }\n    const child = spawn(launch.command, launch.args, {\n      cwd: record.package_dir,\n      env: nativeEnvironment(record, this.host, configDir, dataDir),\n'''
spawn_replacement = '''    const logFile = path.join(this.logsDir, `${record.driver_id}.log`);\n    const launch = driverLaunchCommand(record);\n    const processEnv = {\n      ...nativeEnvironment(record, this.host, configDir, dataDir),\n      ...pyInstallerOnedirEnvironment(record)\n    };\n    if (launch.emulated) {\n      log.info(`Starting ARM64 integration ${record.driver_id} through ${path.basename(launch.command)} on ${process.arch}`);\n      if (processEnv._PYI_PARENT_PROCESS_LEVEL) {\n        log.info(`Enabled PyInstaller onedir compatibility for ${record.driver_id}`);\n      }\n    }\n    const child = spawn(launch.command, launch.args, {\n      cwd: record.package_dir,\n      env: processEnv,\n'''
if spawn_anchor not in text:
    raise SystemExit("spawn environment anchor not found")
text = text.replace(spawn_anchor, spawn_replacement, 1)
native.write_text(text, encoding="utf-8")

# Extend existing multiarch tests rather than adding an ignored test path.
test_path = root / "test/multiarch-native-integration.test.js"
test_text = test_path.read_text(encoding="utf-8")
test_text = test_text.replace(
    'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { driverLaunchCommand } from "../src/native-integrations/service.js";\n',
    'import assert from "node:assert/strict";\nimport fs from "node:fs";\nimport os from "node:os";\nimport path from "node:path";\nimport test from "node:test";\nimport { driverLaunchCommand, pyInstallerOnedirEnvironment, wrapArm64HelperExecutables } from "../src/native-integrations/service.js";\n',
    1,
)
append = r'''

test("PyInstaller onedir ARM64 drivers skip the guest self-exec on amd64", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ucvr-pyi-"));
  try {
    const executable = path.join(root, "bin", "driver");
    fs.mkdirSync(path.join(root, "bin", "_internal"), { recursive: true });
    fs.writeFileSync(executable, "placeholder");
    const env = pyInstallerOnedirEnvironment({ driver_id: "pyi", executable, architecture: "arm64" }, {
      runtimeArch: "x64",
      ldLibraryPath: "/existing/lib"
    });
    assert.equal(env._PYI_ARCHIVE_FILE, executable);
    assert.equal(env._PYI_PARENT_PROCESS_LEVEL, "-1");
    assert.equal(env.LD_LIBRARY_PATH, `${path.join(root, "bin", "_internal")}:/existing/lib`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("secondary ARM64 executables are wrapped without replacing the main driver", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ucvr-helper-"));
  try {
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin, { recursive: true });
    const main = path.join(bin, "driver");
    const helper = path.join(bin, "node");
    fs.writeFileSync(main, "main", { mode: 0o755 });
    fs.writeFileSync(helper, "helper", { mode: 0o755 });
    const wrapped = wrapArm64HelperExecutables(root, main, {
      runtimeArch: "x64",
      architectureOf: (filename) => filename === helper ? "arm64" : null
    });
    assert.deepEqual(wrapped, [path.join("bin", "node")]);
    assert.equal(fs.readFileSync(main, "utf8"), "main");
    assert.match(fs.readFileSync(helper, "utf8"), /qemu-aarch64-static/);
    assert.equal(fs.readFileSync(`${helper}.ucvr-arm64`, "utf8"), "helper");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
'''
if 'PyInstaller onedir ARM64 drivers skip the guest self-exec' not in test_text:
    test_text += append
test_path.write_text(test_text, encoding="utf-8")

# Assert that future image changes cannot silently remove the privilege preflight.
regression = root / "test/integration-runtime-ui-regression.test.js"
reg_text = regression.read_text(encoding="utf-8")
if 'nested Docker checks mount namespace privilege' not in reg_text:
    reg_text = reg_text.replace(
        'const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");\n',
        'const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");\nconst entrypoint = fs.readFileSync(new URL("../docker-entrypoint.sh", import.meta.url), "utf8");\n',
        1,
    )
    reg_text += '''\n\ntest("nested Docker checks mount namespace privilege", () => {\n  assert.match(dockerfile, /util-linux/);\n  assert.match(entrypoint, /unshare --mount/);\n  assert.match(entrypoint, /disable Protection mode/);\n});\n'''
regression.write_text(reg_text, encoding="utf-8")

print("Applied UC Virtual Remote 0.14.5 runtime fixes")
