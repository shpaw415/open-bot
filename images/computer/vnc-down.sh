#!/bin/sh
set -u
session=${1:-}
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

run_dir=/run/open-bot/vnc/$session
display=""
port=""
if [ -f "$run_dir/meta" ]; then
  read -r display port <"$run_dir/meta" || true
fi
if [ -f "$run_dir/pid" ]; then
  pid=$(cat "$run_dir/pid")
  kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
fi
rm -rf "$run_dir"
if [ -n "$display" ]; then
  pkill -f "x11vnc -display :$display " 2>/dev/null || true
fi
token_file=/run/open-bot/tokens
if [ -f "$token_file" ]; then
  exec 9>/run/open-bot/tokens.lock
  flock 9
  grep -v "^${session}: " "$token_file" >"$token_file.tmp" || true
  mv "$token_file.tmp" "$token_file"
fi
echo ok
