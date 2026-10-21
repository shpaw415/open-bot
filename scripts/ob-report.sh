#!/bin/sh
# ob-report — file plugin development reports on this desktop container.
# Reports are plain files under ~/.open-bot/reports shared by every session
# thread on this desktop; the dashboard Reports view reads the same files.
# Purely local: no control-plane token is involved.
set -eu

DIR="${OPEN_BOT_REPORTS_DIR:-${HOME:-/home/agent}/.open-bot/reports}"
HOURLY_LIMIT=8
HOUR_MS=3600000

usage() {
  cat >&2 <<'EOF'
Usage:
  ob-report add --plugin SLUG --kind bug|friction|feature --title TEXT --detail TEXT [--session ID]
  ob-report list [--plugin SLUG] [--status open|done|wontfix|all] [--kind KIND] [--json]
  ob-report show ID
  ob-report done ID [--note TEXT]
  ob-report wontfix ID [--note TEXT]
  ob-report open ID [--note TEXT]

ID may be the full report id or any unambiguous prefix of one.

Files one plugin report. A matching open report increments its hit count.
Reports live in ~/.open-bot/reports on this desktop and are visible from the
dashboard Reports view and to any session thread here via this command.
EOF
}

die() {
  echo "ob-report: $1" >&2
  exit 1
}

need_value() {
  [ $# -ge 2 ] || { usage; exit 2; }
}

now_ms() {
  date +%s%3N 2>/dev/null || printf '%s000' "$(date +%s)"
}

redact() {
  printf '%s' "$1" | sed -E \
    -e 's/[Bb]earer[[:space:]]+[^[:space:]]+/Bearer [redacted]/g' \
    -e 's/\b(sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/[redacted]/g' \
    -e 's/([Aa][Pp][Ii][_-]?[Kk][Ee][Yy]|[Tt][Oo][Kk][Ee][Nn]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn])[[:space:]]*[:=][[:space:]]*[^[:space:]]+/\1=[redacted]/g'
}

normalize_title() {
  printf '%s' "$1" | tr -s '[:space:]' ' ' | sed -e 's/^ //' -e 's/ $//'
}

fingerprint() {
  printf '%s\034%s\034%s' "$1" "$2" "$3" | sha256sum | cut -c1-64
}

report_field() {
  jq -r "$2 // empty" "$1" 2>/dev/null
}

write_atomic() {
  _tmp="$DIR/.tmp-$$"
  cat >"$_tmp"
  if [ ! -s "$_tmp" ]; then
    rm -f "$_tmp"
    return 1
  fi
  mv -f "$_tmp" "$1"
}

valid_kind() {
  case "$1" in
    bug|friction|feature) return 0 ;;
    *) return 1 ;;
  esac
}

valid_status() {
  case "$1" in
    open|done|wontfix) return 0 ;;
    *) return 1 ;;
  esac
}

valid_id() {
  printf '%s' "$1" | grep -qE '^[A-Za-z0-9_-]{1,64}$'
}

# RESOLVED is set to the report id: the argument itself when exact, else the
# unique id starting with it. A dead or ambiguous prefix dies here (never in a
# command substitution — die must exit the script).
resolve_id() {
  id="$1"
  if [ -f "$DIR/$id.json" ]; then
    RESOLVED="$id"
    return 0
  fi
  matches=""
  count=0
  for f in "$DIR"/*.json; do
    [ -f "$f" ] || continue
    rid=$(basename "$f" .json)
    case "$rid" in
      "$id"*)
        if [ -n "$matches" ]; then
          matches="$matches
$rid"
        else
          matches="$rid"
        fi
        count=$(( count + 1 ))
        ;;
    esac
  done
  if [ "$count" -eq 1 ]; then
    RESOLVED="$matches"
    return 0
  fi
  if [ "$count" -eq 0 ]; then
    die "no report matches $id"
  fi
  echo "ob-report: ambiguous prefix $id matches:" >&2
  printf '%s\n' "$matches" | sed 's/^/  /' >&2
  exit 1
}

new_id() {
  head -c8 /dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n' || true
}

cmd_add() {
  plugin="" kind="" title="" detail="" session=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --plugin) need_value "$@"; plugin="$2"; shift 2 ;;
      --kind) need_value "$@"; kind="$2"; shift 2 ;;
      --title) need_value "$@"; title="$2"; shift 2 ;;
      --detail) need_value "$@"; detail="$2"; shift 2 ;;
      --session) need_value "$@"; session="$2"; shift 2 ;;
      *) die "unknown option: $1 (see --help)" ;;
    esac
  done
  [ -n "$plugin" ] && [ -n "$kind" ] && [ -n "$title" ] && [ -n "$detail" ] || {
    usage; exit 2;
  }
  valid_kind "$kind" || die "kind must be bug, friction, or feature"
  printf '%s' "$plugin" | grep -qE '^[A-Za-z0-9._-]{1,64}$' || {
    die "plugin must be 1-64 letters, numbers, dot, underscore or dash";
  }
  if [ -n "$session" ]; then
    printf '%s' "$session" | grep -qE '^[A-Za-z0-9_-]{1,128}$' || {
      die "session must be 1-128 letters, numbers, _ or -";
    }
  fi
  title=$(redact "$title")
  detail=$(redact "$detail")
  title=$(normalize_title "$title")
  [ -n "$title" ] || die "title is required"
  [ ${#title} -le 120 ] || die "title must be at most 120 characters"
  [ -n "$detail" ] || die "detail is required"
  [ ${#detail} -le 4000 ] || die "detail must be at most 4000 characters"

  mkdir -p "$DIR"
  fp=$(fingerprint "$kind" "$plugin" "$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]')")
  now=$(now_ms)

  matched=""
  if [ -d "$DIR" ]; then
    for f in "$DIR"/*.json; do
      [ -f "$f" ] || continue
      [ "$(report_field "$f" '.fingerprint')" = "$fp" ] || continue
      [ "$(report_field "$f" '.status')" = "open" ] || continue
      jq --arg detail "$detail" --arg session "$session" --argjson now "$now" '
        .hits += 1
        | .lastSeenAt = $now
        | if ($detail | length) > (.detail | length) then .detail = $detail else . end
        | if $session != "" then .session = $session else . end
      ' "$f" | write_atomic "$f"
      id=$(jq -r '.id' "$f")
      hits=$(jq -r '.hits' "$f")
      printf '%s\n' "{\"id\": \"$id\", \"duplicate\": true, \"hits\": $hits}"
      echo "Filed (existing open report got a hit)." >&2
      matched=1
      break
    done
  fi
  [ -z "$matched" ] || return 0

  cutoff=$(( now - HOUR_MS ))
  count=0
  if [ -d "$DIR" ]; then
    for f in "$DIR"/*.json; do
      [ -f "$f" ] || continue
      created=$(report_field "$f" '.createdAt') || created=""
      case "$created" in
        ''|*[!0-9]*) continue ;;
      esac
      [ "$created" -ge "$cutoff" ] && count=$(( count + 1 ))
    done
  fi
  [ "$count" -lt "$HOURLY_LIMIT" ] || die "too many new reports this hour"

  id="$(new_id)"
  [ -n "$id" ] || id="$(date +%s)$$"
  seq=0
  while [ -e "$DIR/$id.json" ]; do
    seq=$(( seq + 1 ))
    id="$(date +%s)$$-$seq"
  done
  path="$DIR/$id.json"
  jq -n \
    --arg id "$id" --arg plugin "$plugin" --arg kind "$kind" \
    --arg title "$title" --arg detail "$detail" --arg session "$session" \
    --arg fp "$fp" --argjson now "$now" '
    {
      id: $id,
      plugin: $plugin,
      kind: $kind,
      title: $title,
      detail: $detail,
      session: (if $session == "" then null else $session end),
      status: "open",
      note: null,
      hits: 1,
      fingerprint: $fp,
      createdAt: $now,
      lastSeenAt: $now
    }' | write_atomic "$path"
  printf '%s\n' "{\"id\": \"$id\", \"duplicate\": false, \"hits\": 1}"
  echo "Filed." >&2
}

cmd_list() {
  status="open" plugin="" kind="" json=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --plugin) need_value "$@"; plugin="$2"; shift 2 ;;
      --status) need_value "$@"; status="$2"; shift 2 ;;
      --kind) need_value "$@"; kind="$2"; shift 2 ;;
      --json) json=1; shift ;;
      *) die "unknown option: $1 (see --help)" ;;
    esac
  done
  [ "$status" = "all" ] || valid_status "$status" || {
    die "status must be open, done, wontfix, or all";
  }
  if [ -n "$kind" ]; then
    valid_kind "$kind" || die "kind must be bug, friction, or feature"
  fi
  [ -d "$DIR" ] || return 0

  matches=""
  for f in "$DIR"/*.json; do
    [ -f "$f" ] || continue
    if [ "$status" != "all" ]; then
      [ "$(report_field "$f" '.status')" = "$status" ] || continue
    fi
    if [ -n "$plugin" ]; then
      [ "$(report_field "$f" '.plugin')" = "$plugin" ] || continue
    fi
    if [ -n "$kind" ]; then
      [ "$(report_field "$f" '.kind')" = "$kind" ] || continue
    fi
    matches="$matches$f
"
  done
  if [ -z "$matches" ]; then
    [ "$json" -eq 1 ] || echo "no reports"
    return 0
  fi

  # Generated ids only (hex or digits), so word splitting is safe here.
  # shellcheck disable=SC2046
  if [ "$json" -eq 1 ]; then
    jq -s -c 'sort_by(-.lastSeenAt)[]' $(printf '%s' "$matches" | sort -u)
  else
    jq -s -r --argjson now "$(now_ms)" '
      sort_by(-.lastSeenAt)[]
      | "- [\(.status) \(.kind)/\(.plugin)] \(.title) (hits \(.hits), \((($now - .lastSeenAt) / 60000) | floor)m ago) id=\(.id)"
    ' $(printf '%s' "$matches" | sort -u)
  fi
}

cmd_show() {
  [ $# -eq 1 ] || { usage; exit 2; }
  valid_id "$1" || die "bad report id"
  resolve_id "$1"
  path="$DIR/$RESOLVED.json"
  jq -r '"- [\(.status) \(.kind)/\(.plugin)] \(.title) (hits \(.hits)) id=\(.id)",
    (if .session then "session \(.session)" else empty end),
    .detail,
    (if .note then "note \(.note)" else empty end)' "$path"
}

cmd_status() {
  _status="$1"
  shift
  valid_status "$_status" || die "bad status"
  id="" note="" note_set=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --note) need_value "$@"; note="$2"; note_set=1; shift 2 ;;
      --*) die "unknown option: $1 (see --help)" ;;
      *) id="$1"; shift ;;
    esac
  done
  [ -n "$id" ] || { usage; exit 2; }
  valid_id "$id" || die "bad report id"
  [ ${#note} -le 2000 ] || die "note must be at most 2000 characters"
  resolve_id "$id"
  id="$RESOLVED"
  path="$DIR/$id.json"
  now=$(now_ms)
  if [ "$note_set" -eq 1 ]; then
    jq --arg status "$_status" --arg note "$note" --argjson now "$now" '
      .status = $status
      | .note = (if $note == "" then null else $note end)
      | .lastSeenAt = $now
    ' "$path" | write_atomic "$path"
  else
    jq --arg status "$_status" --argjson now "$now" '
      .status = $status | .lastSeenAt = $now
    ' "$path" | write_atomic "$path"
  fi
  echo "$_status $id"
}

[ $# -ge 1 ] || { usage; exit 2; }
cmd="$1"
shift

case "$cmd" in
  add) cmd_add "$@" ;;
  list) cmd_list "$@" ;;
  show) cmd_show "$@" ;;
  done|wontfix|open) cmd_status "$cmd" "$@" ;;
  -h|--help|help) usage ;;
  *) die "unknown command: $cmd" ;;
esac
