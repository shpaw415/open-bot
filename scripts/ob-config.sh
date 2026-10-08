#!/bin/sh
# ob-config — change a media provider model from inside the desktop.
# Persists on the control plane (config page source of truth) and applies to
# this desktop. Never prints or edits auth files.
set -eu

BASE="${OPEN_BOT_CONTROL_URL:-http://open-bot:8787}"
TOKEN="${OPEN_BOT_LLM_TOKEN:?OPEN_BOT_LLM_TOKEN is not set}"

usage() {
  cat >&2 <<'EOF'
Usage:
  ob-config set-model image|video|model3d MODEL

Switches the configured model for that provider group, keeps the provider and
its saved key, and applies the new marker to this desktop immediately.
Editing ~/.config/open-bot/*.json by hand does not survive a desktop start;
this command does.
EOF
}

[ $# -eq 3 ] || { usage; exit 2; }
cmd="$1"
kind="$2"
model="$3"
[ "$cmd" = "set-model" ] || { usage; exit 2; }

case "$kind" in
  image|video|model3d) ;;
  *)
    echo "ob-config: kind must be image, video, or model3d" >&2
    exit 2
    ;;
esac

body=$(jq -n --arg kind "$kind" --arg model "$model" '{kind: $kind, model: $model}')
out=$(curl -sS -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" -d "$body" "$BASE/api/agent-config")

msg=$(printf '%s' "$out" | jq -r '.error // empty' 2>/dev/null) || msg=""
if [ -n "$msg" ]; then
  echo "ob-config: $msg" >&2
  exit 1
fi
printf '%s\n' "$out" | jq '{provider, model, applied}'
