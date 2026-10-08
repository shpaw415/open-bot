#!/bin/sh
# ob-reset — factory-reset this desktop from inside the container.
# Talks to the open-bot control plane; never prints the auth token.
set -eu

BASE="${OPEN_BOT_CONTROL_URL:-http://open-bot:8787}"
TOKEN="${OPEN_BOT_LLM_TOKEN:?OPEN_BOT_LLM_TOKEN is not set}"

usage() {
  cat >&2 <<'EOF'
Usage:
  ob-reset desktop [--no-wait]   factory-reset this desktop.

A factory reset destroys every container and volume of this desktop (chat
history, installed packages, browser logins, workspace files, this desktop's
memory) and starts a fresh one. A backup is taken first by default.

The reset only runs after the user approves it in the open-bot dashboard with
their account password. Ask them in plain language first; never reset without
that confirmation. With --no-wait the command returns immediately after the
request is created.

Once approved, the desktop is destroyed and this session ends with it.
EOF
}

request() {
  method="$1"
  path="$2"
  body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" \
      -H "content-type: application/json" -d "$body" "$BASE$path"
  else
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" "$BASE$path"
  fi
}

fail_on_error() {
  msg=$(printf '%s' "$1" | jq -r '.error // empty' 2>/dev/null) || msg=""
  if [ -n "$msg" ]; then
    echo "ob-reset: $msg" >&2
    exit 1
  fi
}

urlencode() {
  printf '%s' "$1" | jq -sRr @uri
}

[ $# -ge 1 ] || { usage; exit 2; }
cmd="$1"
shift

case "$cmd" in
  desktop)
    wait=1
    while [ $# -gt 0 ]; do
      case "$1" in
        --no-wait) wait=0; shift ;;
        *) echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    out=$(request POST /api/reset-requests '{"action":"reset"}')
    fail_on_error "$out"
    request_id=$(printf '%s' "$out" | jq -r '.id')
    echo "Desktop factory reset requested."
    if [ "$wait" -eq 0 ]; then
      echo "Request $request_id is waiting for the user's approval in the dashboard."
      exit 0
    fi
    echo "Waiting for the user to approve it in the open-bot dashboard (password required)..."
    deadline=$(( $(date +%s) + 330 ))
    status=""
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT
    while [ "$(date +%s)" -lt "$deadline" ]; do
      code=$(curl -sS -X GET -H "Authorization: Bearer $TOKEN" \
        -o "$tmp" -w '%{http_code}' \
        "$BASE/api/reset-requests/$(urlencode "$request_id")" 2>/dev/null) || code=000
      if [ "$code" = "401" ] || [ "$code" = "404" ]; then
        status="gone"
        break
      fi
      status=$(jq -r '.status // empty' "$tmp" 2>/dev/null) || status=""
      case "$status" in
        approved|denied|expired) break ;;
      esac
      sleep 3
    done
    case "$status" in
      approved)
        echo "Approved. The desktop is being reset and this session ends now."
        echo "The user can follow the result in the dashboard."
        ;;
      denied)
        echo "ob-reset: the user denied the reset" >&2
        exit 1
        ;;
      expired)
        echo "ob-reset: the request was not approved in time and expired" >&2
        exit 1
        ;;
      gone)
        echo "Approved (or the request vanished): an approved reset destroys"
        echo "this desktop and rotates this session's token, so the request"
        echo "is no longer pollable. The dashboard shows the outcome."
        ;;
      *)
        echo "ob-reset: no decision after 5.5 minutes; request expired" >&2
        exit 1
        ;;
    esac
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2; usage; exit 2
    ;;
esac
