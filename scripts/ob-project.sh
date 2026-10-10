#!/bin/sh
# ob-project — register a desktop folder in the dashboard project list.
# Talks to the open-bot control plane; never prints the auth token.
set -eu

BASE="${OPEN_BOT_CONTROL_URL:-http://open-bot:8787}"
TOKEN="${OPEN_BOT_LLM_TOKEN:?OPEN_BOT_LLM_TOKEN is not set}"
# Desktop home. Tests may point this at a temp tree; the control plane still
# rejects anything that is not under /home/agent.
ROOT="${OPEN_BOT_PROJECT_ROOT:-/home/agent}"

usage() {
  cat >&2 <<'EOF'
Usage:
  ob-project list
  ob-project add --path PATH [--name NAME]
  ob-project remove ID

PATH is an existing directory. ~ and relative paths are expanded first.
The folder must be under /home/agent. Removing a project keeps its files.
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
    echo "ob-project: $msg" >&2
    exit 1
  fi
}

urlencode() {
  printf '%s' "$1" | jq -sRr @uri
}

resolve_path() {
  raw="$1"
  case "$raw" in
    "~") raw="${HOME:-}" ;;
    "~/"*) raw="${HOME:-}/${raw#"~/"}" ;;
  esac
  [ -n "$raw" ] || {
    echo "ob-project: a path is required" >&2
    exit 1
  }
  case "$raw" in
    /*) ;;
    *) raw="${PWD%/}/$raw" ;;
  esac
  if [ ! -d "$raw" ]; then
    echo "ob-project: folder does not exist: $raw" >&2
    exit 1
  fi
  canonical=$(realpath -e -- "$raw") || {
    echo "ob-project: folder does not exist: $raw" >&2
    exit 1
  }
  case "$canonical" in
    "$ROOT"|"$ROOT/")
      echo "ob-project: the folder must be under /home/agent" >&2
      exit 1
      ;;
    "$ROOT"/*) ;;
    *)
      echo "ob-project: the folder must be under /home/agent" >&2
      exit 1
      ;;
  esac
  printf '%s\n' "$canonical"
}

[ $# -ge 1 ] || { usage; exit 2; }
cmd="$1"
shift

case "$cmd" in
  list)
    out=$(request GET /api/projects)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '.projects[] | "- \(.name) [\(.id)] \(.path)"'
    ;;
  add)
    path=""
    name=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --path)
          [ $# -ge 2 ] || { usage; exit 2; }
          path="$2"; shift 2 ;;
        --name)
          [ $# -ge 2 ] || { usage; exit 2; }
          name="$2"; shift 2 ;;
        *)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    [ -n "$path" ] || { usage; exit 2; }
    resolved=$(resolve_path "$path") || exit 1
    if [ -n "$name" ]; then
      body=$(jq -n --arg path "$resolved" --arg name "$name" \
        '{path: $path, name: $name}')
    else
      body=$(jq -n --arg path "$resolved" '{path: $path}')
    fi
    out=$(request POST /api/projects "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{id: .project.id, name: .project.name, path: .project.path}'
    ;;
  remove)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request DELETE "/api/projects/$(urlencode "$1")")
    fail_on_error "$out"
    echo "removed $1 from the project list; files were kept"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2; usage; exit 2
    ;;
esac
