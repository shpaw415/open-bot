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
  ob-thread start [--title TEXT] [--persona NAME] [--display] [--hidden] [--dir NAME] [--message TEXT]
  ob-thread list
  ob-thread dirs
  ob-thread delete ID [ID...] | --all

start creates a thread. Without --display the thread is hidden for background
jobs: it does not appear on the dashboard and the media vault skips it.
--display makes it a normal visible thread. --message TEXT posts an initial
prompt into the thread right after creating it.

--dir NAME (or --topic NAME) files the new visible thread into a dashboard
folder, creating the folder if it does not exist. Folders only exist on the
dashboard, so --dir implies a visible thread and cannot be combined with
--hidden. Run `ob-thread dirs` first to reuse an existing folder name.

--persona NAME hands the thread to a personality: the thread answers as that
persona (team delegation). Typos in the name are tolerated and the output
tells you which persona matched. Persona threads are visible by default;
add --hidden for a background teammate. Check `ob-persona list` for names.

list shows the hidden threads created through this tool.

dirs lists the dashboard thread folders.

delete removes hidden threads by id (as shown by list). --all removes every
hidden agent thread. The server refuses anything that is not a hidden agent
thread — visible dashboard threads and cron jobs come back as skipped with
a reason.

Examples:
  ob-thread start --title "Nightly sync" --display
  ob-thread start --title "Scrape prices" --message "Scrape prices and save to /home/agent/workspace/prices.json"
  ob-thread start --persona "Software manager" --title "Add export" --message "Implement CSV export in ~/project/report-app"
  ob-thread start --title "Invoice follow-up" --dir "Billing" --display
  ob-thread dirs
  ob-thread list
  ob-thread delete ses_abc123
  ob-thread delete --all
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
    dir=""
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
        --dir|--topic)
          [ $# -ge 2 ] || { usage; exit 2; }
          dir="$2"; shift 2 ;;
        --display)
          display=1; shift ;;
        --hidden)
          display=0; shift ;;
        *)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    if [ -n "$dir" ] && [ "$display" = "0" ]; then
      echo "ob-thread: --dir applies to visible threads and cannot be combined with --hidden" >&2
      exit 2
    fi
    body="{}"
    if [ -n "$title" ]; then
      body=$(printf '%s' "$body" | jq --arg title "$title" '. + {title: $title}')
    fi
    visible="$display"
    if [ -z "$visible" ]; then
      if [ -n "$persona" ] || [ -n "$dir" ]; then visible=1; else visible=0; fi
    fi
    if [ "$visible" -eq 1 ]; then
      body=$(printf '%s' "$body" | jq '. + {display: true}')
    fi
    if [ -n "$persona" ]; then
      body=$(printf '%s' "$body" | jq --arg persona "$persona" '. + {persona: $persona}')
    fi
    if [ -n "$dir" ]; then
      body=$(printf '%s' "$body" | jq --arg dir "$dir" '. + {dir: $dir}')
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
    printf '%s' "$out" | jq '{id, title, display} + (if .persona then {persona: .persona} else {} end) + (if .dir then {dir: .dir} else {} end)'
    ;;
  dirs)
    out=$(request GET /api/thread-dirs)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r 'if (.dirs | length) == 0 then "(no folders yet)" else .dirs[] | "- [\(.id)] \(.name)" end'
    ;;
  list)
    out=$(request GET /api/threads)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '.threads[] | "- [\(.id)] \(.title)"'
    ;;
  delete)
    ids=""
    all=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --all)
          all=1; shift ;;
        -h|--help)
          usage; exit 0 ;;
        --*)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
        *)
          if [ -z "$ids" ]; then ids="$1"; else ids="$ids
$1"; fi
          shift ;;
      esac
    done
    if [ -n "$all" ]; then
      out=$(request GET /api/threads)
      fail_on_error "$out"
      ids=$(printf '%s' "$out" | jq -r '.threads[].id // empty' 2>/dev/null) || ids=""
      if [ -z "$ids" ]; then
        echo "ob-thread: nothing to delete" >&2
        exit 1
      fi
    elif [ -z "$ids" ]; then
      usage
      exit 2
    fi
    body=$(printf '%s' "$ids" | jq -R . | jq -s '{ids: .}')
    out=$(request DELETE /api/threads "$body")
    fail_on_error "$out"
    deleted=$(printf '%s' "$out" | jq -r '.deleted | length')
    if [ "$deleted" -gt 0 ]; then
      printf '%s' "$out" | jq -r '"deleted: " + (.deleted | join(", "))'
    fi
    printf '%s' "$out" | jq -r '.skipped[] | "skipped [\(.id)]: \(.reason)"'
    if [ "$deleted" -eq 0 ]; then
      exit 1
    fi
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2; usage; exit 2
    ;;
esac
