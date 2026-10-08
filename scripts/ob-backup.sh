#!/bin/sh
# ob-backup — back up and restore this desktop from inside the container.
# Talks to the open-bot control plane; never prints the auth token.
set -eu

BASE="${OPEN_BOT_CONTROL_URL:-http://open-bot:8787}"
TOKEN="${OPEN_BOT_LLM_TOKEN:?OPEN_BOT_LLM_TOKEN is not set}"

usage() {
  cat >&2 <<'EOF'
Usage:
  ob-backup create [--label TEXT]   back up this desktop's volumes now
  ob-backup list                    list backups that include this desktop
  ob-backup show ID                 show one backup's contents
  ob-backup restore ID              restore this desktop from a backup.
                                    Needs the user's approval in the open-bot
                                    dashboard (password confirmation), then the
                                    desktop restarts and this session ends.

The control-plane database and other users are only included in backups the
admin starts from the dashboard.
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
    echo "ob-backup: $msg" >&2
    exit 1
  fi
}

urlencode() {
  printf '%s' "$1" | jq -sRr @uri
}

# poll STATE_URL OUT_FIELD TERMINAL_VALUES TIMEOUT_S (raw body -> $POLLFILE)
poll_field() {
  url="$1"
  field="$2"
  terminals="$3"
  timeout_s="$4"
  deadline=$(( $(date +%s) + timeout_s ))
  tmp="$(mktemp)"
  while [ "$(date +%s)" -lt "$deadline" ]; do
    code=$(curl -sS -X GET -H "Authorization: Bearer $TOKEN" \
      -o "$tmp" -w '%{http_code}' "$BASE$url" 2>/dev/null) || code=000
    if [ "$code" = "401" ] || [ "$code" = "404" ]; then
      rm -f "$tmp"
      echo "gone"
      return 0
    fi
    printf '%s' "$(cat "$tmp")" > "$POLLFILE"
    value=$(printf '%s' "$(cat "$tmp")" | jq -r "$field" 2>/dev/null) || value=""
    for t in $terminals; do
      [ "$value" = "$t" ] && { rm -f "$tmp"; echo "$value"; return 0; }
    done
    sleep 3
  done
  rm -f "$tmp"
  echo "timeout"
}

[ $# -ge 1 ] || { usage; exit 2; }
cmd="$1"
shift

case "$cmd" in
  create)
    label=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --label)
          [ $# -ge 2 ] || { usage; exit 2; }
          label="$2"; shift 2 ;;
        *) echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    body=$(jq -n --arg label "$label" '{label: (if $label == "" then null else $label end)}')
    out=$(request POST /api/backup/run "$body")
    fail_on_error "$out"
    id=$(printf '%s' "$out" | jq -r '.id')
    echo "backup $id started"
    POLLFILE="$(mktemp)"
    trap 'rm -f "$POLLFILE"' EXIT
    state=$(poll_field "/api/backup/$(urlencode "$id")" '.run.state // empty' "done failed" 1800)
    if [ "$state" = "done" ]; then
      jq -r '.run.manifest | "backup finished: \(.id) (\(.totalBytes) bytes)"' "$POLLFILE"
    elif [ "$state" = "failed" ]; then
      msg=$(jq -r '.run.error // "backup failed"' "$POLLFILE")
      echo "ob-backup: $msg" >&2
      exit 1
    elif [ "$state" = "gone" ]; then
      echo "ob-backup: lost access to the backup status; check the dashboard" >&2
      exit 1
    else
      echo "ob-backup: still running after 30m; check the dashboard" >&2
      exit 1
    fi
    ;;
  list)
    out=$(request GET /api/backup)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '.backups[] |
      "\(.id)  \(.totalBytes) bytes  \(.trigger)\(if .label then " (" + .label + ")" else "" end)\(if .hasControlDb then " +control-db" else "" end)"'
    ;;
  show)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request GET "/api/backup/$(urlencode "$1")")
    fail_on_error "$out"
    printf '%s' "$out" | jq '.run.manifest // .manifest'
    ;;
  restore)
    [ $# -eq 1 ] || { usage; exit 2; }
    backup_id="$1"
    body=$(jq -n --arg id "$backup_id" '{action: "restore", backupId: $id}')
    out=$(request POST /api/reset-requests "$body")
    fail_on_error "$out"
    request_id=$(printf '%s' "$out" | jq -r '.id')
    echo "restore of backup $backup_id requested."
    echo "Waiting for the user to approve it in the open-bot dashboard (password required)..."
    POLLFILE="$(mktemp)"
    trap 'rm -f "$POLLFILE"' EXIT
    status=$(poll_field "/api/reset-requests/$(urlencode "$request_id")" '.status // empty' "approved denied expired" 330)
    case "$status" in
      approved)
        echo "Approved. The desktop is being restored and will restart."
        echo "This session ends now. The dashboard shows the result."
        ;;
      denied)
        echo "ob-backup: the user denied the restore" >&2
        exit 1
        ;;
      expired)
        echo "ob-backup: the request was not approved in time and expired" >&2
        exit 1
        ;;
      gone)
        echo "The request is no longer visible (an approval tears this desktop"
        echo "down, which invalidates this session's token). The dashboard"
        echo "shows the outcome."
        ;;
      *)
        echo "ob-backup: no decision after 5.5 minutes; request expired" >&2
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
