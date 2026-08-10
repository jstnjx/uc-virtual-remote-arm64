#!/usr/bin/env bash
# Host entrypoint for the visual-regression suite (npm run test:e2e:visual).
# docs/specs/007-simulator-based-testing.md phase 3.
#
# Brings up the simulator + pinned Playwright Linux runner, runs the suite, and
# tears the containers down. Any args are forwarded to `playwright test` inside
# the runner, so `npm run test:e2e:visual -- --update-snapshots` regenerates
# baselines. The node_modules cache volume is kept between runs; remove it with
# `docker compose -f docker/visual/docker-compose.yml down -v`.
#
# Apple Silicon: the `-linux` baselines are amd64 pixels (CI). Docker on arm64
# pulls the arm64 image by default, which anti-aliases fonts differently and
# mismatches every baseline (and `:update` would silently rewrite them into
# arm64 pixels that fail on CI). Run under emulation instead:
#   docker pull --platform linux/amd64 mcr.microsoft.com/playwright:v1.61.1-noble
#   docker compose -f docker/visual/docker-compose.yml down -v   # drop arm64 cache
#   DOCKER_DEFAULT_PLATFORM=linux/amd64 npm run test:e2e:visual[:update]
set -euo pipefail
cd "$(dirname "$0")/../.."

COMPOSE=(docker compose -f docker/visual/docker-compose.yml)

cleanup() {
  "${COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

export PW_ARGS="${*:-}"
"${COMPOSE[@]}" up --abort-on-container-exit --exit-code-from runner
