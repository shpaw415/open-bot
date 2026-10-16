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
  # The recorded pid can go stale while the screen lives (wrapper exit, pid
  # churn); keep the session listed only when both its X server and its own
  # Chromium are actually running, so stale rows never double-book a display.
  if ! kill -0 "$pid" 2>/dev/null; then
    pgrep -f "^Xvfb :$display " >/dev/null 2>&1 || continue
    pgrep -f "user-data-dir=/home/agent/.config/chromium-threads/$session" >/dev/null 2>&1 || continue
  fi
  [ -S "/tmp/.X11-unix/X$display" ] || continue
  # Last CLI-driven activity (screen-up/heal touch this); the control plane
  # merges it with its DB stamp so a busy agent's screen is never the LRU
  # victim. 0 when the stamp is missing (pre-update images).
  stamp=$(stat -c %Y "$path/last-active" 2>/dev/null || echo 0)
  echo "$session $display $stamp"
done
