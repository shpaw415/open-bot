#!/bin/sh
# ob-persona — manage bot personalities from inside the desktop container.
# Talks to the open-bot control plane; never prints the auth token.
set -eu

BASE="${OPEN_BOT_CONTROL_URL:-http://open-bot:8787}"
TOKEN="${OPEN_BOT_LLM_TOKEN:?OPEN_BOT_LLM_TOKEN is not set}"

usage() {
  cat >&2 <<'EOF'
Usage:
  ob-persona list [--verbose]
  ob-persona add --name NAME --instruction TEXT
  ob-persona update ID [--name NAME] [--instruction TEXT | --append TEXT]
  ob-persona remove ID

Creating or editing a personality does not change the current thread.
The user starts a new thread and picks it.
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
    echo "ob-persona: $msg" >&2
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
  list)
    verbose=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --verbose) verbose=1; shift ;;
        *) echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    out=$(request GET /api/personas)
    fail_on_error "$out"
    if [ -n "$verbose" ]; then
      printf '%s' "$out" | jq -r '.personas[] |
        "- \(.name) [\(.id)]\(if .builtin then " built-in" else "" end) \(.instruction)"'
    else
      printf '%s' "$out" | jq -r '.personas[] |
        (if .builtin then "- \(.name) [\(.id)] built-in" else "- \(.name) [\(.id)]" end) +
        (if (.instruction // "") == "" then "" else
          " — " + ((.instruction | gsub("\\s+"; " ")) as $t |
            if ($t | length) > 80 then ($t[:79] + "…") else $t end)
        end)'
    fi
    ;;
  add)
    name=""
    instruction=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --name)
          [ $# -ge 2 ] || { usage; exit 2; }
          name="$2"; shift 2 ;;
        --instruction)
          [ $# -ge 2 ] || { usage; exit 2; }
          instruction="$2"; shift 2 ;;
        *)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    [ -n "$name" ] && [ -n "$instruction" ] || { usage; exit 2; }
    body=$(jq -n --arg name "$name" --arg instruction "$instruction" \
      '{name: $name, instruction: $instruction}')
    out=$(request POST /api/personas "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{id, name}'
    echo "Saved. Start a new thread and pick it. This thread is unchanged."
    ;;
  update)
    [ $# -ge 1 ] || { usage; exit 2; }
    id="$1"
    shift
    name=""
    instruction=""
    append=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --name)
          [ $# -ge 2 ] || { usage; exit 2; }
          name="$2"; shift 2 ;;
        --instruction)
          [ $# -ge 2 ] || { usage; exit 2; }
          instruction="$2"; shift 2 ;;
        --append)
          [ $# -ge 2 ] || { usage; exit 2; }
          append="$2"; shift 2 ;;
        *)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    if [ -n "$append" ]; then
      if [ -n "$instruction" ]; then
        echo "ob-persona: use --instruction or --append, not both" >&2
        exit 2
      fi
      out=$(request GET /api/personas)
      fail_on_error "$out"
      instruction=$(printf '%s' "$out" | jq -r --arg id "$id" \
        '.personas[] | select(.id == $id) | .instruction // ""')
      if [ -z "$instruction" ]; then
        echo "ob-persona: persona not found: $id" >&2
        exit 1
      fi
      instruction="$instruction
$append"
    fi
    [ -n "$name" ] || [ -n "$instruction" ] || { usage; exit 2; }
    body=$(jq -n --arg name "$name" --arg instruction "$instruction" \
      'if $name != "" then .name = $name else . end | if $instruction != "" then .instruction = $instruction else . end')
    out=$(request PUT "/api/personas/$(urlencode "$id")" "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{id, name}'
    echo "Updated. Start a new thread to use it. This thread is unchanged."
    ;;
  remove)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request DELETE "/api/personas/$(urlencode "$1")")
    fail_on_error "$out"
    echo "removed $1"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2; usage; exit 2
    ;;
esac
