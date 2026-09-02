# Finance3 — Containerized Dev Environment

One command sets up a complete local development environment for the whole
stack. The Azure emulators run in Docker containers, and all three app processes
(backend, notif-ingester, frontend) run inside a dedicated `dev` container that
contains the full toolchain.

## Architecture

```
┌───────────────────────────── host ──────────────────────────────┐
│                                                                │
│   browser ─► http://localhost:5173  (frontend/Vite)            │
│              http://localhost:7071  (backend API)              │
│              http://localhost:7072  (ingester API)             │
│                                                                │
│   docker compose (finance3-net bridge)                         │
│   ┌─────────────────────────────┐   ┌───────────────────────┐  │
│   │ dev  (finance3-dev)         │   │ cosmos  :8081          │  │
│   │   backend       7071        │   │   Cosmos DB emulator   │  │
│   │   notif-ingester 7072       │   ├───────────────────────┤  │
│   │   frontend       5173       │   │ azurite :10000-10002   │  │
│   │   (full toolchain)          │   │   Azure Storage emulator│  │
│   └─────────────────────────────┘   ├───────────────────────┤  │
│                                      │ signalr :8888         │  │
│                                      │   SignalR emulator    │  │
│                                      └───────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

The three apps talk to each other over `localhost` (they share the dev
container). They reach the emulators over the compose network by service
hostname — `cosmos`, `azurite`, `signalr`. The `local.settings.json` files have
already been updated to point at these hostnames.

## Requirements

- Docker with Compose v2 (`docker compose`)
- VS Code with the **Dev Containers** extension (for the devcontainer workflow)
  - *or* no editor at all — the stack is usable standalone via compose

## Quick start

### Option A — VS Code Dev Container (recommended)

1. Install the Dev Containers extension in VS Code.
2. Open this repository in VS Code — it will detect `.devcontainer/devcontainer.json`.
3. Run **Dev Containers: Reopen in Container** (F1 → the command).
   - First build takes a few minutes (installs .NET 10 SDK, Azure Functions Core
     Tools, Node 22, Python libraries, and project dependencies via
     `postCreateCommand`).
4. Start the app processes inside the container:

   ```bash
   .devcontainer/scripts/dev-up.sh
   ```

5. Open http://localhost:5173 in the host browser.

### Option B — Standalone compose (no VS Code)

```bash
# From the repo root:
docker compose -f .devcontainer/docker-compose.yml up -d --build

# Attach to the dev container:
docker exec -it finance3-dev bash

# Inside the container, run one-time setup (first time only):
bash .devcontainer/scripts/setup.sh

# Start the three app processes:
bash .devcontainer/scripts/dev-up.sh
```

## Managing the stack

All of these run from the repo root:

```bash
# Emulators + dev container
.devcontainer/scripts/dev-stack.sh up       # build & start everything
.devcontainer/scripts/dev-stack.sh down     # stop emulators + dev container
.devcontainer/scripts/dev-stack.sh status   # container status
.devcontainer/scripts/dev-stack.sh logs     # follow dev container logs

# App processes (inside the dev container)
.devcontainer/scripts/dev-up.sh             # start all three apps (background)
.devcontainer/scripts/dev-up.sh --logs      # start + tail combined logs
.devcontainer/scripts/dev-up.sh --backend   # only the .NET backend
.devcontainer/scripts/dev-up.sh --ingester  # only the Python ingester
.devcontainer/scripts/dev-up.sh --frontend  # only the Vite frontend
.devcontainer/scripts/dev-up.sh --status    # which apps are running
.devcontainer/scripts/dev-up.sh --down      # stop the three app processes
```

## Services & ports

| Service          | Container      | Internal port(s) | Host port(s)           | Notes                                   |
|------------------|----------------|------------------|------------------------|-----------------------------------------|
| Cosmos DB        | `finance3-cosmos`   | 8081        | 8081             | Default emulator key; cert is self-signed |
| Azure Storage    | `finance3-azurite`  | 10000-10002 | 10000-10002      | Used by both Functions hosts            |
| SignalR          | `finance3-signalr`  | 8888        | 6001             | Emulator listens on 8888 (not 8080); optional, ingester degrades gracefully |
| backend (.NET)   | `finance3-dev`      | 7071        | 7071             | `func start` in `backend/`              |
| notif-ingester   | `finance3-dev`      | 7072        | 7072             | `func start` in `notif-ingester/`       |
| frontend (Vite)  | `finance3-dev`      | 5173        | 5173             | Hot reload mounted from the repo        |

## Configuration notes

- **AI keys / secrets** live in `notif-ingester/.env` (gitignored) and are used
  as-is inside the container. The local emulator connection strings
  (`local.settings.json`) reference the compose service hostnames.
- **Cosmos emulator over HTTP**: the Linux Cosmos emulator
  (`azure-cosmos-emulator:vnext-latest`) serves plain **HTTP on `http://cosmos:8081`**
  (no TLS) and only supports **Gateway connection mode** — Direct/RNTBD is not
  supported and triggers a Cosmos SDK stream bug. The backend therefore runs with
  `CosmosConnectionMode: Gateway` (see the `ConnectionMode.Gateway` branch in
  `backend/Program.cs`) and the connection strings use `http://`.
- **SignalR**: the emulator is optional. If `AzureSignalRConnectionString` is
  unreachable the ingester logs a warning and continues (see
  `notif-ingester/services/signalr_publisher.py`). The emulator listens on
  port **8888** and is mapped to host port 6001; the compose service reaches the
  backend webhook via `host.docker.internal:7071`.
- **First build** downloads the .NET 10 SDK, Azure Functions Core Tools and
  Node — allow several minutes.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Backend fails to reach Cosmos | Ensure `dev-stack.sh up` ran and Cosmos is healthy: `docker compose -f .devcontainer/docker-compose.yml ps` |
| Port already in use on host | Change the published ports in `docker-compose.yml` (left column) |
| Python worker exits immediately (`python3 exited with code 1`) | Core Tools launches the system `python3`, which lacks the project deps/debugpy. `dev-up.sh` exports `languageWorkers:python:defaultExecutablePath` pointing at `notif-ingester/.venv/bin/python` (the local.settings.json key is ignored by Core Tools). Re-run `bash .devcontainer/scripts/setup.sh` to recreate the venv |
| Frontend can't reach ingester | `VITE_INGESTER_BASE_URL` in `frontend/.env` should be `http://localhost:7072` |
| Changes to `local.settings.json` have no effect | Restart the app process (`dev-up.sh --down` then `dev-up.sh`) |
| Cosmos emulator won't start on Apple Silicon/ARM | The Cosmos Linux emulator is amd64-only; run Windows/macOS native emulator or use a remote amd64 host |