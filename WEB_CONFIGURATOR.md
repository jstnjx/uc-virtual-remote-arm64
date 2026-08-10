# Bundled community Web Configurator

UC Virtual Remote includes the unofficial Unfolded.Tools Web Configurator build `2.3.3-unfoldedtools.8`. The build is based on Unfolded Circle Web Configurator 2.3.3, the only source release published by Unfolded Circle ApS.

The complete modified source is stored in [`web-configurator/`](web-configurator/). It was not extracted from a physical Remote, and neither installation nor Docker builds download modified source or prebuilt configurator files from unfolded.tools.

## Project status

This configurator and UC Virtual Remote are independent community projects. They are not affiliated with, endorsed by, operated by, or supported by Unfolded Circle ApS.

The build reflects the published 2.3.3 source snapshot plus the modifications documented in this repository. It may differ from current or future proprietary official releases in features, appearance, translations, and behavior.

## Changes relative to the published 2.3.3 source

| Area | Implementation in the community build |
|---|---|
| Core compatibility | Added the API, WebSocket, storage, and session handling required by UC Virtual Remote and the hosted Remote Simulator. |
| Initial navigation | Authenticated sessions open in the Home section. |
| Remote simulation | Added a first-class **Remote** section to the primary navigation, using the standard configurator tools-and-content layout rather than a detached detail route. |
| Physical controls | Added simulated buttons, touch-slider commands, activity mappings, remote-entity mappings, and short/long-press behavior. |
| Button backlight | Added live rendering of configured RGB color and brightness through modified Remote 3 artwork with transparent button symbols. |
| Hardware-only features | Hidden, disabled, or replaced features that require physical Remote hardware with safe virtual behavior. |
| Icons | Removed Font Awesome from the dependency and runtime payload and replaced its icon mapping with the locally hosted Material Symbols Sharp variable font. |
| Branding and layout | Replaced nonessential product branding with Unfolded.Tools artwork and corrected the simulator login, navigation, and responsive layouts. |
| Runtime packaging | Removed the device-bundle capture and upload workflow and made the bundled configurator an immutable application component. |
| Source disclosure | Added modification, artwork, license, checksum, source-archive, and source-comparison material. |

A detailed file- and behavior-level record is maintained in [`web-configurator/MODIFICATIONS.md`](web-configurator/MODIFICATIONS.md).

## Build process

The project-level command:

```bash
npm run prepare:web-configurator
```

performs the following steps:

1. validates the committed source tree, package metadata, licensing notices, and required artwork;
2. installs the dependency versions locked in `web-configurator/package-lock.json`;
3. compiles the configurator from `web-configurator/`;
4. injects and validates the UC Virtual Remote simulator assets;
5. copies the runtime build to `web-configurator-build/`; and
6. generates a deterministic corresponding-source archive in `web-configurator-source/`.

The Dockerfile uses the same build script in a dedicated build stage. The final container image contains both the compiled runtime and its corresponding source archive.

A running instance serves the archive at:

```text
/web-configurator-source/web-configurator-2.3.3-unfoldedtools.8-source.tar.gz
```

## Runtime behavior

The bundled configurator is immutable at runtime. The compatibility endpoints report its installed version and source status, while upload, replacement, and removal requests return `405 IMMUTABLE_COMPONENT`.

No device-bundle capture, upload, or extraction workflow is required or supported.

## Artwork and licensing

The stock dark Remote 3 artwork and the three simulator derivatives remain licensed under CC BY 4.0. The simulator-specific files are:

- `web-configurator/public/images/remote-3-dark-front-backlight.webp`
- `web-configurator/public/images/remote-3-dark-front-backlight-min.webp`
- `web-configurator/public/images/remote-3-dark-backlight-mask.png`

Their modification details and the complete retained artwork inventory are documented in [`web-configurator/ARTWORK.md`](web-configurator/ARTWORK.md).

| Component | License |
|---|---|
| UC Virtual Remote backend | MIT |
| Modified Web Configurator | GPL-3.0-only |
| Retained and modified Unfolded Circle artwork | CC BY 4.0 |
| Material Symbols | Apache-2.0 |

The Web Configurator remains a GPL-3.0-only work. The MIT-licensed UC Virtual Remote backend is a separate application that communicates with it through HTTP and WebSocket APIs.
