#!/bin/bash
#
# Manage a Remote-Core Simulator container for local development and tests.
# https://github.com/unfoldedcircle/core-simulator
#
# Usage:
#   tools/simulator/sim.sh up      # pull the image, start it, wait until it answers
#   tools/simulator/sim.sh down    # stop and remove the container
#   tools/simulator/sim.sh reset   # recreate it: pristine device, no pull
#
# Environment overrides:
#   SIM_IMAGE  image reference     (default unfoldedcircle/core-simulator:latest)
#   SIM_PORT   host port           (default 8080)
#   SIM_MODEL  UCR3 | UCR2         (default UCR3)
#   SIM_NAME   container name      (default uc-sim)
#
# The container's state lives in /data, which is deliberately not mounted: every
# start is therefore a pristine device and "reset" is just a recreate.
# See docs/specs/007-simulator-based-testing.md
#

set -u
set -e

IMAGE="${SIM_IMAGE:-unfoldedcircle/core-simulator:latest}"
PORT="${SIM_PORT:-8080}"
MODEL="${SIM_MODEL:-UCR3}"
NAME="${SIM_NAME:-uc-sim}"

READY_URL="http://127.0.0.1:$PORT/api/pub/version"
READY_TIMEOUT=60

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker not found: install Docker to run the simulator" >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "cannot talk to the docker daemon: is it running, and may you use it?" >&2
    echo "  on Linux this is usually a missing 'docker' group membership" >&2
    exit 1
  fi
}

is_running() {
  [ -n "$(docker ps -q -f "name=^${NAME}$")" ]
}

remove() {
  if [ -n "$(docker ps -aq -f "name=^${NAME}$")" ]; then
    docker rm -f "$NAME" >/dev/null
  fi
}

# Poll instead of sleeping: boot is ~1s natively but slower under emulation on
# Apple Silicon, where the image only exists for linux/amd64.
wait_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS "$READY_URL" >/dev/null 2>&1; then
      return 0
    fi
    if ! is_running; then
      echo "simulator '$NAME' exited during startup" >&2
      docker logs "$NAME" 2>&1 | tail -20 >&2
      return 1
    fi
    sleep 0.2
  done
  echo "simulator did not answer on $READY_URL within ${READY_TIMEOUT}s" >&2
  docker logs "$NAME" 2>&1 | tail -20 >&2
  return 1
}

# The image tag floats (see spec 007, OQ-3), so the running core version is the
# only reliable record of what a test ran against. Always print it.
report() {
  echo "simulator ready on http://localhost:$PORT"
  echo "  $(curl -fsS "$READY_URL")"
  echo "  run the app against it: npm run dev:sim   (login PIN 1234)"
}

start() {
  docker run -d --rm \
    -p "$PORT:8080" \
    -e "UC_MODEL=$MODEL" \
    --name "$NAME" \
    "$IMAGE" >/dev/null
  wait_ready
  report
}

cmd_up() {
  require_docker
  if is_running; then
    echo "simulator '$NAME' is already running"
    wait_ready
    report
    return
  fi
  remove
  docker pull -q "$IMAGE" >/dev/null ||
    echo "warning: could not pull $IMAGE, using the local image" >&2
  start
}

# No pull here: reset is on the test hot path and must not depend on the network.
cmd_reset() {
  require_docker
  remove
  start
}

cmd_down() {
  require_docker
  remove
  echo "simulator '$NAME' removed"
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  reset) cmd_reset ;;
  *)
    echo "Usage: $0 up|down|reset" >&2
    exit 2
    ;;
esac
