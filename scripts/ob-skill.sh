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
  # --max-time: a save can legitimately spend ~25 s server-side (indexing
  # gates); 90 s is the hard stop so the CLI never hangs forever on a
  # wedged control plane.
  if [ -n "$body" ]; then
    curl -sS --max-time 90 -X "$method" -H "Authorization: Bearer $TOKEN" \
      -H "content-type: application/json" -d "$body" "$BASE$path"
  else
    curl -sS --max-time 90 -X "$method" -H "Authorization: Bearer $TOKEN" "$BASE$path"
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
    # Reading a terminal stdin blocks forever waiting for EOF (field
    # 2026-11-07: `save --file -` typed without a pipe hung the CLI).
    if [ -t 0 ]; then
      echo "ob-skill: --file - reads piped stdin, but stdin is a terminal — pipe into the command or use --body TEXT" >&2
      exit 2
    fi
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
    msg=$(printf '%s' "$out" | jq -r '.error // empty' 2>/dev/null) || msg=""
    if [ -n "$msg" ]; then
      case "$msg" in
        *"not found"*|*"Not found"*)
          echo "ob-skill: $msg (if this follows a save within seconds, OpenViking may still be indexing — retry shortly)" >&2
          ;;
        *)
          echo "ob-skill: $msg" >&2
          ;;
      esac
      exit 1
    fi
    printf '%s' "$out" | jq -r '"# " + .name + " — " + .description, "", .body'
    ;;
  save)
    [ -n "$name" ] && [ "$pos_count" -eq 1 ] && [ -n "$description" ] || { usage; exit 2; }
    content=$(read_body)
    body=$(jq -n --arg name "$name" --arg description "$description" \
      --arg body "$content" '{name: $name, description: $description, body: $body}')
    out=$(request PUT /api/skills "$body")
    fail_on_error "$out"
    confirmed=$(printf '%s' "$out" | jq -r 'if .confirmed == false then "false" else "true" end' 2>/dev/null) || confirmed="true"
    index_note=""
    if [ "$confirmed" = "false" ]; then
      index_note=" (OpenViking is still indexing — ob-skill get may 404 for a few seconds; the write is durable, do not retry)"
    fi
    if [ -n "$group_label" ]; then
      assign_group "$name" "$group_label"
      echo "saved $name (group: $group_label)$index_note"
    else
      echo "saved $name$index_note"
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
