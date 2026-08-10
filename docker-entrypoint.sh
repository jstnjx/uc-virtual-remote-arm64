#!/bin/sh
set -eu

DATA_DIR="${UCVR_DATA_DIR:-/data}"
DIND_ENABLED="${UCVR_DIND:-true}"
DIND_DATA_ROOT="${UCVR_DIND_DATA_ROOT:-$DATA_DIR/docker}"
DIND_STORAGE_DRIVER="${UCVR_DIND_STORAGE_DRIVER:-overlay2}"
DOCKER_SOCKET="/var/run/docker.sock"
DOCKER_PIDFILE="/var/run/docker.pid"
DOCKER_LOG="${UCVR_DIND_LOG:-$DATA_DIR/logs/dockerd.log}"
DOCKERD_PID=""
APP_PID=""

mkdir -p "$DATA_DIR" "$DATA_DIR/logs"

require_dind_namespace_access() {
  if command -v unshare >/dev/null 2>&1 && unshare --mount /bin/true >/dev/null 2>&1; then
    return 0
  fi

  echo "UC Virtual Remote: internal Docker cannot create mount namespaces in this container." >&2
  echo "UC Virtual Remote: registry/external integrations require the top-level container to run fully privileged." >&2
  echo "UC Virtual Remote: Home Assistant users must disable Protection mode for this add-on before starting it; full_access is only effective for unprotected add-ons." >&2
  echo "UC Virtual Remote: standalone Docker users must start the appliance with --privileged." >&2
  exit 1
}

wait_for_docker() {
  timeout="${1:-45}"
  elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    if [ -n "$DOCKERD_PID" ] && ! kill -0 "$DOCKERD_PID" 2>/dev/null; then
      return 1
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

launch_dockerd() {
  driver="$1"
  rm -f "$DOCKER_SOCKET" "$DOCKER_PIDFILE"
  dockerd \
    --host="unix://$DOCKER_SOCKET" \
    --data-root="$DIND_DATA_ROOT" \
    --exec-root=/var/run/docker \
    --pidfile="$DOCKER_PIDFILE" \
    --storage-driver="$driver" \
    --bridge=none \
    --iptables=false \
    --ip6tables=false \
    --ip-forward=false \
    --ip-masq=false \
    >>"$DOCKER_LOG" 2>&1 &
  DOCKERD_PID=$!
}

start_dockerd() {
  [ "$DIND_ENABLED" = "true" ] || [ "$DIND_ENABLED" = "1" ] || return 0
  if [ "$(id -u)" != "0" ]; then
    echo "UC Virtual Remote ARM64: internal Docker requires the top-level container to run as root." >&2
    exit 1
  fi

  require_dind_namespace_access
  mkdir -p "$DIND_DATA_ROOT" /var/run/docker
  export DOCKER_HOST="unix://$DOCKER_SOCKET"

  echo "UC Virtual Remote ARM64: starting internal Docker daemon ($DIND_STORAGE_DRIVER)"
  launch_dockerd "$DIND_STORAGE_DRIVER"
  if wait_for_docker 45; then
    echo "UC Virtual Remote ARM64: internal Docker daemon is ready"
    return 0
  fi

  if [ "$DIND_STORAGE_DRIVER" != "vfs" ]; then
    echo "UC Virtual Remote ARM64: $DIND_STORAGE_DRIVER failed, retrying internal Docker with vfs" >&2
    kill "$DOCKERD_PID" 2>/dev/null || true
    wait "$DOCKERD_PID" 2>/dev/null || true
    launch_dockerd vfs
    if wait_for_docker 45; then
      echo "UC Virtual Remote ARM64: internal Docker daemon is ready with vfs"
      return 0
    fi
  fi

  echo "UC Virtual Remote ARM64: internal Docker daemon failed to start. Last log lines:" >&2
  tail -n 80 "$DOCKER_LOG" >&2 2>/dev/null || true
  exit 1
}

stop_dockerd() {
  [ -n "$DOCKERD_PID" ] || return 0
  kill -TERM "$DOCKERD_PID" 2>/dev/null || return 0
  elapsed=0
  while kill -0 "$DOCKERD_PID" 2>/dev/null && [ "$elapsed" -lt 20 ]; do
    sleep 1
    elapsed=$((elapsed + 1))
  done
  if kill -0 "$DOCKERD_PID" 2>/dev/null; then
    echo "UC Virtual Remote ARM64: internal Docker did not stop in time; forcing shutdown" >&2
    kill -KILL "$DOCKERD_PID" 2>/dev/null || true
  fi
  wait "$DOCKERD_PID" 2>/dev/null || true
  DOCKERD_PID=""
}

run_appliance() {
  start_dockerd

  forward_term() {
    [ -z "$APP_PID" ] || kill -TERM "$APP_PID" 2>/dev/null || true
  }
  forward_int() {
    [ -z "$APP_PID" ] || kill -INT "$APP_PID" 2>/dev/null || true
  }
  trap forward_term TERM
  trap forward_int INT

  "$@" &
  APP_PID=$!
  if wait "$APP_PID"; then
    status=0
  else
    status=$?
  fi
  APP_PID=""
  trap - TERM INT
  stop_dockerd
  return "$status"
}

if [ "$(id -u)" = "0" ]; then
  # This appliance deliberately runs privileged/root: native ARM64 integration
  # executables and the internal Docker daemon are supervised in this container.
  # Do not recursively chown /data in this mode: /data/docker is dockerd's own
  # persistent graph and can be large or contain ownership-sensitive files.
  if [ "${UCVR_RUN_AS_ROOT:-true}" = "true" ]; then
    run_appliance "$@"
    exit $?
  fi

  # Non-appliance mode is kept for development without DinD. Only then does the
  # Node process drop privileges and require ownership of the application data.
  if [ "$DIND_ENABLED" = "true" ] || [ "$DIND_ENABLED" = "1" ]; then
    echo "UC Virtual Remote ARM64: UCVR_RUN_AS_ROOT=false requires UCVR_DIND=false." >&2
    exit 1
  fi
  if ! chown -R node:node "$DATA_DIR"; then
    echo "UC Virtual Remote ARM64: unable to set ownership on data directory: $DATA_DIR" >&2
    echo "Ensure the bind mount supports chown, or pre-create it with UID/GID 1000." >&2
    exit 1
  fi
  exec gosu node "$@"
fi

if [ ! -w "$DATA_DIR" ]; then
  echo "UC Virtual Remote ARM64: data directory is not writable: $DATA_DIR" >&2
  exit 1
fi
exec "$@"
