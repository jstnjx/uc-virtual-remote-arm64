# Web Configurator 2.3.3 — Unfolded.Tools community source

This directory contains the complete modified source for Web Configurator build `2.3.3-unfoldedtools.8`, which is bundled with UC Virtual Remote and used by the Unfolded.Tools Remote Simulator.

The source is based on the Web Configurator 2.3.3 snapshot published by Unfolded Circle ApS and remains licensed under `GPL-3.0-only`. The dated change record is available in [`MODIFICATIONS.md`](MODIFICATIONS.md), and artwork attribution is documented in [`ARTWORK.md`](ARTWORK.md).

No source or compiled configurator files in this directory were extracted from a physical Remote.

## Role in UC Virtual Remote

The repository root treats this directory as the canonical configurator source tree. The project build:

- installs the exact dependency graph from `package-lock.json`;
- compiles this source locally;
- validates required runtime, licensing, and artwork files;
- copies the compiled application to `web-configurator-build/`; and
- creates a deterministic corresponding-source archive in `web-configurator-source/`.

Installation and Docker builds do not download modified source or prebuilt configurator assets from unfolded.tools.

## Upstream source basis

Unfolded Circle published the 2.3.3 snapshot as an archived, read-only source release rather than as a maintained open-source project. The snapshot provides the source used for the 2.3.3 generation of the Web Configurator together with the material required to build, modify, and run it.

The published snapshot contains several deliberate differences from the Web Configurator bundle that shipped on physical devices:

- Font Awesome Pro was replaced with Font Awesome Free.
- The Settings license page and its translations were backported from a later development state.
- The translation set is newer than the one included in the original 2.3.3 device bundle.
- Internal tooling, internal CI configuration, and internal documentation were not included.

The Unfolded.Tools source tree applies the additional modifications described below and in [`MODIFICATIONS.md`](MODIFICATIONS.md).

## Community-build changes

### Icons

Font Awesome has been removed from both the dependency graph and runtime payload. Legacy icon identifiers are mapped to the locally hosted Material Symbols Sharp variable font. Thin, Light, and Regular icon variants use weights 100, 300, and 400 respectively; filled icons use weight 400 with the fill axis enabled.

### UC Virtual Remote integration

The modified application includes the API, WebSocket, session-path, and browser-storage behavior required by UC Virtual Remote and the hosted Remote Simulator.

Authenticated sessions open in the Home section. Remote simulation is available as a first-class **Remote** section in the primary navigation and uses the standard configurator page structure. Simulated physical buttons, activity mappings, remote-entity mappings, touch-slider commands, and button-backlight rendering are integrated into that section.

### Branding and artwork

Nonessential product branding was replaced with Unfolded.Tools project artwork. The retained and modified Unfolded Circle artwork inventory is documented in [`ARTWORK.md`](ARTWORK.md).

The dark Remote 3 front artwork uses transparent button symbols, allowing the simulator to render the configured RGB backlight color and brightness beneath them.

### Runtime packaging

The UC Virtual Remote distribution bundles the compiled configurator as an immutable component. The obsolete physical-Remote bundle capture, upload, replacement, and removal workflow is not part of the runtime.

## Build commands

Node.js 22 is required; the exact version family is recorded in `.nvmrc`.

From the UC Virtual Remote repository root, the canonical build command is:

```shell
npm run prepare:web-configurator
```

For direct development inside this directory:

```shell
npm ci
npm run dev
```

A generic production build can be created with:

```shell
BASE_URL=/configurator/ npm run build
```

The Material Symbols Sharp variable font is committed at `src/assets/fonts/material-symbols-sharp.woff2`; no CDN or external font download is required.

## Tests

The unit test suite is available through:

```shell
npm run test:unit
```

The upstream visual end-to-end baselines contain device-bundle branding, backgrounds, and Font Awesome output. Those baselines do not represent this community build and have not been adopted as release criteria for UC Virtual Remote.

The repository-level UC Virtual Remote CI validates the committed source metadata, required notices, artwork files, backend tests, and Docker build.

## Development without physical hardware

The retained simulator helpers can run the public Remote Core Simulator for direct frontend development:

```shell
npm run sim:up
npm run dev:sim
```

The default simulator PIN is `1234`.

UC Virtual Remote itself provides the target environment used by the bundled community build and does not require a physical Remote.

## Development with a physical Remote

Direct development against a physical Remote remains possible through the public Core API proxy configuration. Set `VITE_API_PROXY` in `env/.env.local` to the Remote address before starting the development server:

```env
VITE_API_PROXY=http://192.168.1.100
```

This workflow is separate from UC Virtual Remote. Modified configurator builds running on physical hardware are not supported by Unfolded Circle ApS.

## Hosted simulator session base

The hosted Unfolded.Tools build uses `BASE_URL=__UCVR_SESSION_BASE__/configurator/`. The server replaces the placeholder in text assets with the isolated path assigned to the active simulator session.

Self-hosted UC Virtual Remote installations use the regular `/configurator/` route.

## Licensing

| Component | License |
|---|---|
| Web Configurator source and Unfolded.Tools code changes | GPL-3.0-only — [`LICENSE`](LICENSE) |
| Retained and modified Unfolded Circle artwork | CC BY 4.0 — [`LICENSES/CC-BY-4.0.txt`](LICENSES/CC-BY-4.0.txt) |
| Material Symbols | Apache-2.0 |
| Other bundled fonts | SIL Open Font License; see `public/licenses.md` |
| npm dependencies | Individual licenses reproduced in `public/licenses.md` |

The artwork licenses do not grant trademark rights. “Unfolded Circle,” the Unfolded Circle logo, and Unfolded Circle product names remain trademarks of Unfolded Circle ApS.

This is an unofficial community build. It is not affiliated with, endorsed by, operated by, or supported by Unfolded Circle ApS.
