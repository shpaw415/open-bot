#!/bin/sh
set -eu
if [ "${1:-}" != "--session" ] || [ -z "${2:-}" ]; then
  echo "usage: ob-record --session SESSION start [--fps N] [--duration SEC] [--output FILE] | stop | status | list" >&2
  echo "SESSION is the screen id in the system instructions." >&2
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
portfile=/home/agent/.open-bot/cdp/$session
if [ ! -s "$file" ] && [ ! -s "$portfile" ]; then
  echo "no screen for $session. Do not guess ports or hosts." >&2
  exit 1
fi
verb=${1:-}
# Recording is an input-side action: never start one while the user holds
# the screen. stop/status/list stay available so a recording is never stuck.
if [ "$verb" = "start" ]; then
  if [ -f "${file}.hold" ]; then
    echo "The user has this screen. Stop input until they say they are done on the screen." >&2
    exit 1
  fi
  /opt/open-bot/screen-heal.sh "$session" 2>/dev/null || true
fi
port=$(cat "$portfile" 2>/dev/null || echo 0)
case "$port" in
  922[4-9] | 923[01]) ;;
  *)
    echo "no screen for $session" >&2
    exit 1
    ;;
esac
display=$((port - 9222))
exec bun /opt/open-bot/record.ts "$session" "$display" "$@"
