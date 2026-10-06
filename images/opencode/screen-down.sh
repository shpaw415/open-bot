#!/bin/sh
set -u
session=${1:-}
purge=0
if [ "${2:-}" = "--purge" ]; then
  purge=1
fi
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

run_dir=/run/open-bot/screens/$session
display=""
if [ -f "$run_dir/display" ]; then
  display=$(cat "$run_dir/display")
fi
if [ -d "$run_dir" ]; then
  for name in xvfb openbox chromium; do
    if [ -f "$run_dir/$name.pid" ]; then
      pid=$(cat "$run_dir/$name.pid")
      kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$run_dir"
fi
profile=/home/agent/.config/chromium-threads/$session
pkill -f "user-data-dir=$profile" 2>/dev/null || true
if [ -n "$display" ]; then
  pkill -f "Xvfb :$display " 2>/dev/null || true
  rm -f "/tmp/.X11-unix/X$display"
fi
if [ "$purge" -eq 1 ]; then
  rm -rf "$profile"
fi
echo ok
