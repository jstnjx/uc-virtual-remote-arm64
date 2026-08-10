from pathlib import Path

root = Path.cwd()
service = root / "src/native-integrations/service.js"
text = service.read_text(encoding="utf-8")
old = '''      if (entry.isDirectory()) {\n        stack.push(filename);\n        continue;\n      }\n      if (!entry.isFile() || path.resolve(filename) === resolvedMain || filename.endsWith(suffix)) continue;\n      const stat = fs.statSync(filename);\n'''
new = '''      if (entry.isDirectory()) {\n        // PyInstaller internals and Node native modules are libraries loaded by\n        // the emulated process, not child executables. Replacing any of those\n        // files with shell wrappers would corrupt the package.\n        if (["_internal", "node_modules"].includes(entry.name)) continue;\n        stack.push(filename);\n        continue;\n      }\n      if (!entry.isFile() || path.resolve(filename) === resolvedMain || filename.endsWith(suffix)) continue;\n      if (/\\.(?:so(?:\\..*)?|node|a|o)$/i.test(entry.name)) continue;\n      const stat = fs.statSync(filename);\n'''
if old not in text:
    raise SystemExit("helper traversal anchor not found")
service.write_text(text.replace(old, new, 1), encoding="utf-8")

test_file = root / "test/multiarch-native-integration.test.js"
test = test_file.read_text(encoding="utf-8")
old_test = '''    const main = path.join(bin, "driver");\n    const helper = path.join(bin, "node");\n    fs.writeFileSync(main, "main", { mode: 0o755 });\n    fs.writeFileSync(helper, "helper", { mode: 0o755 });\n    const wrapped = wrapArm64HelperExecutables(root, main, {\n      runtimeArch: "x64",\n      architectureOf: (filename) => filename === helper ? "arm64" : null\n    });\n    assert.deepEqual(wrapped, [path.join("bin", "node")]);\n    assert.equal(fs.readFileSync(main, "utf8"), "main");\n    assert.match(fs.readFileSync(helper, "utf8"), /qemu-aarch64-static/);\n    assert.equal(fs.readFileSync(`${helper}.ucvr-arm64`, "utf8"), "helper");\n'''
new_test = '''    const main = path.join(bin, "driver");\n    const helper = path.join(bin, "node");\n    const internal = path.join(bin, "_internal");\n    const modules = path.join(bin, "bridge", "node_modules", "native");\n    const sharedLibrary = path.join(internal, "libpython3.11.so.1.0");\n    const nativeModule = path.join(modules, "binding.node");\n    fs.mkdirSync(internal, { recursive: true });\n    fs.mkdirSync(modules, { recursive: true });\n    fs.writeFileSync(main, "main", { mode: 0o755 });\n    fs.writeFileSync(helper, "helper", { mode: 0o755 });\n    fs.writeFileSync(sharedLibrary, "shared", { mode: 0o755 });\n    fs.writeFileSync(nativeModule, "native", { mode: 0o755 });\n    const wrapped = wrapArm64HelperExecutables(root, main, {\n      runtimeArch: "x64",\n      architectureOf: (filename) => [helper, sharedLibrary, nativeModule].includes(filename) ? "arm64" : null\n    });\n    assert.deepEqual(wrapped, [path.join("bin", "node")]);\n    assert.equal(fs.readFileSync(main, "utf8"), "main");\n    assert.match(fs.readFileSync(helper, "utf8"), /qemu-aarch64-static/);\n    assert.equal(fs.readFileSync(`${helper}.ucvr-arm64`, "utf8"), "helper");\n    assert.equal(fs.readFileSync(sharedLibrary, "utf8"), "shared");\n    assert.equal(fs.readFileSync(nativeModule, "utf8"), "native");\n'''
if old_test not in test:
    raise SystemExit("helper test anchor not found")
test_file.write_text(test.replace(old_test, new_test, 1), encoding="utf-8")
print("Refined ARM64 helper executable scan")
