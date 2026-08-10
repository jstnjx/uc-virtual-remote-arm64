#!/usr/bin/env bash
# One-command installer for UC Virtual Remote.
#
#   curl -fsSL https://raw.githubusercontent.com/jstnjx/uc-virtual-remote-arm64/main/install.sh | sudo bash
#
# Re-run the command at any time to update the checkout and container image.
# Set LOCAL_INSTALL=1 to install from the current local checkout instead.
set -Eeuo pipefail

PREFIX="${PREFIX:-/opt/uc-virtual-remote-arm64}"
DATA_DIR="${UCVR_HOST_DATA_DIR:-/var/lib/uc-virtual-remote-arm64}"
REPO_URL="${REPO_URL:-https://github.com/jstnjx/uc-virtual-remote-arm64.git}"
BRANCH="${BRANCH:-main}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
CONTAINER_NAME="${UCVR_CONTAINER_NAME:-uc-virtual-remote-arm64}"
REST_PORT="${UCVR_REST_PORT:-11090}"
REMOTE_NAME="${UCVR_NAME:-Virtual Remote 3}"
TIMEZONE="${TZ:-Europe/Berlin}"
LOG_LEVEL_VALUE="${LOG_LEVEL:-info}"
DEMO_INTERVAL_VALUE="${UCVR_DEMO_INTERVAL_MS:-5000}"
ENV_FILE="$PREFIX/.env"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    echo "This installer must run as root or with sudo." >&2
    exit 1
  fi
fi

need() { command -v "$1" >/dev/null 2>&1; }
compose() { $SUDO docker compose --env-file "$ENV_FILE" -f "$PREFIX/$COMPOSE_FILE" "$@"; }

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

valid_pin() {
  [[ "$1" =~ ^[0-9]{4}$ ]]
}

request_pin() {
  local pin="${UCVR_PIN:-}"
  local confirmation=""

  if [ -n "$pin" ]; then
    valid_pin "$pin" || fail "UCVR_PIN must contain exactly four digits."
    printf '%s' "$pin"
    return
  fi

  if [ ! -r /dev/tty ] || [ ! -w /dev/tty ]; then
    fail "A four-digit configurator PIN is required. Re-run with UCVR_PIN=1234 when no interactive terminal is available."
  fi

  while true; do
    read -r -s -p "Enter a 4-digit configurator PIN: " pin </dev/tty
    printf '\n' >/dev/tty
    if ! valid_pin "$pin"; then
      echo "PIN must contain exactly four digits." >/dev/tty
      continue
    fi

    read -r -s -p "Confirm the 4-digit PIN: " confirmation </dev/tty
    printf '\n' >/dev/tty
    if [ "$pin" != "$confirmation" ]; then
      echo "PINs do not match. Try again." >/dev/tty
      continue
    fi

    printf '%s' "$pin"
    return
  done
}

read_env_value() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  $SUDO awk -F= -v key="$key" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      value = substr($0, index($0, "=") + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      gsub(/^"|"$/, "", value)
      print value
      exit
    }
  ' "$ENV_FILE"
}

append_env_if_missing() {
  local key="$1"
  local value="$2"
  if ! $SUDO grep -Eq "^[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null; then
    printf '%s=%s\n' "$key" "$value" | $SUDO tee -a "$ENV_FILE" >/dev/null
  fi
}

install_local_checkout() {
  local source_dir
  source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  [ -f "$source_dir/package.json" ] || fail "LOCAL_INSTALL=1 requires running install.sh from the project checkout."

  echo "==> Installing local checkout from $source_dir"
  local saved_env=""
  if [ -f "$ENV_FILE" ]; then
    saved_env="$(mktemp)"
    $SUDO cp "$ENV_FILE" "$saved_env"
  fi

  $SUDO mkdir -p "$PREFIX"
  (
    cd "$source_dir"
    tar --exclude='.git' --exclude='.env' --exclude='./data' -cf - .
  ) | ($SUDO tar -xf - -C "$PREFIX")

  if [ -n "$saved_env" ]; then
    $SUDO cp "$saved_env" "$ENV_FILE"
    rm -f "$saved_env"
  fi
}

fetch_checkout() {
  echo "==> Fetching $REPO_URL ($BRANCH) into $PREFIX"
  if [ -d "$PREFIX/.git" ]; then
    $SUDO git -C "$PREFIX" remote set-url origin "$REPO_URL"
    $SUDO git -C "$PREFIX" fetch --depth 1 origin "$BRANCH"
    $SUDO git -C "$PREFIX" reset --hard FETCH_HEAD
    return
  fi

  local saved_env=""
  if [ -f "$ENV_FILE" ]; then
    saved_env="$(mktemp)"
    $SUDO cp "$ENV_FILE" "$saved_env"
  fi

  $SUDO rm -rf "$PREFIX"
  $SUDO git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$PREFIX"

  if [ -n "$saved_env" ]; then
    $SUDO cp "$saved_env" "$ENV_FILE"
    rm -f "$saved_env"
  fi
}

echo "==> Checking dependencies"
MISSING=""
for dependency in docker git curl; do
  need "$dependency" || MISSING="$MISSING $dependency"
done
if [ -n "$MISSING" ]; then
  echo "Missing required commands:$MISSING" >&2
  echo "Install Git and curl through your distribution package manager." >&2
  echo "Install Docker Engine and the Compose plugin from https://docs.docker.com/engine/install/" >&2
  exit 1
fi

$SUDO docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required (the 'docker compose' command)."
$SUDO docker info >/dev/null 2>&1 || fail "Docker is installed but the daemon is unavailable. Start Docker and rerun the installer."

if [ "${LOCAL_INSTALL:-0}" = "1" ]; then
  install_local_checkout
else
  fetch_checkout
fi

[ -f "$PREFIX/$COMPOSE_FILE" ] || fail "Compose file not found: $PREFIX/$COMPOSE_FILE"

$SUDO mkdir -p "$DATA_DIR"
$SUDO chmod 0755 "$DATA_DIR"

if [ ! -f "$ENV_FILE" ]; then
  PIN_VALUE="$(request_pin)"

  $SUDO tee "$ENV_FILE" >/dev/null <<ENV
TZ=$TIMEZONE
UCVR_REST_PORT=$REST_PORT
UCVR_NAME=$REMOTE_NAME
UCVR_PIN=$PIN_VALUE
UCVR_HOST_DATA_DIR=$DATA_DIR
UCVR_CORE_TOKEN=${UCVR_CORE_TOKEN:-}
UCVR_ADMIN_TOKEN=${UCVR_ADMIN_TOKEN:-}
UCVR_UPDATE_REPOSITORY=${UCVR_UPDATE_REPOSITORY:-jstnjx/uc-virtual-remote-arm64}
UCVR_UPDATE_BRANCH=${UCVR_UPDATE_BRANCH:-main}
UCVR_GITHUB_TOKEN=${UCVR_GITHUB_TOKEN:-}
UCVR_INTEGRATION_REGISTRY_URLS=${UCVR_INTEGRATION_REGISTRY_URLS:-}
UCVR_INTEGRATION_REGISTRY_URL=${UCVR_INTEGRATION_REGISTRY_URL:-https://raw.githubusercontent.com/JackJPowell/uc-intg-list/refs/heads/main/registry.json}
UCVR_INTEGRATION_PORT_START=${UCVR_INTEGRATION_PORT_START:-11091}
UCVR_DEMO_INTERVAL_MS=$DEMO_INTERVAL_VALUE
LOG_LEVEL=$LOG_LEVEL_VALUE
ENV
else
  append_env_if_missing "TZ" "$TIMEZONE"
  append_env_if_missing "UCVR_REST_PORT" "$REST_PORT"
  append_env_if_missing "UCVR_NAME" "$REMOTE_NAME"
  PIN_VALUE="$(read_env_value UCVR_PIN)"
  if ! valid_pin "$PIN_VALUE"; then
    echo "==> Existing configuration has no valid four-digit PIN; a replacement is required."
    PIN_VALUE="$(request_pin)"
    if $SUDO grep -Eq '^[[:space:]]*UCVR_PIN=' "$ENV_FILE"; then
      $SUDO sed -i -E "s/^[[:space:]]*UCVR_PIN=.*/UCVR_PIN=$PIN_VALUE/" "$ENV_FILE"
    else
      printf 'UCVR_PIN=%s\n' "$PIN_VALUE" | $SUDO tee -a "$ENV_FILE" >/dev/null
    fi
  fi
  append_env_if_missing "UCVR_HOST_DATA_DIR" "$DATA_DIR"
  append_env_if_missing "UCVR_DEMO_INTERVAL_MS" "$DEMO_INTERVAL_VALUE"
  append_env_if_missing "LOG_LEVEL" "$LOG_LEVEL_VALUE"
fi
$SUDO chmod 0600 "$ENV_FILE"

# Use the value preserved in .env for status output and health checks.
REST_PORT="$(read_env_value UCVR_REST_PORT)"
REST_PORT="${REST_PORT:-11090}"
PIN_VALUE="$(read_env_value UCVR_PIN)"

echo "==> Pulling the UC Virtual Remote container image"
if ! compose pull virtual-remote; then
  echo "    Image pull failed; building from the checked-out source instead."
  compose build virtual-remote
fi

echo "==> Starting UC Virtual Remote"
compose up -d --no-build --remove-orphans virtual-remote

printf '==> Waiting for the management interface'
READY=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${REST_PORT}/" >/dev/null 2>&1; then
    READY=1
    break
  fi
  printf '.'
  sleep 2
done
printf '\n'

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST="${IP:-localhost}"

echo
if [ "$READY" = "1" ]; then
  echo "==> Done. UC Virtual Remote is running."
else
  echo "==> Installation completed, but the management interface did not answer yet."
  echo "    Check the container logs with the command below."
fi
echo "    Management:   http://$HOST:$REST_PORT/"
echo "    Configurator: http://$HOST:$REST_PORT/configurator/"
echo "    Install dir:  $PREFIX"
echo "    Data dir:     $DATA_DIR"
echo "    Configuration: $ENV_FILE"
echo "    Configurator PIN: configured (4 digits)"
echo "    Logs:         cd $PREFIX && ${SUDO:+sudo }docker compose --env-file .env logs -f virtual-remote"
echo "    Update:       rerun the same curl command, or use Software Update in the Web Configurator."
