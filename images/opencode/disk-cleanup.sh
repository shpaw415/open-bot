#!/bin/sh
# Daily disk housekeeping for the desktop home volume. Deletes stale
# per-thread chromium profiles and package caches. Never touches chat
# history (~/.local/share/opencode), the canonical browser profile
# (~/.config/chromium), or the media vault. Print one JSON summary line;
# appends it to ~/.open-bot/cleanup.log unless --dry-run.
# Usage: disk-cleanup.sh [--age-days N] [--dry-run]
set -u
home=${OB_CHROME_HOME:-/home/agent}
root_home=${OB_ROOT_HOME:-/root}
tmp_dir=${OB_TMP_DIR:-/tmp}
screen_list=${OB_SCREEN_LIST:-/opt/open-bot/screen-list.sh}
age_days=3
dry_run=0
while [ $# -gt 0 ]; do
  case "$1" in
    --age-days)
      if [ ! "${2:-}" ] || [ "${2:-}" = "${2#[0-9]*}" ] || [ -n "$(printf %s "${2:-}" | tr -d '0-9')" ]; then
        echo "--age-days needs a number" >&2
        exit 2
      fi
      age_days=$2
      shift 2
      ;;
    --age-days=*)
      value=${1#--age-days=}
      if [ -z "$value" ] || [ -n "$(printf %s "$value" | tr -d '0-9')" ]; then
        echo "--age-days needs a number" >&2
        exit 2
      fi
      age_days=$value
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    *)
      echo "usage: disk-cleanup.sh [--age-days N] [--dry-run]" >&2
      exit 2
      ;;
  esac
done

cutoff_min=$((age_days * 1440))
threads_cfg=$home/.config/chromium-threads
threads_cache=$home/.cache/chromium-threads
apps_chrome=$home/.config/apps/chrome

running=$(sh "$screen_list" 2>/dev/null | awk '{print $1}')
is_running() {
  name=$1
  for s in $running; do
    [ "$name" = "$s" ] && return 0
    case "$name" in
      "$s"-*) return 0 ;;
    esac
  done
  return 1
}

stale() {
  path=$1
  name=$2
  [ -d "$path" ] || return 1
  is_running "$name" && return 1
  pgrep -f -- "user-data-dir=$path" >/dev/null 2>&1 && return 1
  find "$path" -maxdepth 0 -mmin +"$cutoff_min" 2>/dev/null | grep -q . || return 1
  return 0
}

freed=0
pruned=0
prune_dir() {
  path=$1
  bytes=$(du -sb "$path" 2>/dev/null | cut -f1)
  bytes=${bytes:-0}
  if [ "$dry_run" = 1 ]; then
    echo "would remove $path ($bytes bytes)" >&2
  else
    rm -rf "$path"
  fi
  freed=$((freed + bytes))
  pruned=$((pruned + 1))
}

wipe() {
  path=$1
  [ -e "$path" ] || return 0
  bytes=$(du -sb "$path" 2>/dev/null | cut -f1)
  bytes=${bytes:-0}
  if [ "$dry_run" = 1 ]; then
    echo "would wipe $path ($bytes bytes)" >&2
  else
    rm -rf "$path"
  fi
  freed=$((freed + bytes))
}

for dir in "$threads_cfg"/* "$threads_cache"/* "$apps_chrome"/*; do
  stale "$dir" "$(basename "$dir")" && prune_dir "$dir"
done

wipe "$home/.bun/install/cache"
wipe "$home/.npm/_cacache"
wipe "$home/.npm/_logs"
wipe "$home/.cache/pip"
wipe "$root_home/.bun/install/cache"

# Truncate runaway logs instead of deleting them so open writers keep working.
find "$tmp_dir" -maxdepth 1 -name 'open-bot-*.log' -type f -size +5M \
  -exec sh -c 'for f; do : >"$f"; done' _ {} + 2>/dev/null
find "$home/.open-bot" -maxdepth 2 -name '*.log' -type f -size +5M \
  -exec sh -c 'for f; do : >"$f"; done' _ {} + 2>/dev/null
# Drop XDG runtime dirs whose display is gone (they hold only sockets/pids).
for dir in "$tmp_dir"/open-bot-runtime-*; do
  [ -d "$dir" ] || continue
  display=${dir##*-}
  case $display in
    '' | *[!0-9]*) continue ;;
  esac
  [ -S "$tmp_dir/.X11-unix/X$display" ] && continue
  if [ "$dry_run" = 1 ]; then
    echo "would remove $dir" >&2
  else
    rm -rf "$dir"
  fi
done

mkdir -p "$home/.open-bot"
log=$home/.open-bot/cleanup.log
if [ -f "$log" ] && [ "$(wc -c <"$log")" -gt 1048576 ]; then
  tail -c 262144 "$log" >"$log.tmp" && mv "$log.tmp" "$log"
fi
line=$(printf '{"at":%s,"ageDays":%s,"dryRun":%s,"freedBytes":%s,"pruned":%s}' \
  "$(date +%s)" "$age_days" "$dry_run" "$freed" "$pruned")
printf '%s\n' "$line"
if [ "$dry_run" != 1 ]; then
  printf '%s\n' "$line" >>"$log"
fi
