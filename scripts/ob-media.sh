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
  ob-media remove ITEM_ID [--source]
  ob-media remove-album ALBUM_ID [--source]

PATH is an existing file under /home/agent. ~ and relative paths are expanded
first. The vault keeps its own copy. Removing an item or album deletes the
vault copy; add --source to also delete the desktop file, freeing desktop
disk (the desktop must be running, and secret paths like .ssh are refused).
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
    id=""
    source=""
    for arg in "$@"; do
      case "$arg" in
        --source) source=1 ;;
        *) id="$arg" ;;
      esac
    done
    [ -n "$id" ] || { usage; exit 2; }
    flag=""
    [ -n "$source" ] && flag="?source=1"
    out=$(request DELETE "/api/media/items/$(urlencode "$id")$flag")
    fail_on_error "$out"
    warn=$(printf '%s' "$out" | jq -r '.warnings | join("; ")' 2>/dev/null) || warn=""
    if [ -n "$warn" ]; then
      echo "ob-media: removed from the vault, but: $warn" >&2
      exit 1
    fi
    if [ -n "$source" ]; then
      echo "removed $id from the vault and deleted the desktop file"
    else
      echo "removed $id from the vault; the desktop file was kept"
    fi
    ;;
  remove-album)
    id=""
    source=""
    for arg in "$@"; do
      case "$arg" in
        --source) source=1 ;;
        *) id="$arg" ;;
      esac
    done
    [ -n "$id" ] || { usage; exit 2; }
    flag=""
    [ -n "$source" ] && flag="?source=1"
    out=$(request DELETE "/api/media/albums/$(urlencode "$id")$flag")
    fail_on_error "$out"
    warn=$(printf '%s' "$out" | jq -r '.warnings | join("; ")' 2>/dev/null) || warn=""
    if [ -n "$warn" ]; then
      echo "ob-media: removed from the vault, but: $warn" >&2
      exit 1
    fi
    if [ -n "$source" ]; then
      count=$(printf '%s' "$out" | jq -r '.sourceDeleted // 0' 2>/dev/null) || count=0
      echo "removed album $id and deleted $count desktop file(s)"
    else
      echo "removed album $id; desktop files were kept"
    fi
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2; usage; exit 2
    ;;
esac
