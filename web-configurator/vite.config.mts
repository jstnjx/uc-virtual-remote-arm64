import { fileURLToPath, URL } from "url";

import type { UserConfig } from "vite";
import { loadEnv, defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

import fs from "node:fs";

import gitDescribe from "git-describe";
const { gitDescribeSync } = gitDescribe;

const envDir = "./env";
const config: UserConfig = {
  base: process.env.BASE_URL || "/",
  plugins: [vue()],
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./public", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/js/[name]-[hash].js",
        chunkFileNames: "assets/js/[name]-[hash].js",
        assetFileNames: "assets/[ext]/[name]-[hash].[ext]",
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
  envDir,
};

function getVersion() {
  // Check if there's a version file. This is used for building within Buildroot, where git information is not available!
  try {
    // First line must contain version string
    const version = fs
      .readFileSync("version.txt", "utf8")
      .trim()
      .split("\n")[0];
    console.warn("Using static version from version.txt: %s", version);
    return version;
  } catch (_err) {
    // ignore, use git information
  }

  // Get git information
  const gitInfo = gitDescribeSync(__dirname, {
    longSemver: true,
    dirtySemver: true,
  });
  // console.dir(gitInfo);

  // build semver version information. Note: the gitInfo.semverString is not quite what we want, it's only used as a fallback!
  if (gitInfo.semver) {
    // should always be true if semver dependency is present
    if (gitInfo.distance && gitInfo.distance > 0) {
      // development build: increase patch version for SemVer comparison, otherwise it would be considered an older version!
      const devVersion = gitInfo.semver.inc("patch");
      let version =
        "v" +
        devVersion.version +
        "-dev." +
        gitInfo.distance +
        "+" +
        gitInfo.hash;
      if (gitInfo.dirty) {
        version += ".dirty";
      }
      return version;
    } else if (gitInfo.dirty) {
      // dirty release
      return "v" + gitInfo.semver.version + "+" + gitInfo.hash + ".dirty";
    } else {
      // clean version
      return "v" + gitInfo.semver.version;
    }
  } else if (gitInfo.semverString) {
    return gitInfo.semverString;
  } else if (gitInfo.raw) {
    return gitInfo.raw;
  }

  return "";
}

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, envDir, "");
  console.log(mode, command);
  if (command === "serve" && env.VITE_API_PROXY && env.VITE_API_PROXY !== "/") {
    const proxy = {
      "/api": {
        target: env.VITE_API_PROXY,
        changeOrigin: true,
        timeout: 5000,
      },
      "/ws": {
        target: env.VITE_API_PROXY.replace(/^http/, "ws"),
        ws: true,
        timeout: 2000,
      },
    };
    // `server` is the dev server; `preview` serves a production build. The e2e
    // suite runs against a build in CI (no on-demand route compilation, so route
    // navigations don't time out), and it needs the same proxy to the simulator.
    config.server = { ...(config.server || {}), proxy };
    config.preview = { ...(config.preview || {}), proxy };
  }

  process.env.VITE_GIT_LATEST_TAG = getVersion();
  console.log(`Version: ${process.env.VITE_GIT_LATEST_TAG}`);

  return config;
});
