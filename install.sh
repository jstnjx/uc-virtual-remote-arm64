#!/usr/bin/env bash
# One-command installer and updater for UC Virtual Remote.
#
#   curl -fsSL https://raw.githubusercontent.com/jstnjx/uc-virtual-remote-arm64/main/install.sh | sudo bash
#
# Pass options after "bash -s --", for example the newest main build:
#
#   curl -fsSL https://raw.githubusercontent.com/jstnjx/uc-virtual-remote-arm64/main/install.sh \
#     | sudo bash -s -- --channel edge
#
# Re-run the command at any time to update. The chosen channel and image are
# remembered in the installation's .env file. Run with --help for all options.
set -Eeuo pipefail

DEFAULT_IMAGE_REPOSITORY="ghcr.io/jstnjx/uc-virtual-remote-arm64"

PREFIX="${PREFIX:-/opt/uc-virtual-remote-arm64}"
DATA_DIR="${UCVR_HOST_DATA_DIR:-/var/lib/uc-virtual-remote-arm64}"
REPO_URL="${REPO_URL:-https://github.com/jstnjx/uc-virtual-remote-arm64.git}"
BRANCH="${BRANCH:-main}"
REF="${REF:-}"
CHANNEL="${UCVR_CHANNEL:-}"
VERSION_TAG="${UCVR_VERSION:-}"
IMAGE_OVERRIDE="${UCVR_IMAGE:-}"
IMAGE_REPOSITORY="${UCVR_IMAGE_REPOSITORY:-$DEFAULT_IMAGE_REPOSITORY}"
NO_CACHE="${NO_CACHE:-0}"
KEEP_APP_UPDATE="${KEEP_APP_UPDATE:-0}"
PRUNE="${PRUNE:-0}"
LOCAL_INSTALL="${LOCAL_INSTALL:-0}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
CONTAINER_NAME="${UCVR_CONTAINER_NAME:-uc-virtual-remote-arm64}"
REST_PORT="${UCVR_REST_PORT:-11090}"
REMOTE_NAME="${UCVR_NAME:-Virtual Remote 3}"
TIMEZONE="${TZ:-Europe/Berlin}"
LOG_LEVEL_VALUE="${LOG_LEVEL:-info}"
DEMO_INTERVAL_VALUE="${UCVR_DEMO_INTERVAL_MS:-5000}"

usage() {
  cat <<'USAGE'
Usage: install.sh [options]

Which build to run:
  --channel CHANNEL   stable  newest release image (:latest), the default
                      edge    newest main build (:edge image)
                      source  build the image locally from the checkout
  --edge              same as --channel edge
  --stable            same as --channel stable
  --build             same as --channel source
  --version VERSION   run a specific release, e.g. 0.16.0 (checks out tag
                      vVERSION and pulls that image tag)
  --branch NAME       check out this branch (default: main)
  --ref REF           check out a tag or commit; with the edge channel the
                      matching sha-<commit> image is pulled
  --image IMAGE       run this exact image reference
  --no-cache          build without the Docker layer cache (source builds)

Installation:
  --prefix DIR        install directory (default: /opt/uc-virtual-remote-arm64)
  --data-dir DIR      persistent data directory (default: /var/lib/uc-virtual-remote-arm64)
  --port PORT         management and REST port for a new installation
  --pin PIN           four-digit configurator PIN
  --name NAME         remote name for a new installation
  --tz ZONE           time zone for a new installation
  --local             install from the local checkout this script is in
  --keep-app-update   keep a software update installed from the Web
                      Configurator active instead of the installed image
  --prune             remove dangling UC Virtual Remote images afterwards
  -h, --help          show this help

Every option can also be given as an environment variable: UCVR_CHANNEL,
UCVR_VERSION, BRANCH, REF, UCVR_IMAGE, NO_CACHE=1, PREFIX, UCVR_HOST_DATA_DIR,
UCVR_REST_PORT, UCVR_PIN, UCVR_NAME, TZ, LOCAL_INSTALL=1, KEEP_APP_UPDATE=1,
PRUNE=1.
USAGE
}

option_value() {
  [ "$#" -ge 2 ] && [ -n "$2" ] || { echo "ERROR: $1 requires a value." >&2; exit 2; }
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --channel) option_value "$@"; CHANNEL="$2"; shift 2 ;;
    --channel=*) CHANNEL="${1#*=}"; shift ;;
    --edge|--latest|--nightly) CHANNEL="edge"; shift ;;
    --stable) CHANNEL="stable"; shift ;;
    --build|--source) CHANNEL="source"; shift ;;
    --version) option_value "$@"; VERSION_TAG="$2"; shift 2 ;;
    --version=*) VERSION_TAG="${1#*=}"; shift ;;
    --branch) option_value "$@"; BRANCH="$2"; shift 2 ;;
    --branch=*) BRANCH="${1#*=}"; shift ;;
    --ref) option_value "$@"; REF="$2"; shift 2 ;;
    --ref=*) REF="${1#*=}"; shift ;;
    --image) option_value "$@"; IMAGE_OVERRIDE="$2"; shift 2 ;;
    --image=*) IMAGE_OVERRIDE="${1#*=}"; shift ;;
    --no-cache) NO_CACHE=1; shift ;;
    --prefix) option_value "$@"; PREFIX="$2"; shift 2 ;;
    --prefix=*) PREFIX="${1#*=}"; shift ;;
    --data-dir) option_value "$@"; DATA_DIR="$2"; shift 2 ;;
    --data-dir=*) DATA_DIR="${1#*=}"; shift ;;
    --port) option_value "$@"; REST_PORT="$2"; shift 2 ;;
    --port=*) REST_PORT="${1#*=}"; shift ;;
    --pin) option_value "$@"; UCVR_PIN="$2"; shift 2 ;;
    --pin=*) UCVR_PIN="${1#*=}"; shift ;;
    --name) option_value "$@"; REMOTE_NAME="$2"; shift 2 ;;
    --name=*) REMOTE_NAME="${1#*=}"; shift ;;
    --tz) option_value "$@"; TIMEZONE="$2"; shift 2 ;;
    --tz=*) TIMEZONE="${1#*=}"; shift ;;
    --local) LOCAL_INSTALL=1; shift ;;
    --keep-app-update) KEEP_APP_UPDATE=1; shift ;;
    --prune) PRUNE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

ENV_FILE="$PREFIX/.env"
VERSION_TAG="${VERSION_TAG#v}"
# A release version checks out its tag, so the source matches the image.
if [ -n "$VERSION_TAG" ] && [ -z "$REF" ]; then REF="v$VERSION_TAG"; fi

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
  local target="$BRANCH"
  [ -n "$REF" ] && target="$REF"
  echo "==> Fetching $REPO_URL ($target) into $PREFIX"
  if [ ! -d "$PREFIX/.git" ]; then
    local saved_env=""
    if [ -f "$ENV_FILE" ]; then
      saved_env="$(mktemp)"
      $SUDO cp "$ENV_FILE" "$saved_env"
    fi
    $SUDO rm -rf "$PREFIX"
    $SUDO mkdir -p "$PREFIX"
    $SUDO git -C "$PREFIX" init -q
    $SUDO git -C "$PREFIX" remote add origin "$REPO_URL"
    if [ -n "$saved_env" ]; then
      $SUDO cp "$saved_env" "$ENV_FILE"
      rm -f "$saved_env"
    fi
  fi
  $SUDO git -C "$PREFIX" remote set-url origin "$REPO_URL"
  $SUDO git -C "$PREFIX" fetch --depth 1 --force origin "$target" \
    || fail "Could not fetch '$target' from $REPO_URL."
  $SUDO git -C "$PREFIX" reset -q --hard FETCH_HEAD
  $SUDO git -C "$PREFIX" clean -qfd -e .env
  echo "    Checked out $($SUDO git -C "$PREFIX" log -1 --format='%h %s')"
}

set_env_value() {
  local key="$1"
  local value="$2"
  if $SUDO grep -Eq "^[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null; then
    local escaped
    escaped="$(printf '%s' "$value" | sed -e 's/[\\/&|]/\\&/g')"
    $SUDO sed -i -E "s|^[[:space:]]*${key}=.*|${key}=${escaped}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" | $SUDO tee -a "$ENV_FILE" >/dev/null
  fi
}

# The in-app Software Update installs releases into the data directory, and
# the launcher prefers them over the code in the image. When the installer
# deploys a build, an older in-app update would otherwise keep running.
deactivate_app_update() {
  local active="$DATA_DIR/application/active.json"
  $SUDO test -f "$active" || return 0
  if [ "$KEEP_APP_UPDATE" = "1" ]; then
    echo "==> Keeping the software update installed from the Web Configurator (--keep-app-update)"
    return 0
  fi
  local backup
  backup="$active.disabled-$(date +%Y%m%d%H%M%S)"
  $SUDO mv "$active" "$backup"
  echo "==> Deactivated the software update installed from the Web Configurator so the new image runs"
  echo "    (saved as $backup; use --keep-app-update to keep it active)"
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

if [ "$LOCAL_INSTALL" = "1" ]; then
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

# Resolve the channel and image. Explicit options win, then the values saved
# by an earlier run, then the defaults.
[ -n "$CHANNEL" ] || CHANNEL="$(read_env_value UCVR_CHANNEL)"
if [ -n "$VERSION_TAG" ] && [ -z "$CHANNEL" ]; then CHANNEL="stable"; fi
CHANNEL="${CHANNEL:-stable}"
case "$CHANNEL" in
  stable|edge|source) ;;
  *) fail "Unknown channel '$CHANNEL'. Use stable, edge or source." ;;
esac

if [ -n "$IMAGE_OVERRIDE" ]; then
  IMAGE="$IMAGE_OVERRIDE"
elif [ "$CHANNEL" = "source" ]; then
  IMAGE="uc-virtual-remote-arm64:local"
elif [ -n "$VERSION_TAG" ]; then
  IMAGE="$IMAGE_REPOSITORY:$VERSION_TAG"
elif [ "$CHANNEL" = "edge" ] && [ -n "$REF" ] && [ -d "$PREFIX/.git" ]; then
  IMAGE="$IMAGE_REPOSITORY:sha-$($SUDO git -C "$PREFIX" rev-parse --short=7 HEAD)"
elif [ "$CHANNEL" = "edge" ]; then
  IMAGE="$IMAGE_REPOSITORY:edge"
else
  IMAGE="$IMAGE_REPOSITORY:latest"
fi

# The channel is remembered for later runs. A version, ref or image applies to
# this run only: the image is resolved again on every run, so a later run
# without those options follows the channel. UCVR_IMAGE in .env lets plain
# "docker compose" commands use the image this run deployed.
set_env_value "UCVR_CHANNEL" "$CHANNEL"
set_env_value "UCVR_IMAGE" "$IMAGE"
export UCVR_IMAGE="$IMAGE"

build_image() {
  local args=(build --pull)
  [ "$NO_CACHE" = "1" ] && args+=(--no-cache)
  compose "${args[@]}" virtual-remote
}

echo "==> Channel: $CHANNEL, image: $IMAGE"
if [ "$CHANNEL" = "source" ]; then
  echo "==> Building the UC Virtual Remote image from the checked-out source"
  build_image
else
  echo "==> Pulling the UC Virtual Remote container image"
  if ! compose pull virtual-remote; then
    echo "    Image pull failed; building from the checked-out source instead."
    build_image
  fi
fi

deactivate_app_update

echo "==> Starting UC Virtual Remote"
compose up -d --no-build --force-recreate --remove-orphans virtual-remote

if [ "$PRUNE" = "1" ]; then
  echo "==> Removing dangling images"
  $SUDO docker image prune -f >/dev/null || true
fi

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
IMAGE_INFO="$($SUDO docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE" 2>/dev/null || true)"
echo "    Image:        $IMAGE${IMAGE_INFO:+ ($IMAGE_INFO)}"
echo "    Channel:      $CHANNEL"
echo "    Install dir:  $PREFIX"
echo "    Data dir:     $DATA_DIR"
echo "    Configuration: $ENV_FILE"
echo "    Configurator PIN: configured (4 digits)"
echo "    Logs:         cd $PREFIX && ${SUDO:+sudo }docker compose --env-file .env logs -f virtual-remote"
echo "    Update:       rerun the same curl command (add '| sudo bash -s -- --help' for options),"
echo "                  or use Software Update in the Web Configurator."
