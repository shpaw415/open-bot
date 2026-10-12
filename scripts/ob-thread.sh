#!/bin/sh
# ob-thread — start a new thread from inside the desktop container.
# Talks to the open-bot control plane; never prints the auth token.
# Without --display the thread is hidden (worker: title prefix): it stays off
# the dashboard and the media vault, for background jobs.
set -eu

BASE="${OPEN_BOT_CONTROL_URL:-http://open-bot:8787}"
TOKEN="${OPEN_BOT_LLM_TOKEN:?OPEN_BOT_LLM_TOKEN is not set}"

usage() {
  cat >&2 <<'EOF'
Usage:
  ob-thread start [--title TEXT] [--persona NAME] [--display] [--hidden] [--message TEXT]
  ob-thread list

start creates a thread. Without --display the thread is hidden for background
jobs: it does not appear on the dashboard and the media vault skips it.
--display makes it a normal visible thread. --message TEXT posts an initial
prompt into the thread right after creating it.

--persona NAME hands the thread to a personality: the thread answers as that
persona (team delegation). Typos in the name are tolerated and the output
tells you which persona matched. Persona threads are visible by default;
add --hidden for a background teammate. Check `ob-persona list` for names.

list shows the hidden threads created through this tool.

Examples:
  ob-thread start --title "Nightly sync" --display
  ob-thread start --title "Scrape prices" --message "Scrape prices and save to /home/agent/workspace/prices.json"
  ob-thread start --persona "Software manager" --title "Add export" --message "Implement CSV export in ~/project/report-app"
  ob-thread list
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
    echo "ob-thread: $msg" >&2
    sugg=$(printf '%s' "$1" | jq -r 'if (.suggestions // []) | length > 0 then (.suggestions | "ob-thread: did you mean: " + join(", ")) else empty end' 2>/dev/null) || sugg=""
    if [ -n "$sugg" ]; then
      echo "$sugg" >&2
    fi
    exit 1
  fi
}

[ $# -ge 1 ] || { usage; exit 2; }
cmd="$1"
shift

case "$cmd" in
  start)
    title=""
    message=""
    persona=""
    display=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --title)
          [ $# -ge 2 ] || { usage; exit 2; }
          title="$2"; shift 2 ;;
        --message)
          [ $# -ge 2 ] || { usage; exit 2; }
          message="$2"; shift 2 ;;
        --persona)
          [ $# -ge 2 ] || { usage; exit 2; }
          persona="$2"; shift 2 ;;
        --display)
          display=1; shift ;;
        --hidden)
          display=0; shift ;;
        *)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    body="{}"
    if [ -n "$title" ]; then
      body=$(printf '%s' "$body" | jq --arg title "$title" '. + {title: $title}')
    fi
    visible="$display"
    if [ -z "$visible" ]; then
      if [ -n "$persona" ]; then visible=1; else visible=0; fi
    fi
    if [ "$visible" -eq 1 ]; then
      body=$(printf '%s' "$body" | jq '. + {display: true}')
    fi
    if [ -n "$persona" ]; then
      body=$(printf '%s' "$body" | jq --arg persona "$persona" '. + {persona: $persona}')
    fi
    if [ -n "$message" ]; then
      body=$(printf '%s' "$body" | jq --arg message "$message" '. + {message: $message}')
    fi
    out=$(request POST /api/threads "$body")
    fail_on_error "$out"
    warning=$(printf '%s' "$out" | jq -r '.warning // empty' 2>/dev/null) || warning=""
    if [ -n "$warning" ]; then
      echo "ob-thread: $warning" >&2
    fi
    printf '%s' "$out" | jq '{id, title, display} + (if .persona then {persona: .persona} else {} end)'
    ;;
  list)
    out=$(request GET /api/threads)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '.threads[] | "- [\(.id)] \(.title)"'
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2; usage; exit 2
    ;;
esac
