import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const launcherRoot = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.UCVR_DATA_DIR || path.join(launcherRoot, "data"));
const applicationDir = path.join(dataDir, "application");
const activeFile = path.join(applicationDir, "active.json");
const restartExitCode = 75;
let activeChild = null;
let stopping = false;

function readActiveApplication() {
  try {
    const metadata = JSON.parse(fs.readFileSync(activeFile, "utf8"));
    const candidate = path.resolve(String(metadata.path || ""));
    const releasesRoot = path.resolve(applicationDir, "releases");
    if (candidate !== releasesRoot && !candidate.startsWith(`${releasesRoot}${path.sep}`)) {
      throw new Error("active application path is outside the releases directory");
    }
    if (!fs.existsSync(path.join(candidate, "src", "index.js"))) {
      throw new Error("active application is missing src/index.js");
    }
    return { root: candidate, metadata };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error(`UC Virtual Remote launcher: ignoring invalid active release: ${error.message}`);
    }
    return { root: launcherRoot, metadata: null };
  }
}

function run(root, metadata) {
  return new Promise((resolve, reject) => {
    const entrypoint = path.join(root, "src", "index.js");
    const child = spawn(process.execPath, [...process.execArgv, entrypoint, ...process.argv.slice(2)], {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        UCVR_APPLICATION_ROOT: root,
        UCVR_LAUNCHER_ROOT: launcherRoot,
        UCVR_ACTIVE_RELEASE_ID: metadata?.id || "",
        UCVR_ACTIVE_RELEASE_COMMIT: metadata?.commit || "",
        UCVR_ACTIVE_RELEASE_CHANNEL: metadata?.channel || ""
      }
    });
    activeChild = child;
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      activeChild = null;
      resolve({ code: code ?? 1, signal });
    });
  });
}

function terminate(signal) {
  stopping = true;
  if (activeChild && !activeChild.killed) activeChild.kill(signal);
}

process.on("SIGINT", () => terminate("SIGINT"));
process.on("SIGTERM", () => terminate("SIGTERM"));

while (!stopping) {
  const { root, metadata } = readActiveApplication();
  console.log(`UC Virtual Remote launcher: starting ${metadata?.version || "bundled application"} from ${root}`);
  const result = await run(root, metadata);
  if (result.code !== restartExitCode || stopping) {
    process.exitCode = result.code;
    break;
  }
  console.log("UC Virtual Remote launcher: activating selected release");
}
