#!/usr/bin/env bash
# Modified by Justin Jäger for the Unfolded.Tools Remote Simulator on 2026-08-03.
# GNU GPL v3.0 only; see MODIFICATIONS.md.
# Runs inside the pinned Playwright Linux image (docker/visual/docker-compose.yml).
# docs/specs/007-simulator-based-testing.md phase 3.
set -euo pipefail

# Linux-native install. Skip it when the cached node_modules volume already has
# this lockfile's deps (incl. the free-icon font); a stale volume is cleared with
# `docker compose -f docker/visual/docker-compose.yml down -v`.
if [ ! -x node_modules/.bin/vite ]; then
  echo "visual: installing linux dependencies (npm ci)…"
  npm ci --no-audit --no-fund
fi

# Material Symbols Sharp is committed under src/assets/fonts and needs no provisioning.

# The dev server (started by Playwright's webServer) proxies /api here.
export VITE_API_PROXY="http://sim:8080"

# Wait for the simulator to answer before handing off to Playwright, so the first
# test does not race the container's boot (FM-5).
echo "visual: waiting for the simulator…"
until curl -sf http://sim:8080/api/pub/version >/dev/null 2>&1; do
  sleep 0.5
done
echo "visual: simulator is up"

# shellcheck disable=SC2086
exec npx playwright test -c playwright.visual.config.ts ${PW_ARGS:-}
