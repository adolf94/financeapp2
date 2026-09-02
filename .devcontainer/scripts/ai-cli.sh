#!/usr/bin/env bash
#
# ai-cli.sh - opt-in installer for AI coding CLIs inside the dev container.
#
# Usage:
#   ai-cli.sh                       interactive checkbox picker
#   ai-cli.sh --opencode            install opencode only
#   ai-cli.sh --agy                 install Google Antigravity CLI only
#   ai-cli.sh --claude              install Claude Code CLI only
#   ai-cli.sh --all                 install everything
#   ai-cli.sh --extensions          also install matching VS Code extensions (default)
#   ai-cli.sh --no-extensions       skip VS Code extensions
#   ai-cli.sh --status              show what is already installed
#   ai-cli.sh --force               reinstall/upgrade even if present
#
set -euo pipefail

HOME_BIN="$HOME/.local/bin"
OPENCODE_BIN="$HOME/.opencode/bin"
PATH_LINE='export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$PATH"'

log()  { printf '\033[1;32m[ai-cli]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[ai-cli]\033[0m %s\n' "$*" >&2; }

installed() { command -v "$1" >/dev/null 2>&1; }

# VS Code extension id per CLI (only installed when CLI is selected).
EXT_OPENCODE="sst-dev.opencode"
EXT_AGY="google.antigravity"
EXT_CLAUDE="anthropic.claude-code"

code_available() { command -v code >/dev/null 2>&1; }

install_extension() {
  local name="$1"
  code_available || { warn "VS Code 'code' CLI not found; install the '${!name:-}' extension manually"; return 1; }
  log "installing VS Code extension ${!name}"
  code --install-extension "${!name}" --force
}

install_one() {
  local name="$1" force="$2"
  if installed "$name"; then
    if [ "$force" = "1" ]; then
      log "reinstalling $name"
      "install_$name"
    else
      log "$name already installed ($(command -v "$name")), skipping"
    fi
  else
    "install_$name"
  fi
  if [ "$WANT_EXTENSIONS" = "1" ]; then
    install_extension "EXT_${name^^}"
  fi
}

ensure_path_line() {
  if ! grep -qF 'opencode/bin' "$HOME/.bashrc" 2>/dev/null; then
    printf '%s\n' "$PATH_LINE" >> "$HOME/.bashrc"
  fi
  case ":$PATH:" in
    *":$OPENCODE_BIN:"*|*":$HOME_BIN:"*) ;;
    *) export PATH="$OPENCODE_BIN:$HOME_BIN:$PATH" ;;
  esac
}

ensure_whiptail() {
  installed whiptail && return 0
  if command -v apt-get >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo -n apt-get update -qq >/dev/null 2>&1 || true
    if sudo -n apt-get install -y -qq whiptail >/dev/null 2>&1; then
      return 0
    fi
  fi
  warn "whiptail not available (could not auto-install); falling back to text prompts"
  return 1
}

install_opencode() {
  log "installing opencode -> $OPENCODE_BIN/opencode"
  curl -fsSL https://opencode.ai/install | bash
  ensure_path_line
  opencode --version
}

install_agy() {
  log "installing Antigravity CLI (agy) -> $HOME_BIN/agy"
  curl -fsSL https://antigravity.google/cli/install.sh | bash
  ensure_path_line
  agy --version
}

install_claude() {
  log "installing Claude Code CLI via npm"
  if npm prefix -g >/dev/null 2>&1 && [ -w "$(npm prefix -g)" ]; then
    npm install -g @anthropic-ai/claude-code
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo -n npm install -g @anthropic-ai/claude-code
  else
    warn "cannot write to npm global prefix and no passwordless sudo;"
    warn "run manually: npm install -g @anthropic-ai/claude-code"
    return 1
  fi
  claude --version
}

install_one() {
  local name="$1" force="$2"
  if installed "$name"; then
    if [ "$force" = "1" ]; then
      log "reinstalling $name"
      "install_$name"
    else
      log "$name already installed ($(command -v "$name")), skipping"
    fi
    return 0
  fi
  "install_$name"
}

pick_whiptail() {
  local status selection
  status=""
  installed opencode && status="${status}opencode installed.\n"
  installed agy && status="${status}agy installed.\n"
  installed claude && status="${status}claude installed.\n"
  [ -n "$status" ] && status="Currently installed:\n$status\n" || status="None of the AI CLIs are installed yet.\n"

  selection=$(whiptail --title "AI CLI Tools" \
    --separate-output --checklist "$status\n'extensions' also installs the matching VS Code extensions.\nSpace: toggle   Enter: install selected" 18 62 4 \
    "opencode"  "OpenCode - open-source AI terminal agent" "$([ installed opencode ] && echo ON || echo OFF)" \
    "agy"       "Google Antigravity CLI"                     "$([ installed agy ] && echo ON || echo OFF)" \
    "claude"    "Anthropic Claude Code CLI"                  "$([ installed claude ] && echo ON || echo OFF)" \
    "extensions" "Also install VS Code extensions"            "$([ "$WANT_EXTENSIONS" = "1" ] && echo ON || echo OFF)" \
    3>&1 1>&2 2>&3) || { log "nothing selected, exiting"; exit 0; }

  local want_ext=0
  while IFS= read -r name; do
    [ "$name" = "extensions" ] && { want_ext=1; continue; }
    [ "$want_ext" = "1" ] && WANT_EXTENSIONS=1
    install_one "$name" 1
  done <<< "$selection"
}

pick_text() {
  for name in opencode agy claude; do
    local default
    installed "$name" && default="Y" || default="n"
    read -rp "Install $name? [y/N] " -i "$default" answer || true
    case "$answer" in
      y|Y|yes|YES) install_one "$name" 1 ;;
      *) log "skipping $name" ;;
    esac
  done
}

show_status() {
  log "AI CLI status"
  for name in opencode agy claude; do
    if installed "$name"; then
      log "  $name -> $(command -v "$name")"
    else
      log "  $name -> not installed"
    fi
  done
}

FORCE=0
WANT_OPENCODE=0 WANT_AGY=0 WANT_CLAUDE=0
WANT_EXTENSIONS=1
HAS_FLAG=0

for arg in "$@"; do
  case "$arg" in
    --status)     show_status; exit 0 ;;
    --force)      FORCE=1 ;;
    --opencode)   WANT_OPENCODE=1; HAS_FLAG=1 ;;
    --agy)        WANT_AGY=1; HAS_FLAG=1 ;;
    --claude)     WANT_CLAUDE=1; HAS_FLAG=1 ;;
    --all)        WANT_OPENCODE=1; WANT_AGY=1; WANT_CLAUDE=1; HAS_FLAG=1 ;;
    --extensions)    WANT_EXTENSIONS=1 ;;
    --no-extensions) WANT_EXTENSIONS=0 ;;
    -h|--help)    head -25 "$0" | grep '^#' | sed 's/^# \?//'; exit 0 ;;
    *) warn "unknown argument: $arg (see --help)"; exit 1 ;;
  esac
done

if [ "$HAS_FLAG" = "1" ]; then
  [ "$WANT_OPENCODE" = "1" ] && install_one opencode "$FORCE"
  [ "$WANT_AGY" = "1" ] && install_one agy "$FORCE"
  [ "$WANT_CLAUDE" = "1" ] && install_one claude "$FORCE"
elif [ -t 0 ] && ensure_whiptail; then
  pick_whiptail
else
  pick_text
fi

log "done. Open a fresh terminal (or restart bash) so new PATH entries take effect."