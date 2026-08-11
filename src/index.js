import { spawn } from "node:child_process";
import http from "node:http";
import process from "node:process";
import { fileURLToPath } from "node:url";

const entrypoint = fileURLToPath(import.meta.url);
const reexecMarker = "UCVR_SQLITE_REEXEC";
const nativeCreateServer = http.createServer;

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

function coreResourceType(type) {
  const value = String(type || "").toLowerCase();
  if (value === "icon") return "icon";
  if (["background", "backgroundimage"].includes(value)) return "background";
  return null;
}

function normalizePublicResourceRequest(request) {
  if (request.method !== "GET") return;
  const url = new URL(request.url || "/", "http://localhost");
  const resource = url.pathname.match(/^\/(?:api\/)?resources\/([^/]+)\/([^/]+)$/);
  if (!resource) return;
  const type = coreResourceType(resource[1]);
  if (!type) return;

  // The Core REST API is authenticated, but resource URLs are also embedded into
  // views rendered by external/mobile clients. Those image requests commonly do
  // not carry the API Authorization header. Route only the binary GET to UCVR's
  // existing public immutable-content endpoint; list/upload/delete remain on the
  // normal authenticated Core/management routes.
  url.pathname = `/api/resources/${type}/${resource[2]}/content`;
  request.url = `${url.pathname}${url.search}`;
}

function installPublicResourceCompatibility() {
  if (http.createServer.__ucvrPublicResourceCompatibility) return;

  const createServer = function createServer(...args) {
    const listenerIndex = typeof args[0] === "function" ? 0 : typeof args[1] === "function" ? 1 : -1;
    if (listenerIndex >= 0) {
      const listener = args[listenerIndex];
      args[listenerIndex] = (request, response) => {
        normalizePublicResourceRequest(request);
        return listener(request, response);
      };
    }
    return nativeCreateServer.apply(http, args);
  };
  Object.defineProperty(createServer, "__ucvrPublicResourceCompatibility", { value: true });
  http.createServer = createServer;
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
