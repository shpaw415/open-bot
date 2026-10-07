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
if [ -f "${file}.hold" ]; then
  echo "The user has this screen. Stop input until they say they are done on the screen." >&2
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
if [ "${1:-}" = "paste" ]; then
  shift
  if [ "$#" -eq 0 ]; then
    echo "usage: ob-vnc --session SESSION paste TEXT" >&2
    exit 1
  fi
  text="$*"
  port=${host##*::}
  display=$((port - 5900))
  if command -v xclip >/dev/null 2>&1; then
    pkill -x xclip >/dev/null 2>&1 || true
    printf '%s' "$text" | DISPLAY=:$display xclip -selection clipboard >/dev/null 2>&1 &
    sleep 0.2
    vncdo -s "$host" key ctrl-v
    sleep 0.15
    pkill -x xclip >/dev/null 2>&1 || true
    exit 0
  fi
  exec vncdo -s "$host" type "$text"
fi
if [ "${1:-}" = "capture" ]; then
  shift
  out=${1:-}
  res=${2:-}
  if [ -z "$out" ] || [ "$#" -gt 2 ]; then
    echo "usage: ob-vnc --session SESSION capture FILE [2|2560x1600]" >&2
    exit 1
  fi
  port=${host##*::}
  display=$((port - 5900))
  if [ -n "$res" ]; then
    cdp=$((9222 + display))
    exec bun /opt/open-bot/xshot.ts "$cdp" "$out" "$res"
  fi
  if DISPLAY=:$display python3 /opt/open-bot/xcap.py "$out"; then
    exit 0
  fi
  exec vncdo -s "$host" capture "$out"
fi
exec vncdo -s "$host" "$@"
