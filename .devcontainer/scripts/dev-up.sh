#!/usr/bin/env bash
#
# dev-up.sh - start the full local development stack INSIDE the dev container.
#
#   dev-up.sh            start backend + notif-ingester + frontend (background)
#   dev-up.sh --logs     start the same but follow the combined logs (foreground)
#   dev-up.sh --backend  only start the backend
#   dev-up.sh --ingester only start the notif-ingester
#   dev-up.sh --frontend only start the frontend
#   dev-up.sh --down     stop everything
#   dev-up.sh --status   print what is currently running
#
# The Azure emulators (Cosmos, Azurite, SignalR) are Docker services managed by
# compose; they must be up already (see compose up). This script only manages the
# three application processes.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

LOGDIR="$ROOT/.devcontainer/logs"
mkdir -p "$LOGDIR"

PIDFILE_BACKEND="$LOGDIR/backend.pid"
PIDFILE_INGESTER="$LOGDIR/ingester.pid"
PIDFILE_FRONTEND="$LOGDIR/frontend.pid"

RUN_BACKEND=0 RUN_INGESTER=0 RUN_FRONTEND=0 RUN_DOWN=0 RUN_STATUS=0 RUN_LOGS=0

pick() {
  for arg in "$@"; do
    case "$arg" in
      --backend)  RUN_BACKEND=1 ;;
      --ingester) RUN_INGESTER=1 ;;
      --frontend) RUN_FRONTEND=1 ;;
      --logs)     RUN_BACKEND=1 RUN_INGESTER=1 RUN_FRONTEND=1 RUN_LOGS=1 ;;
      --down)     RUN_DOWN=1 ;;
      --status)   RUN_STATUS=1 ;;
      *) RUN_BACKEND=1 RUN_INGESTER=1 RUN_FRONTEND=1 ;;
    esac
  done
}
pick "$@"
[ "$#" -eq 0 ] && RUN_BACKEND=1 RUN_INGESTER=1 RUN_FRONTEND=1

running() { [ -f "$1" ] && kill -0 "$(cat "$1" 2>/dev/null)" 2>/dev/null; }

is_port_open() { (exec 3<>/dev/tcp/127.0.0.1/"$1") >/dev/null 2>&1; }

wait_port() {
  local port="$1" name="$2" i
  for i in $(seq 1 60); do
    is_port_open "$port" && { echo "[dev-up] $name up on :$port"; return 0; }
    sleep 1
  done
  echo "[dev-up] WARN: $name did not open :$port in time" >&2
  return 1
}

if [ "$RUN_STATUS" -eq 1 ]; then
  echo "== finance3 dev stack status =="
  running "$PIDFILE_BACKEND"  && echo "  backend      RUNNING (log: $LOGDIR/backend.log)"  || echo "  backend      stopped"
  running "$PIDFILE_INGESTER" && echo "  notif-ingester RUNNING (log: $LOGDIR/ingester.log)" || echo "  notif-ingester stopped"
  running "$PIDFILE_FRONTEND" && echo "  frontend     RUNNING (log: $LOGDIR/frontend.log)" || echo "  frontend     stopped"
  exit 0
fi

if [ "$RUN_DOWN" -eq 1 ]; then
  echo "== stopping finance3 dev stack =="
  for pidfile in "$PIDFILE_BACKEND" "$PIDFILE_INGESTER" "$PIDFILE_FRONTEND"; do
    if [ -f "$pidfile" ]; then
      kill "$(cat "$pidfile")" 2>/dev/null && echo "stopped $(basename "$pidfile" .pid)" || true
      rm -f "$pidfile"
    fi
  done
  exit 0
fi

# ---- backend (.NET Azure Functions, :7071) ------------------------------------
if [ "$RUN_BACKEND" -eq 1 ]; then
  echo "== starting backend (:7071) =="
  ( cd backend && func start --address 0.0.0.0 ) >"$LOGDIR/backend.log" 2>&1 &
  echo $! > "$PIDFILE_BACKEND"
  wait_port 7071 backend || true
fi

# ---- notif-ingester (Python Azure Functions, :7072) ---------------------------
if [ "$RUN_INGESTER" -eq 1 ]; then
  echo "== starting notif-ingester (:7072) =="
  # Core Tools resolves the Python worker executable from the
  # `languageWorkers:python:defaultExecutablePath` env var (it ignores the
  # local.settings.json value). Point it at the project venv so the worker uses
  # the interpreter that has the app deps + debugpy installed.
  (
    cd notif-ingester
    env "languageWorkers:python:defaultExecutablePath=$ROOT/notif-ingester/.venv/bin/python" \
      func start --address 0.0.0.0
  ) >"$LOGDIR/ingester.log" 2>&1 &
  echo $! > "$PIDFILE_INGESTER"
  wait_port 7072 notif-ingester || true
fi

# ---- frontend (Vite dev server, :5173) ----------------------------------------
if [ "$RUN_FRONTEND" -eq 1 ]; then
  echo "== starting frontend (:5173) =="
  ( cd frontend && npm run dev -- --host 0.0.0.0 ) >"$LOGDIR/frontend.log" 2>&1 &
  echo $! > "$PIDFILE_FRONTEND"
  wait_port 5173 frontend || true
fi

echo ""
if [ "$RUN_LOGS" -eq 1 ]; then
  echo "== tailing combined logs (Ctrl-C to stop) =="
  tail -F "$LOGDIR"/backend.log "$LOGDIR"/ingester.log "$LOGDIR"/frontend.log
else
  echo "Stack started in the background."
  echo "  backend   : http://localhost:7071   api base: /api"
  echo "  ingester  : http://localhost:7072"
  echo "  frontend  : http://localhost:5173"
  echo "  logs      : .devcontainer/logs/"
  echo "  status    : .devcontainer/scripts/dev-up.sh --status"
  echo "  stop      : .devcontainer/scripts/dev-up.sh --down"
fi
