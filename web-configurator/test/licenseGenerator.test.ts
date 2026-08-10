/*
 * Modified by Justin Jäger for the Unfolded.Tools Remote Simulator.
 * Modified: 2026-08-03.
 * GNU GPL v3.0 only; see MODIFICATIONS.md.
 */
/**
 * tools/transform-license-checker.js — the attribution page generator.
 *
 * The page it produces is a compliance artifact, and the failure that motivated these tests
 * looked like a success: the run aborted on the repository's own package (no `repository`
 * field, so `gh repo view undefined` threw uncaught) and left a file missing its last 20
 * dependencies, with no non-zero exit and no footer. A generator that can silently truncate
 * is worse than one that fails.
 *
 * Runs the real script as a subprocess: its cwd contract (templates/ and patches/ relative to
 * tools/) is part of what is under test.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "tools",
);
const OWN_PACKAGE_JSON = JSON.parse(
  fs.readFileSync(path.join(TOOLS_DIR, "..", "package.json"), "utf-8"),
);
const OWN_PACKAGE = `${OWN_PACKAGE_JSON.name}@${OWN_PACKAGE_JSON.version}`;

/**
 * The proprietary notice template is `export-ignore`d from the public GPL source archive, and
 * without it the generator cannot produce a proprietary page at all — so the proprietary half of
 * these tests is skipped there. That absence is legitimate in the archive and nowhere else, so it
 * is only tolerated when `package.json` also says GPL; in a proprietary checkout a missing
 * template stays a failure.
 */
const gplSourceArchive =
  OWN_PACKAGE_JSON.license === "GPL-3.0-only" &&
  !fs.existsSync(
    path.join(TOOLS_DIR, "templates", "app-license-proprietary.md"),
  );

if (gplSourceArchive) {
  console.warn(
    "GPL source archive: tools/templates/app-license-proprietary.md is not part of it — skipping the proprietary license checks.",
  );
}

const APP_LICENSE_MODES = gplSourceArchive ? ["gpl"] : ["proprietary", "gpl"];

let workDir: string;
let licenseTextFile: string;

/** A stand-in for a package's own bundled LICENSE, so no network is involved. */
function fixture(extra: Record<string, unknown> = {}) {
  return {
    "aaa-first@1.0.0": {
      licenses: "MIT",
      repository: "https://github.com/example/aaa",
      licenseFile: licenseTextFile,
    },
    ...extra,
    "zzz-last@9.9.9": {
      licenses: "MIT",
      repository: "https://github.com/example/zzz",
      licenseFile: licenseTextFile,
    },
  };
}

/** Runs the real script over a fixture, so no dependency tree is resolved. */
function generate(input: Record<string, unknown>, args: string[] = []) {
  const inputFile = path.join(workDir, "licenses.json");
  const outputFile = path.join(workDir, "out.md");
  fs.writeFileSync(inputFile, JSON.stringify(input), "utf-8");

  const run = spawnSync(
    process.execPath,
    ["transform-license-checker.js", outputFile, "--input", inputFile, ...args],
    { cwd: TOOLS_DIR, encoding: "utf-8" },
  );

  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    output: fs.existsSync(outputFile)
      ? fs.readFileSync(outputFile, "utf-8")
      : "",
  };
}

/**
 * Headings from the generated npm list only. The real footer template hand-attributes the
 * components that are not npm packages (the bundled fonts and Material Symbols), and it is appended to
 * every run — including these fixture runs — so it has to be cut off here.
 */
const FOOTER_HEADING = "### Components that are not npm packages";

function headings(output: string): string[] {
  const at = output.indexOf(FOOTER_HEADING);
  return (at === -1 ? output : output.slice(0, at))
    .split("\n")
    .filter((line) => line.indexOf("#### ") === 0)
    .map((line) => line.slice(5).trim());
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "license-gen-"));
  licenseTextFile = path.join(workDir, "LICENSE");
  fs.writeFileSync(licenseTextFile, "MIT License\n\nCopyright (c) Example\n");
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("the repository's own package", () => {
  it("is not listed as a third-party dependency", () => {
    const run = generate(
      fixture({ [OWN_PACKAGE]: { licenses: "UNLICENSED" } }),
    );

    expect(run.status).toBe(0);
    expect(headings(run.output)).not.toContain(OWN_PACKAGE);
    expect(run.output).not.toContain("License: UNLICENSED");
    expect(run.stdout).toContain(`Skipped own package: ${OWN_PACKAGE}`);
  });

  it("no longer aborts the run", () => {
    // The own package used to sit at index 483 of 504 and killed everything after it.
    const run = generate(
      fixture({ [OWN_PACKAGE]: { licenses: "UNLICENSED" } }),
    );

    expect(headings(run.output)).toEqual(["aaa-first@1.0.0", "zzz-last@9.9.9"]);
  });
});

describe("a dependency whose license cannot be resolved", () => {
  it("does not stop the entries after it from being written", () => {
    const run = generate(fixture({ "no-repo@2.0.0": { licenses: "MIT" } }));

    expect(headings(run.output)).toContain("zzz-last@9.9.9");
    expect(run.stderr).toContain("no-repo@2.0.0");
  });

  it("makes the run fail, naming the dependency", () => {
    const run = generate(fixture({ "no-repo@2.0.0": { licenses: "MIT" } }));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("produced no license text");
    expect(run.stderr).toContain("no-repo@2.0.0");
  });
});

describe("a complete run", () => {
  it("succeeds and gives every dependency a heading and a license text", () => {
    const run = generate(fixture());

    expect(run.status).toBe(0);
    expect(run.stdout).toContain(
      "2 expected, 2 written, 0 without license text",
    );
    for (const module of ["aaa-first@1.0.0", "zzz-last@9.9.9"]) {
      const entry = run.output.split(`#### ${module}`)[1] ?? "";
      expect(entry).toContain("```");
      expect(entry).toContain("MIT License");
    }
  });

  it("reproduces the repository URL as running text, for the view to linkify", () => {
    const run = generate(fixture());

    expect(run.output).toContain(
      "may be downloaded from: https://github.com/example/aaa.",
    );
  });
});

/**
 * The GitHub fallback needs an authenticated `gh`, which CI does not have — so every dependency
 * that ships no license file must already be covered by a committed patch. This is what broke
 * CI: the Linux build platform installs `@esbuild/linux-x64` and `@rollup/rollup-linux-x64-*`
 * instead of the darwin variants, and only the darwin ones had patches.
 *
 * Asserted over whatever is in patches/ rather than a hardcoded package list, so a dependency
 * bump does not make this test lie. A bump that introduces a *new* unpatched package is caught
 * by the generator itself, loudly, at regeneration time.
 */
describe("committed license patches", () => {
  it("all resolve offline, with no repository to fall back to", () => {
    const patchesDir = path.join(TOOLS_DIR, "patches");
    const modules: string[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (fs.existsSync(path.join(dir, entry.name, "LICENSE"))) {
          modules.push(name);
        } else {
          walk(path.join(dir, entry.name), name);
        }
      }
    };
    walk(patchesDir, "");
    // Sanity check on the walk itself, not on the exact patch count, which changes with every
    // dependency bump.
    expect(modules.length).toBeGreaterThan(10);

    // No `licenseFile` and no `repository`: the only way these can resolve is from patches/.
    const input: Record<string, unknown> = {};
    for (const module of modules) {
      input[module] = { licenses: "MIT" };
    }
    const run = generate(input);

    expect(run.status, run.stderr).toBe(0);
    expect(headings(run.output).sort()).toEqual([...modules].sort());
  });

  it("covers both build platforms", () => {
    const patched = (glob: string) =>
      fs.existsSync(path.join(TOOLS_DIR, "patches", glob));
    const dirs = fs
      .readdirSync(path.join(TOOLS_DIR, "patches", "@esbuild"))
      .concat(fs.readdirSync(path.join(TOOLS_DIR, "patches", "@rollup")));

    expect(patched("@esbuild"), "@esbuild patches").toBe(true);
    expect(
      dirs.some((d) => d.startsWith("darwin-arm64@")),
      "macOS esbuild binary must be patched",
    ).toBe(true);
    expect(
      dirs.some((d) => d.startsWith("linux-x64@")),
      "Linux esbuild binary must be patched — CI builds on Linux",
    ).toBe(true);
    expect(
      dirs.some((d) => d.startsWith("rollup-linux-x64-gnu@")),
      "Linux rollup binary must be patched — CI builds on Linux",
    ).toBe(true);
  });
});

/**
 * Two builds ship: older snapshots under the GPL v3, and — since the re-licensing — proprietary
 * ones. A proprietary build claiming to be GPL would be a licensing misstatement in the product's
 * own About dialog, so it is worth pinning both branches.
 *
 * Asserted against the template files rather than against sentences quoted here. The notices are
 * legal prose and get reworded — an earlier version of this test pinned "GNU General Public
 * License v3" and broke when the wording moved to the FSF's standard "…, version 3", which was a
 * test failure reporting nothing about the code. What actually has to hold is that the section
 * carries the selected notice verbatim and that the proprietary one never mentions the GPL.
 */
describe("the license of the application itself", () => {
  /** The "## Software license" section only, up to the next second-level heading. */
  const header = (output: string) => {
    const from = output.indexOf("## Software license");
    if (from === -1) return "";
    const to = output.indexOf("\n## ", from + 1);
    return to === -1 ? output.slice(from) : output.slice(from, to);
  };

  const notice = (mode: string) =>
    fs
      .readFileSync(
        path.join(TOOLS_DIR, "templates", `app-license-${mode}.md`),
        "utf-8",
      )
      .trim();

  it.skipIf(gplSourceArchive)(
    "never claims the GPL in a proprietary build",
    () => {
      const run = generate(fixture(), ["--app-license", "proprietary"]);

      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toContain("App license: proprietary");
      expect(header(run.output)).toContain(notice("proprietary"));
      // The whole point of the switch. Scoped to this section: third-party license texts may legitimately mention the GPL.
      expect(header(run.output)).not.toMatch(/GPL|General Public License/i);
    },
  );

  it("states the GPL for the older snapshots", () => {
    const run = generate(fixture(), ["--app-license", "gpl"]);

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("App license: gpl");
    expect(header(run.output)).toContain(notice("gpl"));
    expect(header(run.output)).toMatch(/GNU General Public License/);
    // Only the cross-check needs the proprietary template; the GPL half above is exactly what
    // the source archive itself ships, so it keeps running there.
    if (!gplSourceArchive) {
      expect(header(run.output)).not.toContain(notice("proprietary"));
    }
  });

  it("carries the copyright holder either way", () => {
    for (const mode of APP_LICENSE_MODES) {
      const run = generate(fixture(), ["--app-license", mode]);
      expect(header(run.output), mode).toContain("Unfolded Circle ApS");
      // Both notice styles occur: "Copyright ©" and the GPL's "Copyright (C)".
      expect(header(run.output), mode).toMatch(/Copyright (©|\(C\)) \d{4}/);
    }
  });

  it("takes the mode from package.json when not forced", () => {
    const run = generate(fixture());
    const expected =
      OWN_PACKAGE_JSON.license === "UNLICENSED" ? "proprietary" : "gpl";

    expect(run.stdout).toContain(
      `App license: ${expected} (from package.json)`,
    );
  });

  it("rejects an unknown mode rather than guessing", () => {
    const run = generate(fixture(), ["--app-license", "mit"]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("--app-license must be one of");
  });
});

/**
 * The page must state the scope it was generated with, so it never claims a coverage it does
 * not have.
 *
 * Deliberately fixture-driven. These assertions used to run the real dependency resolution, and
 * that broke CI: on Linux the installed tree has `@esbuild/linux-x64` and the
 * `@rollup/rollup-linux-x64-*` packages instead of the darwin ones, they ship no license file,
 * and the generator's fallback needs an authenticated `gh` that GitHub Actions does not provide
 * — so the run exited non-zero for reasons that had nothing to do with the behaviour under test.
 * Network access, `gh` credentials and the host platform are not this test's business.
 *
 * That the runtime scope really excludes the toolchain is asserted where it is both meaningful
 * and hermetic: `licensesArtifact.test.ts` checks the committed page for vue/pinia/axios and
 * against vitest/eslint/@playwright/test.
 */
describe("the scope stated on the page", () => {
  it("claims runtime-only coverage by default", () => {
    const run = generate(fixture());

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("Scope: runtime dependencies only");
    expect(run.output).toContain(
      "used in the Unfolded Circle Web-Configurator for Remote Two/3.",
    );
    expect(run.output).not.toContain("including those used during development");
  });

  it("says so when devDependencies are included", () => {
    const run = generate(fixture(), ["--include-dev"]);

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("Scope: runtime and development dependencies");
    expect(run.output).toContain("including those used during development");
  });
});
