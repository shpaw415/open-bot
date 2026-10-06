#!/bin/sh
set -u
baseline=/opt/open-bot/apt-baseline
out=/home/agent/.open-bot/apt-extra
if [ ! -f "$baseline" ]; then
  exit 0
fi
mkdir -p /home/agent/.open-bot
tmp=$(mktemp)
LC_ALL=C apt-mark showmanual | LC_ALL=C sort >"$tmp"
comm -13 "$baseline" "$tmp" >"$out"
rm -f "$tmp"
chown agent:agent "$out" 2>/dev/null || true
exit 0
