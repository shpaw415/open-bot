#!/bin/sh
set -u
dir=/run/open-bot/screens
[ -d "$dir" ] || exit 0
for path in "$dir"/*; do
  [ -d "$path" ] || continue
  session=$(basename "$path")
  display=$(cat "$path/display" 2>/dev/null || true)
  pid=$(cat "$path/xvfb.pid" 2>/dev/null || true)
  [ -n "$display" ] || continue
  [ -n "$pid" ] || continue
  kill -0 "$pid" 2>/dev/null || continue
  [ -S "/tmp/.X11-unix/X$display" ] || continue
  echo "$session $display"
done
