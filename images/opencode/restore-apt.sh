#!/bin/sh
set -u
baseline=/opt/open-bot/apt-baseline
extra=/home/agent/.open-bot/apt-extra
snapshot=/home/agent/.open-bot/apt-manual-snapshot
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
if [ ! -s "$missing" ]; then
  rm -f "$missing"
  exit 0
fi
# Lock::Timeout makes a concurrent apt run (plugin setup commands) win the
# lock; we wait for it instead of failing the restore.
apt-get -o DPkg::Lock::Timeout=600 update &&
  xargs -r -a "$missing" apt-get install -y --no-install-recommends -o DPkg::Lock::Timeout=600
status=$?
rm -f "$missing"
exit "$status"
