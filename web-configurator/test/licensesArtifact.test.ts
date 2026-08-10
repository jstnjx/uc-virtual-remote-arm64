/*
 * Modified by Justin Jäger for the Unfolded.Tools Remote Simulator.
 * Modified: 2026-08-03.
 * GNU GPL v3.0 only; see MODIFICATIONS.md.
 */
/**
 * The committed attribution page, public/licenses.md.
 *
 * It is generated, half a megabyte, and only a human ever looks at it — which is exactly why a
 * bad regeneration can slip through review. The generator refuses to write an incomplete page
 * (see licenseGenerator.test.ts); this guards the artifact that is actually shipped, so a
 * truncated or hand-edited file fails the suite rather than the compliance audit.
 *
 * It deliberately does not compare against a live `license-checker` run: the installed tree
 * differs by platform (`@esbuild/darwin-arm64` vs `linux-x64`), so that would fail wherever the
 * page was not last regenerated. Staleness is a release-checklist concern, not this test's.
 *
 * Loaded through Vite's `?raw`, not the filesystem: the vitest project is DOM-typed with no
 * node types, and this keeps the test to the same import machinery the app uses.
 */
import { describe, it, expect } from "vitest";

import licenses from "../public/licenses.md?raw";
import gplNotice from "../tools/templates/app-license-gpl.md?raw";
import pkg from "../package.json";

const ownPackage = `${pkg.name}@${pkg.version}`;

/**
 * The proprietary notice template is `export-ignore`d from the public GPL source archive, so it
 * is loaded through a glob rather than a static import: a file that is not there simply does not
 * match, where the static import fails the whole module and takes every test in it down.
 *
 * Its absence is legitimate in that archive and nowhere else, so it is only tolerated when
 * `package.json` also says GPL — a missing template in a proprietary checkout stays a failure.
 */
const [proprietaryNotice = ""] = Object.values(
  import.meta.glob("../tools/templates/app-license-proprietary.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
) as string[];

const gplSourceArchive =
  pkg.license === "GPL-3.0-only" && proprietaryNotice === "";

if (gplSourceArchive) {
  console.warn(
    "GPL source archive: tools/templates/app-license-proprietary.md is not part of it — skipping the proprietary notice check.",
  );
}

/**
 * The page has two parts: the generated npm list, then a hand-maintained section for the
 * components that are not npm packages (the bundled fonts and Material Symbols). They are checked
 * separately — the npm half must be alphabetically complete, the hand half must simply be
 * present and attributed.
 */
const FOOTER_HEADING = "### Components that are not npm packages";

function parseEntries(section: string) {
  const found = new Map<string, boolean>();
  const order: string[] = [];
  let current = "";
  for (const line of section.split("\n")) {
    if (line.indexOf("#### ") === 0) {
      current = line.slice(5).trim();
      order.push(current);
      found.set(current, false);
    } else if (current && line.indexOf("```") === 0) {
      found.set(current, true);
    }
  }
  return { found, order };
}

const [npmSection, handSection = ""] = (() => {
  const at = licenses.indexOf(FOOTER_HEADING);
  return at === -1 ? [licenses] : [licenses.slice(0, at), licenses.slice(at)];
})();

const entries = parseEntries(npmSection);
const handAttributed = parseEntries(handSection);

const modules = entries.order;
const has = (prefix: string) =>
  modules.some((module) => module.indexOf(prefix) === 0);

describe("the shipped attribution page", () => {
  it("is served as a static asset, so it is not part of any JS chunk", () => {
    // Living under public/ is what makes Vite copy it verbatim into dist/ instead of bundling
    // it, and what keeps a half-megabyte compliance artifact off the first-load path.
    expect(licenses.length).toBeGreaterThan(100_000);
  });

  it("carries the third-party attribution preamble", () => {
    expect(licenses).toContain(
      "THE FOLLOWING SETS FORTH ATTRIBUTION NOTICES FOR THIRD PARTY SOFTWARE",
    );
  });

  it("attributes the whole runtime closure, not a truncated prefix", () => {
    // The truncated predecessor stopped mid-alphabet, in the w's, so the tail matters as much
    // as the count. license-checker orders its output alphabetically.
    expect(modules.length).toBeGreaterThan(100);
    expect(modules[modules.length - 1]).toMatch(/^[v-z]/);
  });

  it("gives every entry a license text", () => {
    const withoutText = modules.filter(
      (module) => entries.found.get(module) === false,
    );

    expect(withoutText).toEqual([]);
  });

  it("lists each dependency once", () => {
    expect(modules.length).toBe(entries.found.size);
  });

  it("does not list the application itself", () => {
    expect(entries.found.has(ownPackage)).toBe(false);
    expect(licenses).not.toContain("License: UNLICENSED");
  });

  it("covers what is shipped and nothing more", () => {
    // Bundled at runtime — vue and its closure, and markdown-it via vue-markdown-render, which
    // renders this very page.
    expect(has("vue@")).toBe(true);
    expect(has("pinia@")).toBe(true);
    expect(has("axios@")).toBe(true);
    expect(has("markdown-it@")).toBe(true);

    // Never shipped: the test and lint toolchain. The page defaults to the runtime scope
    // (tools/transform-license-checker.js --include-dev opts back in).
    expect(has("vitest@")).toBe(false);
    expect(has("eslint@")).toBe(false);
    expect(has("@playwright/test@")).toBe(false);
  });

  it("does not claim to cover development dependencies", () => {
    expect(licenses).not.toContain("including those used during development");
  });

  it("carries the application's own copyright", () => {
    expect(licenses).toContain("Unfolded Circle ApS");
    // Both notice styles occur: "Copyright ©" and the GPL's "Copyright (C)".
    expect(licenses).toMatch(/Copyright (©|\(C\)) \d{4}/);
  });

  /**
   * The notice follows `package.json`: `UNLICENSED` is the proprietary build, anything else the
   * older GPL v3 snapshots. Shipping a page that states the wrong one would be a licensing
   * misstatement in the product's own About dialog.
   *
   * Compared against the template rather than against sentences quoted here — the notices are
   * legal prose and get reworded, and a test that breaks on a reword reports nothing about the
   * page. This also catches the page going stale after a template edit without a regeneration.
   */
  it.skipIf(gplSourceArchive)(
    "carries the notice for the licence this build has",
    () => {
      // Not skipped, so the template has to be there — see `gplSourceArchive`.
      expect(
        proprietaryNotice,
        "tools/templates/app-license-proprietary.md is missing, and this is not the GPL source archive",
      ).not.toBe("");

      const from = licenses.indexOf("## Software license");
      const to = licenses.indexOf("\n## ", from + 1);
      const section = licenses.slice(from, to);
      const proprietary = pkg.license === "UNLICENSED";

      expect(section).toContain(
        (proprietary ? proprietaryNotice : gplNotice).trim(),
      );
      expect(section).not.toContain(
        (proprietary ? gplNotice : proprietaryNotice).trim(),
      );

      if (proprietary) {
        // Scoped to this section — third-party license texts may legitimately mention the GPL.
        expect(section).not.toMatch(/GPL|General Public License/i);
      }
    },
  );

  /**
   * The software license used to be an untitled preamble above the dependency list. Naming it is
   * what lets a reader — or an auditor reading the committed file on its own — see at a glance
   * that the product states a license for itself, and it is what the view turns into an anchor.
   */
  it("names the software license as its own section", () => {
    expect(licenses).toContain("\n## Software license\n");
    expect(licenses).toContain("\n## Third-party licenses\n");
    expect(licenses.indexOf("## Software license")).toBeLessThan(
      licenses.indexOf("## Third-party licenses"),
    );
  });

  it("states a license for every entry", () => {
    const declared = licenses
      .split("\n")
      .filter((line) => line.indexOf("License: ") === 0);

    // Every entry declares one; license bodies can repeat the phrase, so this is a floor.
    expect(declared.length).toBeGreaterThanOrEqual(modules.length);
  });
});

/**
 * `license-checker` only sees npm packages, so anything else the build bundles would be
 * attributed nowhere. These are the components that are shipped but not installed as packages.
 */
describe("components that are not npm packages", () => {
  it("attributes the bundled webfonts, Material Symbols and the artwork", () => {
    expect(handAttributed.order).toEqual([
      "Poppins",
      "Space Mono",
      "Material Symbols Sharp",
      "Background images",
    ]);
  });

  it("gives each of them a license text", () => {
    const withoutText = handAttributed.order.filter(
      (name) => handAttributed.found.get(name) === false,
    );

    expect(withoutText).toEqual([]);
  });

  it("reproduces the fonts' own copyright lines, as the OFL requires", () => {
    expect(licenses).toContain(
      "Copyright 2014-2019 Indian Type Foundry (info@indiantypefoundry.com)",
    );
    expect(licenses).toContain(
      "Copyright 2016 The Space Mono Project Authors (https://github.com/googlefonts/spacemono)",
    );
    expect(licenses).toContain("SIL OPEN FONT LICENSE");
  });

  it("attributes the Material Symbols font under Apache 2.0", () => {
    expect(licenses).toContain("Material Symbols Sharp");
    expect(licenses).toContain("Apache License");
  });
});
