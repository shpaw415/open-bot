#!/bin/sh
set -eu
if [ "${1:-}" != "--session" ] || [ -z "${2:-}" ]; then
  echo "usage: ob-vnc --session SESSION command..." >&2
  echo "SESSION is the screen id in the system instructions. Do not guess a port." >&2
  exit 1
fi
session=$2
shift 2
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
file=/home/agent/.open-bot/vnc/$session
if [ ! -s "$file" ]; then
  echo "no screen for $session. Do not try port 5900 or another host." >&2
  exit 1
fi
host=$(cat "$file")
case "$host" in
  computer::590[2-9]) ;;
  *)
    echo "bad screen address" >&2
    exit 1
    ;;
esac
exec vncdo -s "$host" "$@"
