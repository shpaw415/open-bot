#!/bin/sh
# ob-group — manage the skills/MCP directories (labeled groups) from the
# dashboard's Skills and MCP tabs. Organization only: membership never
# changes which skills or servers a persona allowlist can pick.
# Talks to the open-bot control plane; never prints the auth token.
set -eu

BASE="${OPEN_BOT_CONTROL_URL:-http://open-bot:8787}"
TOKEN="${OPEN_BOT_LLM_TOKEN:?OPEN_BOT_LLM_TOKEN is not set}"

usage() {
  cat >&2 <<'EOF'
Usage:
  ob-group list --kind skill|mcp
  ob-group add --kind skill|mcp --label LABEL
  ob-group rename --kind skill|mcp ID --label LABEL
  ob-group delete [--kind skill|mcp] ID
  ob-group assign --kind skill|mcp ID NAME [NAME...]
  ob-group unassign --kind skill|mcp NAME [NAME...]

Directories are dashboard labels for organizing the skills/MCP lists;
users see them as collapsible sections and can batch-allow a whole
directory in a persona allowlist. `delete` keeps the skills/servers —
their members fall back to Ungrouped. `unassign` needs no directory id.
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
    echo "ob-group: $msg" >&2
    exit 1
  fi
}

urlencode() {
  printf '%s' "$1" | jq -sRr @uri
}

# Names arrive as separate argv words; emit a JSON string array.
names_json() {
  printf '%s\n' "$@" | jq -R . | jq -s .
}

[ $# -ge 1 ] || { usage; exit 2; }
cmd="$1"
shift

kind=""
label=""
dir_id=""
names=""

while [ $# -gt 0 ]; do
  case "$1" in
    --kind)
      [ $# -ge 2 ] || { usage; exit 2; }
      kind="$2"; shift 2 ;;
    --label)
      [ $# -ge 2 ] || { usage; exit 2; }
      label="$2"; shift 2 ;;
    --*)
      echo "unknown option: $1" >&2; usage; exit 2 ;;
    *)
      if [ -z "$dir_id" ]; then dir_id="$1"; else names="$names $1"; fi
      shift 1 ;;
  esac
done

case "$cmd" in
  list)
    [ "$kind" = "skill" ] || [ "$kind" = "mcp" ] || { usage; exit 2; }
    out=$(request GET "/api/catalog/dirs?kind=$kind")
    fail_on_error "$out"
    # Directories first, then each directory's members from the same payload.
    printf '%s' "$out" | jq -r '
      .dirs as $dirs | .items as $items
      | ($items | map(select(.dirId == null) | .name) | join(", ")) as $free
      | (if $free == "" then empty else "Ungrouped: \($free)" end),
        ($dirs[] as $d
         | ($items | map(select(.dirId == $d.id) | .name) | join(", ")) as $m
         | "- \($d.label) [\($d.id)]" + (if $m == "" then "" else "\n    \($m)" end))
    '
    ;;
  add)
    [ "$kind" = "skill" ] || [ "$kind" = "mcp" ] || { usage; exit 2; }
    [ -n "$label" ] || { usage; exit 2; }
    body=$(jq -n --arg kind "$kind" --arg label "$label" '{kind: $kind, label: $label}')
    out=$(request POST /api/catalog/dirs "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{id: .id, kind: .kind, label: .label}'
    ;;
  rename)
    [ "$kind" = "skill" ] || [ "$kind" = "mcp" ] || { usage; exit 2; }
    [ -n "$dir_id" ] && [ -n "$label" ] || { usage; exit 2; }
    body=$(jq -n --arg label "$label" '{label: $label}')
    out=$(request PUT "/api/catalog/dirs/$(urlencode "$dir_id")" "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{id: .id, label: .label}'
    ;;
  delete)
    [ -n "$dir_id" ] || { usage; exit 2; }
    out=$(request DELETE "/api/catalog/dirs/$(urlencode "$dir_id")")
    fail_on_error "$out"
    echo "deleted directory $dir_id; its members moved to Ungrouped"
    ;;
  assign)
    [ "$kind" = "skill" ] || [ "$kind" = "mcp" ] || { usage; exit 2; }
    [ -n "$dir_id" ] && [ -n "$names" ] || { usage; exit 2; }
    # shellcheck disable=SC2086
    body=$(jq -n --arg kind "$kind" --arg dirId "$dir_id" \
      --argjson names "$(names_json $names)" \
      '{kind: $kind, names: $names, dirId: $dirId}')
    out=$(request PUT /api/catalog/dirs/assign "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '"assigned " + (.names | length | tostring) + " item(s) to " + (.dirId // "ungrouped")'
    ;;
  unassign)
    [ "$kind" = "skill" ] || [ "$kind" = "mcp" ] || { usage; exit 2; }
    [ -n "$names" ] || { usage; exit 2; }
    # shellcheck disable=SC2086
    body=$(jq -n --arg kind "$kind" \
      --argjson names "$(names_json $names)" \
      '{kind: $kind, names: $names, dirId: null}')
    out=$(request PUT /api/catalog/dirs/assign "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '"unassigned " + (.names | length | tostring) + " item(s)"'
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2; usage; exit 2
    ;;
esac
