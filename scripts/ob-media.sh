#!/bin/sh
# ob-media — file a desktop file into the dashboard Media vault.
# Talks to the open-bot control plane; never prints the auth token.
set -eu

BASE="${OPEN_BOT_CONTROL_URL:-http://open-bot:8787}"
TOKEN="${OPEN_BOT_LLM_TOKEN:?OPEN_BOT_LLM_TOKEN is not set}"
ROOT="${OPEN_BOT_MEDIA_ROOT:-/home/agent}"

usage() {
  cat >&2 <<'EOF'
Usage:
  ob-media albums
  ob-media album NAME
  ob-media push --album NAME --path PATH [--title TITLE]
  ob-media remove ITEM_ID
  ob-media remove-album ALBUM_ID

PATH is an existing file under /home/agent. ~ and relative paths are expanded
first. The vault keeps its own copy. Removing an item or album keeps the file
on disk.
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
    echo "ob-media: $msg" >&2
    exit 1
  fi
}

urlencode() {
  printf '%s' "$1" | jq -sRr @uri
}

resolve_file() {
  raw="$1"
  case "$raw" in
    "~") raw="${HOME:-}" ;;
    "~/"*) raw="${HOME:-}/${raw#"~/"}" ;;
  esac
  [ -n "$raw" ] || {
    echo "ob-media: a path is required" >&2
    exit 1
  }
  case "$raw" in
    /*) ;;
    *) raw="${PWD%/}/$raw" ;;
  esac
  if [ ! -f "$raw" ]; then
    echo "ob-media: file does not exist: $raw" >&2
    exit 1
  fi
  canonical=$(realpath -e -- "$raw") || {
    echo "ob-media: file does not exist: $raw" >&2
    exit 1
  }
  case "$canonical" in
    "$ROOT"/*) ;;
    *)
      echo "ob-media: the file must be under /home/agent" >&2
      exit 1
      ;;
  esac
  printf '%s\n' "$canonical"
}

[ $# -ge 1 ] || { usage; exit 2; }
cmd="$1"
shift

case "$cmd" in
  albums)
    out=$(request GET /api/media/albums)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '.albums[] | "- \(.name) [\(.id)] \(.count)"'
    ;;
  album)
    [ $# -ge 1 ] || { usage; exit 2; }
    name="$*"
    body=$(jq -n --arg name "$name" '{name: $name}')
    out=$(request POST /api/media/albums "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{id: .album.id, name: .album.name, created: .created}'
    ;;
  push)
    album=""
    path=""
    title=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --album)
          [ $# -ge 2 ] || { usage; exit 2; }
          album="$2"; shift 2 ;;
        --path)
          [ $# -ge 2 ] || { usage; exit 2; }
          path="$2"; shift 2 ;;
        --title)
          [ $# -ge 2 ] || { usage; exit 2; }
          title="$2"; shift 2 ;;
        *)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    [ -n "$album" ] && [ -n "$path" ] || { usage; exit 2; }
    resolved=$(resolve_file "$path") || exit 1
    if [ -n "$title" ]; then
      body=$(jq -n --arg album "$album" --arg path "$resolved" --arg title "$title" \
        '{album: $album, path: $path, title: $title}')
    else
      body=$(jq -n --arg album "$album" --arg path "$resolved" \
        '{album: $album, path: $path}')
    fi
    out=$(request POST /api/media/items "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{id: .item.id, name: .item.name, kind: .item.kind, skipped: .skipped}'
    ;;
  remove)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request DELETE "/api/media/items/$(urlencode "$1")")
    fail_on_error "$out"
    echo "removed $1 from the vault; the desktop file was kept"
    ;;
  remove-album)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request DELETE "/api/media/albums/$(urlencode "$1")")
    fail_on_error "$out"
    echo "removed album $1; desktop files were kept"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2; usage; exit 2
    ;;
esac
