#!/usr/bin/env bash
# Completely remove UC Virtual Remote and the Docker containers it manages.
#
#   curl -fsSL https://raw.githubusercontent.com/jstnjx/uc-virtual-remote-arm64/main/uninstall.sh | sudo CONFIRM=1 bash
#
# Options (environment variables):
#   KEEP_DATA=1          preserve /var/lib/uc-virtual-remote-arm64
#   KEEP_IMAGES=1        preserve UC Virtual Remote and locally built integration images
#   CONFIRM=1            skip the confirmation prompt (required for piped execution)
set -Eeuo pipefail

PREFIX="${PREFIX:-/opt/uc-virtual-remote-arm64}"
DATA_DIR="${UCVR_HOST_DATA_DIR:-/var/lib/uc-virtual-remote-arm64}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
CONTAINER_NAME="${UCVR_CONTAINER_NAME:-uc-virtual-remote-arm64}"
KEEP_DATA="${KEEP_DATA:-0}"
KEEP_IMAGES="${KEEP_IMAGES:-0}"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    echo "This uninstaller must run as root or with sudo." >&2
    exit 1
  fi
fi

if [ -f "$PREFIX/.env" ]; then
  configured_data="$($SUDO awk -F= '$1 == "UCVR_HOST_DATA_DIR" { print substr($0, index($0, "=") + 1); exit }' "$PREFIX/.env" 2>/dev/null || true)"
  [ -z "$configured_data" ] || DATA_DIR="$configured_data"
fi

echo "This will PERMANENTLY remove:"
echo "  • main container:     $CONTAINER_NAME"
echo "  • install directory:  $PREFIX"
[ "$KEEP_DATA" = "1" ] || echo "  • data directory:     $DATA_DIR"
[ "$KEEP_DATA" = "1" ] || echo "  • native integrations and the internal Docker runtime"
[ "$KEEP_IMAGES" = "1" ] || echo "  • UC Virtual Remote and locally built ucvr/* images"
echo

if [ "${CONFIRM:-0}" != "1" ]; then
  if [ -r /dev/tty ]; then
    read -r -p "Continue? [y/N] " answer </dev/tty
    case "$answer" in
      y|Y|yes|YES) ;;
      *) echo "Aborted."; exit 1 ;;
    esac
  else
    echo "Refusing to remove data without confirmation. Re-run with CONFIRM=1." >&2
    exit 1
  fi
fi

if command -v docker >/dev/null 2>&1; then
  echo "==> Stopping UC Virtual Remote"
  if [ -f "$PREFIX/$COMPOSE_FILE" ]; then
    compose_args=(-f "$PREFIX/$COMPOSE_FILE")
    [ ! -f "$PREFIX/.env" ] || compose_args=(--env-file "$PREFIX/.env" "${compose_args[@]}")
    $SUDO docker compose "${compose_args[@]}" down --remove-orphans 2>/dev/null || true
  fi
  $SUDO docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

  if [ "$KEEP_IMAGES" != "1" ]; then
    echo "==> Removing UC Virtual Remote images"
    mapfile -t images < <($SUDO docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
      | grep -E '^(ghcr\.io/jstnjx/uc-virtual-remote-arm64|uc-virtual-remote-arm64)' \
      | sort -u || true)
    if [ "${#images[@]}" -gt 0 ]; then
      $SUDO docker rmi -f "${images[@]}" >/dev/null 2>&1 || true
    else
      echo "    none found"
    fi
  fi
else
  echo "==> Docker not found; skipping container and image cleanup"
fi

echo "==> Removing installation directory"
$SUDO rm -rf "$PREFIX"

if [ "$KEEP_DATA" != "1" ]; then
  echo "==> Removing persistent data"
  $SUDO rm -rf "$DATA_DIR"
fi

echo
if [ "$KEEP_DATA" = "1" ]; then
  echo "==> Done. UC Virtual Remote was removed; data was preserved at $DATA_DIR."
else
  echo "==> Done. UC Virtual Remote and its persistent data were removed."
fi
