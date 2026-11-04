#!/bin/sh
# Probe the CLI subscription providers inside the desktop: installed?
# logged in? Emits one JSON object the control plane parses with
# parseCliStatus (apps/control/src/cli-bridge/providers.ts). Never
# fails: a missing CLI is data, not an error. No credential contents
# are read into the output beyond the account label Claude reports.
export HOME="${HOME:-/home/agent}"

json_bool() { [ "$1" = "1" ] && printf 'true' || printf 'false'; }

# --- Claude Code -------------------------------------------------------
claude_installed=0
claude_logged=0
claude_account=""
if command -v claude >/dev/null 2>&1; then
  claude_installed=1
  status=$(timeout 15 claude auth status --json 2>/dev/null || true)
  if [ -n "$status" ]; then
    if printf '%s' "$status" | jq -e '.loggedIn == true' >/dev/null 2>&1; then
      claude_logged=1
    fi
    claude_account=$(printf '%s' "$status" | jq -r '.email // .account.email // .accountEmail // empty' 2>/dev/null || true)
  fi
  # Fallback when the status command is unavailable in this CLI build:
  # the stored OAuth credential file is the login.
  if [ "$claude_logged" = "0" ] && [ -s "$HOME/.claude/.credentials.json" ]; then
    claude_logged=1
  fi
fi

# --- Muse -------------------------------------------------------------
# The launcher keeps its binary next to itself and needs that directory
# writable. Installed means either the binary is already on disk, or
# `muse` resolves to the home launcher (seed-muse.sh layout) so the
# first run can download it. A bare launcher file in /usr/local/bin
# (the pre-seed layout) can do neither and reports not installed.
muse_installed=0
muse_logged=0
if command -v muse >/dev/null 2>&1; then
  mdir="$HOME/.local/bin"
  if [ -f "$mdir/.muse-version" ]; then
    mver=$(cat "$mdir/.muse-version" 2>/dev/null || true)
    [ -n "$mver" ] && [ -x "$mdir/muse-bin-$mver" ] && muse_installed=1
  fi
  mresolved=$(readlink -f "$(command -v muse)" 2>/dev/null || true)
  [ "$mresolved" = "$mdir/muse" ] && muse_installed=1
  muse_auth="${MUSE_AUTH_PATH:-${XDG_CONFIG_HOME:-$HOME/.config}/muse/auth.json}"
  [ -s "$muse_auth" ] && muse_logged=1
fi

jq -n \
  --argjson ci "$(json_bool "$claude_installed")" \
  --argjson cl "$(json_bool "$claude_logged")" \
  --arg ca "$claude_account" \
  --argjson mi "$(json_bool "$muse_installed")" \
  --argjson ml "$(json_bool "$muse_logged")" \
  '{
    claudeCode: ({installed: $ci, loggedIn: $cl} + (if $ca == "" then {} else {account: $ca} end)),
    museCode: {installed: $mi, loggedIn: $ml}
  }'
