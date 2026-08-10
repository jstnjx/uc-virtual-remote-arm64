#!/bin/sh
set -eu

DATA_DIR="${UCVR_DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"

if [ "$(id -u)" = "0" ]; then
  if ! chown -R node:node "$DATA_DIR"; then
    echo "UC Virtual Remote: unable to set ownership on data directory: $DATA_DIR" >&2
    echo "Ensure the bind mount supports chown, or pre-create it with UID/GID 1000." >&2
    exit 1
  fi

  # Managing Docker containers and host radio adapters requires access to the
  # host Docker socket and system D-Bus. The recommended v0.8 deployment keeps
  # the core process as root inside this dedicated management container.
  if [ "${UCVR_RUN_AS_ROOT:-false}" = "true" ]; then
    exec "$@"
  fi

  if [ -S /var/run/docker.sock ]; then
    DOCKER_GID="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)"
    if [ -n "$DOCKER_GID" ]; then
      groupadd -g "$DOCKER_GID" ucvr-docker 2>/dev/null || true
      usermod -aG "$DOCKER_GID" node 2>/dev/null || true
    fi
  fi
  exec gosu node "$@"
fi

if [ ! -w "$DATA_DIR" ]; then
  echo "UC Virtual Remote: data directory is not writable: $DATA_DIR" >&2
  exit 1
fi
exec "$@"
