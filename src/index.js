import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { installPublicResourceCompatibility } from "./api/public-resource-compatibility.js";

const entrypoint = fileURLToPath(import.meta.url);
const reexecMarker = "UCVR_SQLITE_REEXEC";

function nodeVersion() {
  const [major = 0, minor = 0, patch = 0] = process.versions.node.split(".").map(Number);
  return { major, minor, patch };
}

function supportsExperimentalSqliteFlag() {
  const { major, minor } = nodeVersion();
  return major > 22 || (major === 22 && minor >= 5);
}

async function hasSqliteBuiltin() {
  try {
    await import("node:sqlite");
    return true;
  } catch (error) {
    if (error?.code === "ERR_UNKNOWN_BUILTIN_MODULE") return false;
    throw error;
  }
}

function relaunchWithSqliteFlag() {
  return new Promise((resolve, reject) => {
    const execArgv = process.execArgv.filter(
      (argument) => argument !== "--experimental-sqlite" && argument !== "--no-experimental-sqlite"
    );
    const child = spawn(
      process.execPath,
      ["--experimental-sqlite", ...execArgv, entrypoint, ...process.argv.slice(2)],
      {
        stdio: "inherit",
        env: { ...process.env, [reexecMarker]: "1" }
      }
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function bootstrap() {
  installPublicResourceCompatibility();

  if (await hasSqliteBuiltin()) {
    await import("./main.js");
    return;
  }

  if (!supportsExperimentalSqliteFlag()) {
    throw new Error(
      `UC Virtual Remote requires Node.js 22.5.0 or newer. ` +
      `Current version: ${process.versions.node}.`
    );
  }

  if (process.env[reexecMarker] === "1" || process.execArgv.includes("--experimental-sqlite")) {
    throw new Error(
      `The node:sqlite module is unavailable in Node.js ${process.versions.node}, ` +
      `even with --experimental-sqlite. Install Node.js 22.5.0 or newer.`
    );
  }

  const exitCode = await relaunchWithSqliteFlag();
  process.exitCode = exitCode;
}

await bootstrap();
