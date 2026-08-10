import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const roots = ["src", "test", "tools", "examples"];
let count = 0;
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.name.endsWith(".js")) {
        const source = fs.readFileSync(target, "utf8");
        if (source.includes("\r\n")) throw new Error(`${target}: CRLF line endings`);
        if (source.includes("\t")) throw new Error(`${target}: tab character`);
        count += 1;
      }
    }
  }
}

const configuratorRoot = path.resolve("web-configurator");
const packageFile = path.join(configuratorRoot, "package.json");
const lockFile = path.join(configuratorRoot, "package-lock.json");
if (!fs.existsSync(packageFile) || !fs.existsSync(lockFile)) {
  throw new Error("web-configurator/: committed modified source tree is missing");
}
const configuratorPackage = JSON.parse(fs.readFileSync(packageFile, "utf8"));
if (configuratorPackage.version !== "2.3.3-unfoldedtools.8") {
  throw new Error(`web-configurator/: unexpected version ${configuratorPackage.version}`);
}
if (configuratorPackage.license !== "GPL-3.0-only") {
  throw new Error(`web-configurator/: unexpected licence ${configuratorPackage.license}`);
}
if (configuratorPackage.dependencies?.["@fortawesome/fontawesome-free"] || configuratorPackage.devDependencies?.["@fortawesome/fontawesome-free"]) {
  throw new Error("web-configurator/: Font Awesome dependency must not be present");
}
for (const relative of [
  "ARTWORK.md",
  "MODIFICATIONS.md",
  "LICENSE",
  "LICENSES/CC-BY-4.0.txt",
  "src/main.ts",
  "public/images/remote-3-dark-front.webp",
  "public/images/remote-3-dark-front-min.webp",
  "public/images/remote-3-dark-backlight-mask.png"
]) {
  if (!fs.existsSync(path.join(configuratorRoot, relative))) {
    throw new Error(`web-configurator/: missing ${relative}`);
  }
}
const lockSha = crypto.createHash("sha256").update(fs.readFileSync(lockFile)).digest("hex");
if (lockSha !== "4710cabe340f24cfa02dfb8f6ff143536c556fdf43fb9d88668e754ed007fddf") {
  throw new Error(`web-configurator/package-lock.json: checksum mismatch (${lockSha})`);
}

console.log(`Checked ${count} JavaScript files and the committed Web Configurator source tree`);
