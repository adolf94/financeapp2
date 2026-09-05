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


echo "==> Injecting .devcontainer/.env into shell (~/.bashrc)"
# Each new console sources .devcontainer/.env (bind-mounted),
# so changes take effect on the next shell with no container restart.
# Marker must match what we append so reruns don't duplicate.
ENV_HOOK_MARKER="ar-loans-app: load all vars from .devcontainer/.env on every shell."
if ! grep -qsF "$ENV_HOOK_MARKER" "$HOME/.bashrc"; then
  cat >> "$HOME/.bashrc" <<EOF

# $ENV_HOOK_MARKER
if [ -f "$ROOT/.devcontainer/.env" ]; then
  set -a
  . "$ROOT/.devcontainer/.env"
  set +a
fi
EOF
fi
# Also source for this process's own `npm install` below (non-interactive shells
# don't source ~/.bashrc). Single source of truth: .devcontainer/.env.
set -a
. "$ROOT/.devcontainer/.env"
set +a




echo "==> Ensuring opencode CLI"
# The npm `opencode-ai` package depends on a postinstall step that is
# skipped with --ignore-scripts / pnpm, yielding:
#   "opencode-ai's postinstall script was not run ..."
# We standardize on the official install script (binary in
# ~/.opencode/bin, no postinstall). This block is idempotent and
# best-effort: never fail setup when offline.
export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$PATH"
if command -v opencode >/dev/null 2>&1 && opencode --version >/dev/null 2>&1; then
  echo "opencode OK: $(opencode --version 2>&1 | head -n1)"
else
  echo "opencode missing/broken - installing via https://opencode.ai/install ..."
  if curl -fsSL https://opencode.ai/install | bash; then
    export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$PATH"
  else
    echo "WARN: opencode install script failed (offline?) - trying npm postinstall repair" >&2
  fi
  # Repair legacy npm global install if present but broken.
  if ! opencode --version >/dev/null 2>&1; then
    NPM_ROOT="$(npm root -g 2>/dev/null || true)"
    if [ -n "${NPM_ROOT:-}" ] && [ -f "$NPM_ROOT/opencode-ai/postinstall.mjs" ]; then
      echo "Trying manual postinstall repair in $NPM_ROOT/opencode-ai ..."
      (cd "$NPM_ROOT/opencode-ai" && node postinstall.mjs) || true
    fi
  fi
  if opencode --version >/dev/null 2>&1; then
    echo "opencode OK: $(opencode --version 2>&1 | head -n1)"
  else
    echo "WARN: opencode still unavailable - rerun setup.sh when online, or run: curl -fsSL https://opencode.ai/install | bash" >&2
  fi
fi


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
