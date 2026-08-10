# Web Configurator tooling

This directory contains development, packaging, versioning, and license-attribution utilities retained from the published Web Configurator source and adapted where necessary for the Unfolded.Tools community build.

The canonical UC Virtual Remote build is started from the repository root with:

```shell
npm run prepare:web-configurator
```

That command compiles the committed source tree and generates the corresponding-source archive used by the application image.

## `simulator/sim.sh`

`simulator/sim.sh` manages the public [Remote Core Simulator](https://github.com/unfoldedcircle/core-simulator) container used for direct frontend development without physical hardware.

The related npm scripts are:

- `sim:up` — starts the simulator;
- `sim:reset` — resets the simulator state;
- `sim:down` — stops the simulator; and
- `dev:sim` — starts the frontend development server against the simulator.

Example:

```shell
npm run sim:up
npm run dev:sim
```

The default login PIN is `1234`.

Supported overrides are `SIM_IMAGE`, `SIM_PORT`, `SIM_MODEL` (`UCR3` or `UCR2`), and `SIM_NAME`.

## `create-custom-install.sh`

This upstream utility creates a custom Web Configurator installation archive for a physical Remote Two.

It uses the [`release.json`](release.json) template and derives the version through [`git-version.sh`](git-version.sh).

UC Virtual Remote does not use this workflow. Its configurator is compiled from the committed source and bundled as an immutable application component. Installation on physical hardware is outside the scope of the UC Virtual Remote distribution and is not supported by Unfolded Circle ApS.

## `git-tag.py`

`git-tag.py` is an upstream release helper that creates Git tags and assembles a change summary from commits made since the previous release.

UC Virtual Remote releases are managed by the repository-level GitHub Actions workflows rather than by this script.

## `git-version.sh`

`git-version.sh` derives a SemVer-compatible version string from Git metadata. The upstream build process calls it through `git-semver`.

The archived 2.3.3 source can also read its version from `version.txt` when Git metadata is unavailable.

## `transform-license-checker.js`

`transform-license-checker.js` generates the third-party license overview displayed under **Settings → General → About → Licenses**.

The generated output is committed as [`public/licenses.md`](../public/licenses.md). Regeneration should take place whenever the dependency graph or bundled non-npm components change.

Run the generator from the `tools/` directory because its template and patch paths are relative to the current working directory:

```shell
cd tools
node transform-license-checker.js ../public/licenses.md
```

The script invokes `license-checker` from the repository root, where the dependency graph is installed.

```text
Usage: node transform-license-checker.js <output.md> [options]
  --include-dev            include devDependencies; runtime dependencies are the default
  --input <licenses.json>  transform an existing license-checker JSON file
  --app-license <mode>     select proprietary or gpl application notice
```

### Application notice

The generator detects the application-license mode from `package.json` unless `--app-license` is supplied. A value of `UNLICENSED` selects the upstream proprietary mode; other values select the GPL mode.

This archived GPL source tree includes only `templates/app-license-gpl.md`. The proprietary notice used by later proprietary source is intentionally not part of this archive. UC Virtual Remote therefore generates the license page in GPL mode.

### Dependency scope

Runtime dependencies are the default because the generated page describes the software included in the deployed application. `--include-dev` expands the report to the development dependency graph and adjusts the introductory text accordingly.

`--input` accepts a previously generated `license-checker --json` file. The selected dependency scope still needs to match the contents of that file.

### Missing license files

Some packages declare a license in `package.json` but do not include the corresponding text. The generator resolves those cases from the upstream repository and caches the result under [`patches/`](patches/).

Each patch directory contains:

- the recovered license text; and
- a `SOURCE.md` provenance record describing where the text came from.

The generator exits with a non-zero status when any dependency remains without license text. A release must not publish a silently incomplete attribution page.

Network access is only required when a package is new or has no committed patch. Normal regeneration is reproducible from the committed cache.

### Non-npm components

[`templates/licenses-footer.md`](templates/licenses-footer.md) records components that `license-checker` cannot discover, including bundled fonts such as Material Symbols Sharp.

That template is end-user-facing content and must remain aligned with the assets included in the production build. Maintainer-only explanations belong in this document rather than in the generated license page.

### Platform-specific dependencies

`license-checker` reports the dependency tree installed on the current platform, including platform-specific optional packages such as esbuild and Rollup binaries.

The committed patch set covers the macOS ARM64 and Linux x64 variants used by this project. Regeneration on another platform may introduce a different set of optional packages and require additional license patches.
