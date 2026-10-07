#!/bin/sh
# ob-improve — file a product report from inside a development desktop.
# Talks to the open-bot control plane; never prints the auth token.
set -eu

BASE="${OPEN_BOT_CONTROL_URL:-http://open-bot:8787}"
TOKEN="${OPEN_BOT_LLM_TOKEN:?OPEN_BOT_LLM_TOKEN is not set}"

usage() {
  cat >&2 <<'EOF'
Usage:
  ob-improve add --kind bug|friction|feature --surface chat|desktop|nav|cron|persona|config|other --title TEXT --detail TEXT [--session ID]

Files one product report. A matching open report increments its hit count.
This command exists only on desktops built with update --dev.
EOF
}

request() {
  curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
    -H "content-type: application/json" -d "$1" "$BASE/api/improvements"
}

fail_on_error() {
  msg=$(printf '%s' "$1" | jq -r '.error // empty' 2>/dev/null) || msg=""
  if [ -n "$msg" ]; then
    echo "ob-improve: $msg" >&2
    exit 1
  fi
}

[ $# -ge 1 ] || { usage; exit 2; }
cmd="$1"
shift

case "$cmd" in
  add)
    kind=""
    surface=""
    title=""
    detail=""
    session=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --kind)
          [ $# -ge 2 ] || { usage; exit 2; }
          kind="$2"; shift 2 ;;
        --surface)
          [ $# -ge 2 ] || { usage; exit 2; }
          surface="$2"; shift 2 ;;
        --title)
          [ $# -ge 2 ] || { usage; exit 2; }
          title="$2"; shift 2 ;;
        --detail)
          [ $# -ge 2 ] || { usage; exit 2; }
          detail="$2"; shift 2 ;;
        --session)
          [ $# -ge 2 ] || { usage; exit 2; }
          session="$2"; shift 2 ;;
        *)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    [ -n "$kind" ] && [ -n "$surface" ] && [ -n "$title" ] && [ -n "$detail" ] || { usage; exit 2; }
    body=$(jq -n \
      --arg kind "$kind" \
      --arg surface "$surface" \
      --arg title "$title" \
      --arg detail "$detail" \
      --arg session "$session" \
      '{kind: $kind, surface: $surface, title: $title, detail: $detail} + (if $session == "" then {} else {sessionId: $session} end)')
    out=$(request "$body")
    fail_on_error "$out"
    printf '%s\n' "$out" | jq '{id, duplicate, hits}'
    echo "Filed."
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2; usage; exit 2
    ;;
esac
