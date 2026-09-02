#!/usr/bin/env bash
#
# dev-stack.sh - manage the Azure emulators + dev container via docker compose.
#
#   dev-stack.sh up      build & start the whole compose stack (recommended)
#   dev-stack.sh down    stop the emulators and the dev container
#   dev-stack.sh status  show container status
#   dev-stack.sh logs    follow the dev container logs
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE="docker compose -f "$ROOT/.devcontainer/docker-compose.yml""

case "${1:-up}" in
  up)     $COMPOSE up -d --build ;;
  down)   $COMPOSE down ;;
  status) $COMPOSE ps ;;
  logs)   $COMPOSE logs -f dev ;;
  *) echo "usage: dev-stack.sh [up|down|status|logs]"; exit 2 ;;
esac