#!/bin/sh
set -u
baseline=${OPEN_BOT_APT_BASELINE:-/opt/open-bot/apt-baseline}
extra=${OPEN_BOT_APT_EXTRA:-/home/agent/.open-bot/apt-extra}
snapshot=${OPEN_BOT_APT_SNAPSHOT:-/home/agent/.open-bot/apt-manual-snapshot}
list=$(mktemp)
missing=$(mktemp)
: >"$list"
if [ -s "$extra" ]; then
  cat "$extra" >>"$list"
fi
if [ -s "$snapshot" ] && [ -f "$baseline" ]; then
  comm -13 "$baseline" "$snapshot" >>"$list"
fi
LC_ALL=C sort -u "$list" -o "$list"
: >"$missing"
while IFS= read -r pkg; do
  [ -n "$pkg" ] || continue
  case "$pkg" in
    *[!A-Za-z0-9.+-]*) continue ;;
  esac
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then
    echo "$pkg" >>"$missing"
  fi
done <"$list"
rm -f "$list"
# Refresh the package indexes on every boot, even with nothing to install:
# the image ships with the apt lists deleted, so a fresh desktop's first
# `sudo apt-get install` would otherwise fail with "Unable to locate
# package". Lock::Timeout makes a concurrent apt run (plugin setup
# commands) win the lock; we wait for it instead of failing the restore.
apt-get -o DPkg::Lock::Timeout=600 update
status=$?
if [ "$status" -ne 0 ]; then
  rm -f "$missing"
  exit "$status"
fi
if [ -s "$missing" ]; then
  xargs -r -a "$missing" apt-get install -y --no-install-recommends -o DPkg::Lock::Timeout=600
  status=$?
fi
rm -f "$missing"
exit "$status"
