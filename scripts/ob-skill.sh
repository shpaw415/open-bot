#!/bin/sh
# ob-skill — create and manage the user's custom skills, and file them into
# dashboard skill groups (directories). Skills live in the desktop's
# OpenViking; groups are the Skills-tab sections (same store ob-group edits).
# Talks to the open-bot control plane; never prints the auth token.
set -eu

BASE="${OPEN_BOT_CONTROL_URL:-http://open-bot:8787}"
TOKEN="${OPEN_BOT_LLM_TOKEN:?OPEN_BOT_LLM_TOKEN is not set}"

usage() {
  cat >&2 <<'EOF'
Usage:
  ob-skill list
  ob-skill get NAME
  ob-skill save NAME --description "one line" (--file FILE|- | --body TEXT)
                      [--group LABEL]
  ob-skill rename OLD NEW
  ob-skill delete NAME
  ob-skill group NAME --label LABEL | --none

save creates or replaces a skill (same name = replace). --group files it
into the skill group LABEL, creating the group when missing — the one-call
"make a skill and put it in its group". rename keeps the group membership.
group moves one skill between groups (--none back to Ungrouped).
Skill names: kebab-case slugs, 1-64 chars, not a built-in name.
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
    echo "ob-skill: $msg" >&2
    exit 1
  fi
}

urlencode() {
  printf '%s' "$1" | jq -sRr @uri
}

# Resolve a skill-group label to its directory id, creating the group when
# missing (case-insensitive, like the dashboard's duplicate check).
dir_id_for_label() {
  label="$1"
  dirs=$(request GET "/api/catalog/dirs?kind=skill")
  fail_on_error "$dirs"
  id=$(printf '%s' "$dirs" | jq -r --arg l "$label" \
    '.dirs[] | select((.label | ascii_downcase) == ($l | ascii_downcase)) | .id' \
    | head -n 1)
  if [ -z "$id" ]; then
    made=$(request POST /api/catalog/dirs \
      "$(jq -n '{kind: "skill", label: $label}' --arg label "$label")")
    fail_on_error "$made"
    id=$(printf '%s' "$made" | jq -r '.id')
  fi
  printf '%s' "$id"
}

assign_group() {
  name="$1"
  label="$2"
  if [ "$label" = "none" ]; then
    body=$(jq -n --arg name "$name" \
      '{kind: "skill", names: [$name], dirId: null}')
  else
    dir_id=$(dir_id_for_label "$label")
    body=$(jq -n --arg name "$name" --arg dirId "$dir_id" \
      '{kind: "skill", names: [$name], dirId: $dirId}')
  fi
  out=$(request PUT /api/catalog/dirs/assign "$body")
  fail_on_error "$out"
}

read_body() {
  if [ -n "$body_text" ] && [ -n "$file" ]; then
    echo "ob-skill: pass only one of --body or --file" >&2
    exit 2
  fi
  if [ -n "$body_text" ]; then
    printf '%s' "$body_text"
    return
  fi
  if [ "$file" = "-" ]; then
    cat
  elif [ -n "$file" ]; then
    cat "$file"
  else
    echo "ob-skill: --file FILE|- or --body TEXT is required" >&2
    exit 2
  fi
}

[ $# -ge 1 ] || { usage; exit 2; }
cmd="$1"
shift

description=""
group_label=""
body_text=""
file=""
pos_count=0
name=""
old_name=""

while [ $# -gt 0 ]; do
  case "$1" in
    --description)
      [ $# -ge 2 ] || { usage; exit 2; }
      description="$2"; shift 2 ;;
    --group)
      [ $# -ge 2 ] || { usage; exit 2; }
      group_label="$2"; shift 2 ;;
    --body)
      [ $# -ge 2 ] || { usage; exit 2; }
      body_text="$2"; shift 2 ;;
    --file)
      [ $# -ge 2 ] || { usage; exit 2; }
      file="$2"; shift 2 ;;
    --label)
      [ $# -ge 2 ] || { usage; exit 2; }
      group_label="$2"; shift 2 ;;
    --none)
      group_label="none"; shift 1 ;;
    --*)
      echo "unknown option: $1" >&2; usage; exit 2 ;;
    *)
      pos_count=$((pos_count + 1))
      case "$pos_count" in
        1) name="$1" ;;
        2) old_name="$1" ;;
        *)
          echo "unexpected argument: $1" >&2; usage; exit 2 ;;
      esac
      shift 1 ;;
  esac
done

case "$cmd" in
  list)
    out=$(request GET /api/skills)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '.skills[]
      | (if .seed then "[seed] " elif .plugin then "[plugin:" + .plugin + "] " else "" end)
        + .name
        + (if (.description // "") == "" then "" else " — " + .description end)
        + (if .group then "  (group: " + .group + ")" else "" end)'
    ;;
  get)
    [ -n "$name" ] && [ "$pos_count" -eq 1 ] || { usage; exit 2; }
    out=$(request GET "/api/skills?name=$(urlencode "$name")")
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '"# " + .name + " — " + .description, "", .body'
    ;;
  save)
    [ -n "$name" ] && [ "$pos_count" -eq 1 ] && [ -n "$description" ] || { usage; exit 2; }
    content=$(read_body)
    body=$(jq -n --arg name "$name" --arg description "$description" \
      --arg body "$content" '{name: $name, description: $description, body: $body}')
    out=$(request PUT /api/skills "$body")
    fail_on_error "$out"
    if [ -n "$group_label" ]; then
      assign_group "$name" "$group_label"
      echo "saved $name (group: $group_label)"
    else
      echo "saved $name"
    fi
    ;;
  rename)
    [ -n "$name" ] && [ "$pos_count" -eq 2 ] || { usage; exit 2; }
    new_name="$old_name"
    out=$(request GET "/api/skills?name=$(urlencode "$name")")
    fail_on_error "$out"
    prev_description=$(printf '%s' "$out" | jq -r '.description')
    prev_body=$(printf '%s' "$out" | jq -r '.body')
    body=$(jq -n --arg name "$new_name" --arg description "$prev_description" \
      --arg body "$prev_body" --arg previousName "$name" \
      '{name: $name, description: $description, body: $body, previousName: $previousName}')
    out=$(request PUT /api/skills "$body")
    fail_on_error "$out"
    echo "renamed $name to $new_name (group membership kept)"
    ;;
  delete)
    [ -n "$name" ] && [ "$pos_count" -eq 1 ] || { usage; exit 2; }
    body=$(jq -n --arg name "$name" '{name: $name}')
    out=$(request DELETE /api/skills "$body")
    fail_on_error "$out"
    echo "deleted $name"
    ;;
  group)
    [ -n "$name" ] && [ "$pos_count" -eq 1 ] && [ -n "$group_label" ] || { usage; exit 2; }
    assign_group "$name" "$group_label"
    if [ "$group_label" = "none" ]; then
      echo "moved $name to Ungrouped"
    else
      echo "moved $name to group $group_label"
    fi
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2; usage; exit 2
    ;;
esac
