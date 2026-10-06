#!/bin/sh
set -eu
root=${OB_CHROME_HOME:-/home/agent}
canonical=$root/.config/chromium
threads=$root/.config/chromium-threads
cmd=${1:-}
session=${2:-}

if [ "${#session}" -gt 128 ]; then
  echo "bad session" >&2
  exit 1
fi
case "$session" in
  *[!A-Za-z0-9_-]* | "")
    echo "bad session" >&2
    exit 1
    ;;
esac
case "$cmd" in
  pull | push) ;;
  *)
    echo "usage: sync-chromium.sh pull|push SESSION" >&2
    exit 2
    ;;
esac

stamp() {
  local dir=$1
  local best=0
  local rel file modified
  for rel in Default/Network/Cookies Default/Cookies Default/Preferences "Default/Login Data"; do
    file=$dir/$rel
    if [ -f "$file" ]; then
      modified=$(stat -c %Y "$file")
      if [ "$modified" -gt "$best" ]; then
        best=$modified
      fi
    fi
  done
  echo "$best"
}

empty() {
  local dir=$1
  [ ! -f "$dir/Default/Network/Cookies" ] &&
    [ ! -f "$dir/Default/Cookies" ] &&
    [ ! -f "$dir/Default/Preferences" ] &&
    [ ! -f "$dir/Default/Login Data" ]
}

backup_db() {
  local src=$1
  local dst=$2
  local bak
  if [ ! -f "$src" ]; then
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  if command -v sqlite3 >/dev/null 2>&1; then
    bak=${dst}.sync
    rm -f "$bak"
    if sqlite3 "$src" ".backup '$bak'"; then
      mv "$bak" "$dst"
      rm -f "${dst}-wal" "${dst}-shm"
      return 0
    fi
    rm -f "$bak"
  fi
  cp -a "$src" "$dst"
}

copy_profile() {
  local src=$1
  local dst=$2
  local rel
  mkdir -p "$dst"
  cp -a "$src/." "$dst/"
  rm -f "$dst/SingletonLock" "$dst/SingletonCookie" "$dst/SingletonSocket" "$dst/lockfile"
  find "$dst" -name 'Singleton*' -delete 2>/dev/null || true
  find "$dst" -name '*.lock' -delete 2>/dev/null || true
  rm -rf \
    "$dst/Crash Reports" \
    "$dst/BrowserMetrics" \
    "$dst/ShaderCache" \
    "$dst/GrShaderCache" \
    "$dst/GraphiteDawnCache" \
    "$dst/DawnGraphiteCache" \
    "$dst/Default/Cache" \
    "$dst/Default/Code Cache" \
    "$dst/Default/GPUCache" \
    "$dst/Default/Service Worker/CacheStorage"
  for rel in Default/Network/Cookies Default/Cookies "Default/Login Data" "Default/Login Data For Account" "Default/Web Data"; do
    backup_db "$src/$rel" "$dst/$rel"
  done
  chown -R agent:agent "$dst" 2>/dev/null || true
}

replace_tree() {
  local src=$1
  local dst=$2
  local stage=${dst}.next
  local prev=${dst}.prev
  rm -rf "$stage" "$prev"
  copy_profile "$src" "$stage"
  if [ -d "$dst" ]; then
    mv "$dst" "$prev"
  fi
  mv "$stage" "$dst"
  rm -rf "$prev"
}

pull() {
  local target=$threads/$session
  mkdir -p "$target"
  if ! empty "$target"; then
    return 0
  fi
  local best=""
  local best_m=0
  consider() {
    local dir=$1
    local modified
    if [ ! -d "$dir" ] || empty "$dir"; then
      return 0
    fi
    modified=$(stamp "$dir")
    if [ "$modified" -gt "$best_m" ]; then
      best=$dir
      best_m=$modified
    fi
  }
  consider "$canonical"
  if [ -d "$threads" ]; then
    for dir in "$threads"/*; do
      if [ ! -d "$dir" ]; then
        continue
      fi
      if [ "$(basename "$dir")" = "$session" ]; then
        continue
      fi
      consider "$dir"
    done
  fi
  if [ -z "$best" ]; then
    return 0
  fi
  copy_profile "$best" "$target"
  if [ "$best" != "$canonical" ]; then
    local canon_m=0
    if [ -d "$canonical" ]; then
      canon_m=$(stamp "$canonical")
    fi
    if [ "$best_m" -gt "$canon_m" ]; then
      replace_tree "$best" "$canonical"
    fi
  fi
}

push() {
  local src=$threads/$session
  if [ ! -d "$src" ] || empty "$src"; then
    return 0
  fi
  local modified
  local canon_m=0
  modified=$(stamp "$src")
  if [ -d "$canonical" ]; then
    canon_m=$(stamp "$canonical")
  fi
  if [ "$modified" -ge "$canon_m" ]; then
    replace_tree "$src" "$canonical"
  fi
}

case "$cmd" in
  pull) pull ;;
  push) push ;;
esac
