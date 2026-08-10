/*
 * Modified by Justin Jäger for the Unfolded.Tools Remote Simulator.
 * Modified: 2026-08-03.
 * GNU GPL v3.0 only; see MODIFICATIONS.md.
 */
// Simple helper script to create the third-party license overview page in markdown,
// shipped with the web-configurator and shown in Settings > General > About > Licenses.
//
// Run it from this directory (it reads templates/ and writes patches/ relative to the cwd):
// cd tools && node transform-license-checker.js ../public/licenses.md
//
// Usage: node transform-license-checker.js <output.md> [options]
//
//   --include-dev            also attribute devDependencies. Off by default: the shipped page
//                            should describe what is shipped, and the runtime closure is 149
//                            of the 504 installed packages.
//   --input <licenses.json>  transform an existing `license-checker --json` file instead of
//                            running license-checker. The scope is then whatever that file
//                            holds, so --include-dev has no effect.
//
// Exits non-zero if any dependency produced no license text, so an incomplete attribution
// page fails loudly instead of shipping silently truncated. See tools/README.md.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const TIMEOUT = 10000;

function readOwnPackage() {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
  );
}

// The repository's own package is not a third-party dependency. It also has no `repository`
// field, which used to abort the whole run on `gh repo view undefined`.
function getOwnPackageKey() {
  const pkg = readOwnPackage();
  return `${pkg.name}@${pkg.version}`;
}

// Two builds ship: older snapshots under the GPL v3, and — since the re-licensing — proprietary
// ones. The notice at the top of the page must match, and a proprietary build must not claim to
// be GPL.
//
// `"license": "UNLICENSED"` in package.json marks the proprietary build. Anything else is
// treated as the GPL build: the field is used only as a proprietary/not switch and never as the
// notice itself. `--app-license` overrides the detection, which is what makes both branches
// testable and lets an old snapshot's page be regenerated from a newer checkout.
function detectAppLicense() {
  return readOwnPackage().license === "UNLICENSED" ? "proprietary" : "gpl";
}

function ensureFileExists(file) {
  if (!fs.existsSync(file)) {
    console.error(`File does not exist: ${file}`);
    process.exit(1);
  }
}

function getLocalLicensePatch(module) {
  const patchedLicense = `patches/${module}/LICENSE`;
  if (fs.existsSync(patchedLicense)) {
    console.log(`Using a license patch for: ${module}`);
    return patchedLicense;
  }
}

function getLicensePatch(module, repository) {
  const licenseFile = getLocalLicensePatch(module);
  if (licenseFile) {
    return licenseFile;
  }

  if (!repository) {
    console.error(`No repository for ${module}, cannot download a license.`);
    return undefined;
  }

  const patchPath = `patches/${module}`;
  fs.mkdirSync(patchPath, { recursive: true });

  downloadLicenseFromGitHub(repository, patchPath + "/LICENSE");

  return getLocalLicensePatch(module);
}

function getGitHubDefaultBranch(url) {
  const branch = execSync(
    `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name ${url}`,
    {
      timeout: TIMEOUT,
      encoding: "utf-8",
    },
  );

  return branch.trim();
}

function downloadGitHubFile(url, file) {
  console.log(`Downloading file from ${url} to ${file}`);
  try {
    execSync(
      `curl -L --fail --no-progress-meter --connect-timeout 10 -o ${file} ${url}`,
    );
    return true;
  } catch (e) {
    console.log(e.message);
  }
  return false;
}

// GitHub's license API resolves the license file whatever it is called (e.g. MIT-LICENSE.txt),
// which the fixed filename list below cannot.
function downloadDetectedLicense(repository, file) {
  const slug = repository.replace(/^https?:\/\/github\.com\//, "");
  try {
    const content = execSync(
      `gh api "repos/${slug}/license" --jq .content | base64 -d`,
      {
        timeout: TIMEOUT,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (content.trim()) {
      fs.writeFileSync(file, content, "utf-8");
      return true;
    }
  } catch (e) {
    console.log(
      `No license detected by the GitHub API for ${slug}: ${e.message}`,
    );
  }
  return false;
}

function downloadLicenseFromGitHub(repository, file) {
  if (downloadDetectedLicense(repository, file)) {
    return true;
  }

  const licenseNames = ["LICENSE", "LICENCE", "LICENSE.md"];

  const branch = getGitHubDefaultBranch(repository);

  for (const licenseName of licenseNames) {
    if (
      downloadGitHubFile(`${repository}/raw/${branch}/${licenseName}`, file)
    ) {
      return true;
    }
  }

  return false;
}

const APP_LICENSES = ["proprietary", "gpl"];

function parseArgs(argv) {
  const options = {
    includeDev: false,
    input: undefined,
    output: undefined,
    appLicense: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--include-dev") {
      options.includeDev = true;
    } else if (arg === "--input") {
      options.input = argv[++i];
      if (!options.input) {
        usage("--input needs a file");
      }
    } else if (arg === "--app-license") {
      options.appLicense = argv[++i];
      if (!APP_LICENSES.includes(options.appLicense)) {
        usage(`--app-license must be one of: ${APP_LICENSES.join(", ")}`);
      }
    } else if (arg.startsWith("-")) {
      usage(`Unknown option: ${arg}`);
    } else if (!options.output) {
      options.output = arg;
    } else {
      usage(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.output) {
    usage("Missing <output.md>");
  }

  return options;
}

function usage(message) {
  console.error(
    `${message}\n\n` +
      "Usage: node transform-license-checker.js <output.md> [options]\n" +
      "  --include-dev            also attribute devDependencies (default: runtime only)\n" +
      "  --input <licenses.json>  use an existing license-checker JSON instead of running it\n" +
      `  --app-license <mode>     ${APP_LICENSES.join("|")} — the notice for the app itself\n` +
      "                           (default: proprietary when package.json is UNLICENSED)\n",
  );
  process.exit(1);
}

// license-checker resolves dependencies from the cwd, so it has to run at the repository root
// rather than in tools/. `--production` is what restricts it to the runtime closure.
function runLicenseChecker(includeDev) {
  const repoRoot = path.join(__dirname, "..");
  const scope = includeDev ? "" : " --production";
  const command = `npx --yes license-checker --json${scope}`;

  console.log(`Running (in ${repoRoot}): ${command}`);
  return JSON.parse(
    execSync(command, {
      cwd: repoRoot,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
}

const options = parseArgs(process.argv.slice(2));
const outputFile = options.output;

// `--include-dev` means one thing everywhere: it selects the scope. Without `--input` it also
// picks the license-checker flag; with `--input` the caller has already resolved the tree, so
// the flag only states which scope that file holds. Keeping it one meaning is what lets the
// scope wording be tested from a fixture instead of a live dependency resolution.
const scope = options.includeDev
  ? "runtime and development dependencies"
  : "runtime dependencies only";

let licenses;
let scopeDescription;
if (options.input) {
  ensureFileExists(options.input);
  licenses = JSON.parse(fs.readFileSync(options.input, "utf-8"));
  scopeDescription = `${scope} (as given by ${options.input})`;
} else {
  licenses = runLicenseChecker(options.includeDev);
  scopeDescription = scope;
}

const ownPackage = getOwnPackageKey();
const expectedModules = Object.keys(licenses).filter((m) => m !== ownPackage);

// The header states both the scope of the page and the license of the app itself, so neither can
// be hard-coded in the template.
const appLicense = options.appLicense ?? detectAppLicense();
const appLicenseNotice = fs
  .readFileSync(`templates/app-license-${appLicense}.md`, "utf-8")
  .trim();

fs.writeFileSync(
  outputFile,
  fs
    .readFileSync("templates/licenses-header.md", "utf-8")
    .replace("$APP_LICENSE", appLicenseNotice)
    .replace(
      "$SCOPE",
      options.includeDev ? ", including those used during development" : "",
    ),
  "utf-8",
);

for (const module of expectedModules) {
  console.log(`${module}: ${licenses[module].licenses}`);

  const repository = licenses[module].repository;

  fs.appendFileSync(outputFile, `#### ${module}\n`, "utf-8");
  fs.appendFileSync(
    outputFile,
    `License: ${licenses[module].licenses}  \n`,
    "utf-8",
  );
  if (repository) {
    fs.appendFileSync(
      outputFile,
      `This software may be included in this product and a copy of the source code may be downloaded from: ${repository}.\n`,
      "utf-8",
    );
  }

  // A single unresolvable module must not abort the whole run: it is recorded and reported
  // in the summary below, and the remaining modules are still written.
  let licenseFile = licenses[module].licenseFile;
  try {
    if (!licenseFile) {
      licenseFile = getLicensePatch(module, repository);
    }

    // special handling for invalid metadata.
    // Quick check: all README.md references turned out to be invalid. THIS MIGHT CHANGE ANYTIME!!!
    if (licenseFile && licenseFile.endsWith("README.md")) {
      if (licenses[module].licenses === "Unlicense") {
        licenseFile = licenseFile.replace("README.md", "UNLICENSE");
      } else {
        licenseFile = getLicensePatch(module, repository);
      }
    }
  } catch (e) {
    console.error(`ERROR: ${module} license lookup failed: ${e.message}`);
    licenseFile = undefined;
  }

  if (!licenseFile) {
    console.error(
      `ERROR: ${module} (${licenses[module].licenses}) no license file found!`,
    );
    continue;
  }

  fs.appendFileSync(outputFile, "\n```\n", "utf-8");
  fs.appendFileSync(
    outputFile,
    fs.readFileSync(`${licenseFile}`, "utf-8"),
    "utf-8",
  );
  fs.appendFileSync(outputFile, "\n```\n\n", "utf-8");
}

fs.appendFileSync(
  outputFile,
  fs.readFileSync("templates/licenses-footer.md", "utf-8"),
  "utf-8",
);

// Completeness check against the written file: every expected module must have a heading, and
// every heading must be followed by a fenced license text. This is what catches a run that
// died partway through, which used to produce a silently truncated page.
const entries = new Map();
let currentModule;
for (const line of fs.readFileSync(outputFile, "utf-8").split("\n")) {
  const heading = line.match(/^#### (.+)$/);
  if (heading) {
    currentModule = heading[1].trim();
    entries.set(currentModule, false);
  } else if (currentModule && line.startsWith("```")) {
    entries.set(currentModule, true);
  }
}

const missing = expectedModules.filter((m) => !entries.has(m));
const withoutText = expectedModules.filter((m) => entries.get(m) === false);

// Counted over expectedModules, not over every heading: the footer template hand-attributes
// the components that are not npm packages (the bundled fonts and Material Symbols), and those must
// not inflate the npm tally.
const written = expectedModules.filter((m) => entries.has(m)).length;

console.log(
  `\nApp license: ${appLicense}` +
    `${options.appLicense ? " (forced by --app-license)" : " (from package.json)"}\n` +
    `Scope: ${scopeDescription}\n` +
    `Skipped own package: ${ownPackage}\n` +
    `Modules: ${expectedModules.length} expected, ${written} written, ` +
    `${withoutText.length} without license text\n` +
    `Hand-attributed (footer): ${entries.size - written}`,
);

if (missing.length > 0) {
  console.error(
    `ERROR: ${missing.length} module(s) missing from ${outputFile}:\n  ${missing.join("\n  ")}`,
  );
}

if (withoutText.length > 0) {
  console.error(
    `ERROR: ${withoutText.length} of ${expectedModules.length} module(s) produced no license text:\n  ` +
      withoutText.join("\n  ") +
      `\nAdd a patches/<module>/LICENSE file for each, then re-run.`,
  );
}

if (missing.length > 0 || withoutText.length > 0) {
  process.exit(1);
}

console.log(`Wrote ${outputFile}`);
