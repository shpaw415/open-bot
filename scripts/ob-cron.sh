#!/bin/sh
# ob-cron — manage scheduled agent jobs from inside the desktop container.
# Talks to the open-bot control plane; never prints the auth token.
set -eu

BASE="${OPEN_BOT_CONTROL_URL:-http://open-bot:8787}"
TOKEN="${OPEN_BOT_LLM_TOKEN:?OPEN_BOT_LLM_TOKEN is not set}"

usage() {
  cat >&2 <<'EOF'
Usage:
  ob-cron add --name NAME --message TEXT (--every SECONDS | --cron "M H DOM MON DOW" | --at ISO8601)
  ob-cron list
  ob-cron remove ID
  ob-cron run ID

Schedules (exactly one):
  --every SECONDS   recurring interval, minimum 60
  --cron "EXPR"     5-field UTC cron expression, e.g. "0 9 * * 1-5"
  --at ISO8601      one-shot run, e.g. 2026-12-01T09:00:00Z

Examples:
  ob-cron add --name standup --message "Summarize git log since yesterday" --cron "0 13 * * 1-5"
  ob-cron add --name snapshot --message "Back up workspace notes" --every 3600
  ob-cron add --name reminder --message "Check the build output" --at 2026-11-30T15:00:00Z
  ob-cron list
  ob-cron remove 3f2b...
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
    echo "ob-cron: $msg" >&2
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
  add)
    name=""
    message=""
    every=""
    cron=""
    at=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --name)
          [ $# -ge 2 ] || { usage; exit 2; }
          name="$2"; shift 2 ;;
        --message)
          [ $# -ge 2 ] || { usage; exit 2; }
          message="$2"; shift 2 ;;
        --every)
          [ $# -ge 2 ] || { usage; exit 2; }
          every="$2"; shift 2 ;;
        --cron)
          [ $# -ge 2 ] || { usage; exit 2; }
          cron="$2"; shift 2 ;;
        --at)
          [ $# -ge 2 ] || { usage; exit 2; }
          at="$2"; shift 2 ;;
        *)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    [ -n "$name" ] && [ -n "$message" ] || { usage; exit 2; }
    kind=""
    every_json="null"
    cron_json="null"
    at_json="null"
    schedules=0
    if [ -n "$every" ]; then
      kind="every"; every_json="$every"; schedules=$((schedules + 1))
    fi
    if [ -n "$cron" ]; then
      kind="cron"; cron_json=$(jq -Rn --arg v "$cron" '$v'); schedules=$((schedules + 1))
    fi
    if [ -n "$at" ]; then
      at_s=$(date -u -d "$at" +%s 2>/dev/null) || {
        echo "ob-cron: invalid --at value (use ISO 8601, e.g. 2026-12-01T09:00:00Z)" >&2
        exit 2
      }
      kind="at"; at_json=$((at_s * 1000)); schedules=$((schedules + 1))
    fi
    [ "$schedules" -eq 1 ] || {
      echo "ob-cron: pass exactly one of --every, --cron, --at" >&2
      exit 2
    }
    body=$(jq -n --arg name "$name" --arg message "$message" --arg kind "$kind" \
      --argjson every "$every_json" --argjson cron "$cron_json" --argjson at "$at_json" \
      '{name: $name, message: $message, kind: $kind, everySeconds: $every, cronExpr: $cron, atMs: $at}')
    out=$(request POST /api/cron "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{id, name, kind, cronExpr, everySeconds, atMs, nextRunAt, enabled}'
    ;;
  list)
    out=$(request GET /api/cron)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '.[] |
      "- \(.name) [\(.id)] \(
        if .kind == "cron" then (.cronExpr // "")
        elif .kind == "every" then "every \(.everySeconds)s"
        else "at \((.atMs / 1000 | strftime("%Y-%m-%dT%H:%M:%SZ")) // "")"
        end)\(if .enabled then "" else " (disabled)" end) runs=\(.runCount)"'
    ;;
  remove)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request DELETE "/api/cron/$(urlencode "$1")")
    fail_on_error "$out"
    echo "removed $1"
    ;;
  run)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request POST "/api/cron/$(urlencode "$1")/run")
    fail_on_error "$out"
    echo "ran $1"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2; usage; exit 2
    ;;
esac
