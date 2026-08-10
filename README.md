# UC Virtual Remote

[![Build](https://github.com/jstnjx/uc-virtual-remote-arm64/actions/workflows/build.yml/badge.svg)](https://github.com/jstnjx/uc-virtual-remote-arm64/actions/workflows/build.yml)
[![Docker](https://github.com/jstnjx/uc-virtual-remote-arm64/actions/workflows/docker.yml/badge.svg)](https://github.com/jstnjx/uc-virtual-remote-arm64/actions/workflows/docker.yml)
[![Release](https://github.com/jstnjx/uc-virtual-remote-arm64/actions/workflows/release.yml/badge.svg)](https://github.com/jstnjx/uc-virtual-remote-arm64/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A compact multi-architecture virtual Unfolded Circle Remote appliance. The Remote Core, Web Configurator, normal ARM64 custom integrations, and Docker-based external integrations all live inside one top-level container.

> UC Virtual Remote is an independent community project. It is not affiliated with, endorsed by, operated by, or supported by Unfolded Circle ApS.

## Features

### One multi-architecture appliance container

- Multi-architecture image for ARM64 and AMD64 Linux hosts
- Core, Web Configurator and internal Docker run natively on the host architecture
- ARM64 UC integration binaries run directly on ARM64 and through bundled, process-scoped QEMU on AMD64
- Persistent Remote data and internal Docker state under one `/data` mount
- Host networking for local discovery, Wake-on-LAN, mDNS, and Integration API connectivity

### Normal Remote custom integrations

Use the same ARM64 `.tar.gz` packages intended for a physical Remote:

1. Open **Integrations**.
2. Select **Add new**.
3. Select **Install custom**.
4. Upload the normal `aarch64` integration archive.
5. Start setup from the integration card.

The runtime supports the standard package layout with:

```text
driver.json
bin/driver
config/            optional
version.txt        optional
```

Native integrations:

- run directly on ARM64; ARM64 ELF drivers use the bundled `qemu-aarch64-static` launcher on AMD64
- get their own persistent config and data directories
- are automatically supervised and restarted after unexpected exits
- use isolated Integration API ports from the shared integration port range
- preserve config/data when a newer tarball is uploaded with **Update** enabled
- participate in the normal reset-first, uninstall-second integration lifecycle
- expose their process output through the normal integration logs

### External integrations

The existing external-integration installer is retained, but Docker is now internal to the appliance.

The top-level container starts its own Docker daemon and external integrations are created inside it. No host `/var/run/docker.sock` mount is used.

Supported existing flows remain available:

- community integration registry
- GHCR images
- source repository builds
- start, stop, restart, reconnect, update, reset, and uninstall
- per-integration `/config` and `/data` persistence

Source builds happen in the internal Docker daemon for the host architecture. Prebuilt external images must provide a variant for that host architecture; on AMD64, an ARM64-only prebuilt image can fall back to a source build when the registry entry supports it.

### Virtual Remote Core

- Compatible Remote Core REST and WebSocket APIs
- Persistent entities, activities, macros, profiles, pages, groups, resources, and button mappings
- Remote 3-style configuration and state handling
- Media browsing, search, queue, and playback services
- Application credentials, logs, backups, software updates, and factory reset
- Virtual Dock, Bluetooth, Wi-Fi, and Remote Simulator support

### Web Configurator

- Bundled unofficial Web Configurator based on the published 2.3.3 source
- Full modified source included in the repository
- Material Symbols instead of Font Awesome
- Remote simulation directly inside the configurator
- Two-stage integration deletion: reset first, uninstall second
- Dismissible unofficial-build notice on login

## Requirements

The top-level container must run with `privileged: true` because it starts an internal Docker daemon and exposes the same hardware-management capabilities as UC Virtual Remote.

Required on the host:

- Linux
- Docker Engine
- Docker Compose v2
- Git and curl for the one-command installer

No host-wide ARM64 `binfmt_misc` handler is required. The AMD64 image contains its own scoped ARM64 userspace emulator for normal Remote integration binaries.

## Quick start

```bash
curl -fsSL https://raw.githubusercontent.com/jstnjx/uc-virtual-remote-arm64/main/install.sh | sudo bash
```

Open:

```text
Management:   http://HOST_IP:11090/
Configurator: http://HOST_IP:11090/configurator/
Core WS:      ws://HOST_IP:946/ws
```

For unattended installation:

```bash
curl -fsSL https://raw.githubusercontent.com/jstnjx/uc-virtual-remote-arm64/main/install.sh \
  | sudo UCVR_PIN=1234 TZ=Europe/Berlin bash
```

Configuration is stored in:

```text
/opt/uc-virtual-remote-arm64/.env
```

Persistent data defaults to:

```text
/var/lib/uc-virtual-remote-arm64
```

## Docker layout

```text
Linux host
└─ uc-virtual-remote-arm64           host-native, privileged, host network
   ├─ Virtual Remote Core
   ├─ Web Configurator
   ├─ native integration process A   uploaded Remote tarball
   ├─ native integration process B   uploaded Remote tarball
   └─ dockerd                         internal Docker daemon
      ├─ external integration A
      ├─ external integration B
      └─ source-built integration C
```

The only host persistence mount required by the application is `/data`. The internal Docker image/container store lives at `/data/docker`.

## Compose

```bash
docker compose pull
docker compose up -d --no-build
```

Build locally:

```bash
docker compose build
docker compose up -d --no-build
```

The Compose service uses the multi-architecture image and automatically selects the host-native `linux/arm64` or `linux/amd64` variant.

## Main configuration options

| Variable | Default | Purpose |
|---|---|---|
| `UCVR_REST_PORT` | `11090` | Management, configurator, and REST port |
| `UCVR_PIN` | `1234` with manual Compose | Four-digit Web Configurator PIN |
| `UCVR_NAME` | `Virtual Remote 3` | Remote display name |
| `UCVR_DATA_DIR` | `/data` | Persistent appliance data |
| `UCVR_INTEGRATION_PORT_START` | `11091` | First native/external integration port |
| `UCVR_DIND` | `true` | Start the internal Docker daemon |
| `UCVR_DIND_DATA_ROOT` | `/data/docker` | Internal Docker state |
| `UCVR_DIND_STORAGE_DRIVER` | `overlay2` | Internal Docker storage driver; automatically falls back to `vfs` if startup fails |
| `UCVR_GITHUB_TOKEN` | empty | Optional GitHub token for private repositories and updates |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |

## Native integration storage

```text
/data/native-integrations/
├─ packages/        installed tarball contents
├─ config/          UC_CONFIG_HOME per driver
├─ data/            UC_DATA_HOME / STATE_DIRECTORY per driver
├─ logs/            native driver logs
└─ state.json       installed package/runtime metadata
```

Native integration archives are validated before activation. Unsafe paths, symbolic links, special files, incompatible Core API requirements, and non-ARM64 ELF executables are rejected. Package replacement is atomic and a failed update rolls back to the previous installed package.

## Updating

Run the installer again:

```bash
curl -fsSL https://raw.githubusercontent.com/jstnjx/uc-virtual-remote-arm64/main/install.sh | sudo bash
```

Application updates are also available from **Settings → Software Update**.

Updating the appliance does not remove native integration packages, native integration configuration, or the internal Docker store.

## Web Configurator source and licensing

The bundled community Web Configurator is built from the published Unfolded Circle Web Configurator 2.3.3 source and is maintained separately from the MIT-licensed UC Virtual Remote backend.

- Modified source: [`web-configurator/`](web-configurator/)
- Build details: [WEB_CONFIGURATOR.md](WEB_CONFIGURATOR.md)
- Modifications: [`web-configurator/MODIFICATIONS.md`](web-configurator/MODIFICATIONS.md)
- Artwork attribution: [`web-configurator/ARTWORK.md`](web-configurator/ARTWORK.md)

The modified Web Configurator is GPL-3.0-only. Retained Unfolded Circle artwork is licensed under CC BY 4.0. Material Symbols are licensed under Apache-2.0.

## Development

Node.js 22.5 or newer is required for backend development.

```bash
npm ci
npm run ci
```

Build the committed Web Configurator source with:

```bash
npm run prepare:web-configurator
```

Validate both appliance image variants with Buildx:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t uc-virtual-remote-arm64:dev .
```

## Uninstall

Remove the application and persistent data, including installed native integrations and the internal Docker store:

```bash
curl -fsSL https://raw.githubusercontent.com/jstnjx/uc-virtual-remote-arm64/main/uninstall.sh \
  | sudo CONFIRM=1 bash
```

Keep all persistent appliance data:

```bash
curl -fsSL https://raw.githubusercontent.com/jstnjx/uc-virtual-remote-arm64/main/uninstall.sh \
  | sudo CONFIRM=1 KEEP_DATA=1 bash
```

## License

The UC Virtual Remote backend is released under the [MIT License](LICENSE).
