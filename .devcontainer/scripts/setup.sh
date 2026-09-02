#!/usr/bin/env bash
#
# setup.sh - one-time setup for the dev container.
# Installs project dependencies for the frontend and notif-ingester, verifies the
# .NET backend can restore, and points connection strings at the emulators.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "==> Verifying toolchain"
dotnet --version
func --version
node --version
npm --version
python3 --version

echo "==> Restoring backend NuGet packages"
dotnet restore backend/backend.csproj

echo "==> Installing notif-ingester Python dependencies"
if [ ! -d notif-ingester/.venv ]; then
    python3 -m venv notif-ingester/.venv
fi
notif-ingester/.venv/bin/python -m pip install --upgrade pip
notif-ingester/.venv/bin/python -m pip install -r notif-ingester/requirements.txt

echo "==> Installing frontend dependencies"
npm --prefix frontend install

echo ""
echo "Setup complete."
echo "To run the stack:  .devcontainer/scripts/dev-up.sh"
