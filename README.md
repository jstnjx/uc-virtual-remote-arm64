# UC Virtual Remote

[![Build](https://github.com/jstnjx/uc-virtual-remote/actions/workflows/build.yml/badge.svg)](https://github.com/jstnjx/uc-virtual-remote/actions/workflows/build.yml)
[![Docker](https://github.com/jstnjx/uc-virtual-remote/actions/workflows/docker.yml/badge.svg)](https://github.com/jstnjx/uc-virtual-remote/actions/workflows/docker.yml)
[![Release](https://github.com/jstnjx/uc-virtual-remote/actions/workflows/release.yml/badge.svg)](https://github.com/jstnjx/uc-virtual-remote/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A self-hosted virtual Unfolded Circle Remote Core for running integrations, configuring a Remote, building automations, testing integrations, and using the Web Configurator without requiring a physical Remote to stay online.

> UC Virtual Remote is an independent community project. It is not affiliated with, endorsed by, operated by, or supported by Unfolded Circle ApS.

## Features

### Virtual Remote Core

- Compatible Remote Core REST and WebSocket APIs
- Persistent entities, activities, macros, profiles, pages, groups, resources, and button mappings
- Remote 3-style configuration and state handling
- Media browsing, search, queue, and playback services
- Application credentials, logs, backups, software updates, and factory reset

### Web Configurator

- Bundled unofficial Web Configurator based on the published 2.3.3 source
- Full modified source included in the repository
- Remote simulation directly inside the configurator
- Activities, macros, profiles, UI pages, button mappings, entities, Docks, and settings
- Managed integration updates from the integration screen
- Two-stage integration removal: reset first, uninstall second
- Dismissible unofficial-build notice on the login screen

### External integrations

- Run Unfolded Circle external integrations as Docker containers
- Install integrations from registry entries, GHCR images, or source repositories
- Automatic source builds for supported projects when no ready-made image is available
- Native integration setup and reconfiguration flows
- Start, stop, restart, reconnect, update, reset, and uninstall managed integrations
- Persistent per-integration configuration and data

### Backup and restore

- Import standard Remote `.backup` archives
- Restore entities, activities, macros, profiles, pages, resources, and configuration
- Keep UC Virtual Remote data persistent across upgrades

### Virtual Dock and hardware services

- Virtual Dock API and configuration
- Bluetooth controller management through BlueZ
- Wi-Fi scanning and connection through NetworkManager
- Hardware and service logging for development and diagnostics

### Development and testing

- Built-in demo integration and demo profile
- REST and WebSocket APIs for integration development
- Remote simulator for testing UI and entity behavior
- Node.js test suite and Docker validation in CI
- Docker images for `linux/amd64` and `linux/arm64`

## Quick start

A Linux host with Docker Engine, Docker Compose v2, Git, and curl is required.

```bash
curl -fsSL https://raw.githubusercontent.com/jstnjx/uc-virtual-remote/main/install.sh | sudo bash
```

The installer asks for a four-digit Web Configurator PIN and starts UC Virtual Remote with persistent storage.

Open:

```text
Management:   http://HOST_IP:11090/
Configurator: http://HOST_IP:11090/configurator/
Core WS:      ws://HOST_IP:946/ws
```

For unattended installation:

```bash
curl -fsSL https://raw.githubusercontent.com/jstnjx/uc-virtual-remote/main/install.sh \
  | sudo UCVR_PIN=1234 TZ=Europe/Berlin bash
```

Configuration is stored in:

```text
/opt/uc-virtual-remote/.env
```

## Updating

Run the installer again:

```bash
curl -fsSL https://raw.githubusercontent.com/jstnjx/uc-virtual-remote/main/install.sh | sudo bash
```

Existing configuration and persistent data are retained.

Updates are also available from **Settings → Software Update** in the Web Configurator.

## Docker

Use the published image through the included Compose configuration:

```bash
docker compose pull
docker compose up -d --no-build
```

Or build locally:

```bash
docker compose up -d --build
```

The default deployment uses host networking for reliable local integration discovery and managed-container connectivity.

## Main configuration options

| Variable | Default | Purpose |
|---|---|---|
| `UCVR_REST_PORT` | `11090` | Management, configurator, and REST port |
| `UCVR_PIN` | `1234` with manual Compose | Four-digit Web Configurator PIN |
| `UCVR_NAME` | `Virtual Remote 3` | Remote display name |
| `UCVR_DATA_DIR` | `/data` | Persistent data directory |
| `UCVR_ADMIN_TOKEN` | empty | Optional management bearer token |
| `UCVR_CORE_TOKEN` | empty | Optional fixed Core WebSocket token |
| `UCVR_INTEGRATION_PORT_START` | `11091` | First managed integration port |
| `UCVR_GITHUB_TOKEN` | empty | Optional GitHub token for private repositories and updates |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |

The Core WebSocket listener uses port `946`.

## Web Configurator source and licensing

The bundled community Web Configurator is built from the published Unfolded Circle Web Configurator 2.3.3 source and is maintained separately from the MIT-licensed UC Virtual Remote backend.

- Modified source: [`web-configurator/`](web-configurator/)
- Build details: [WEB_CONFIGURATOR.md](WEB_CONFIGURATOR.md)
- Modifications: [`web-configurator/MODIFICATIONS.md`](web-configurator/MODIFICATIONS.md)
- Artwork attribution: [`web-configurator/ARTWORK.md`](web-configurator/ARTWORK.md)

The modified Web Configurator is GPL-3.0-only. Retained Unfolded Circle artwork is licensed under CC BY 4.0. Material Symbols are licensed under Apache-2.0.

## Development

Node.js 22.5 or newer is required.

```bash
npm ci
npm run ci
npm run dev
```

Build the committed Web Configurator source with:

```bash
npm run prepare:web-configurator
```

## Uninstall

Remove the application and persistent data:

```bash
curl -fsSL https://raw.githubusercontent.com/jstnjx/uc-virtual-remote/main/uninstall.sh | sudo CONFIRM=1 bash
```

Keep persistent data:

```bash
curl -fsSL https://raw.githubusercontent.com/jstnjx/uc-virtual-remote/main/uninstall.sh \
  | sudo CONFIRM=1 KEEP_DATA=1 bash
```

## License

The UC Virtual Remote backend is released under the [MIT License](LICENSE).
