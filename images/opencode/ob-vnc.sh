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
port=${host##*::}
display=$((port - 5900))
cdp=$((9222 + display))
state=/home/agent/.open-bot/capture-$cdp.json
if [ "${1:-}" = "map" ] || [ "${1:-}" = "hit-image" ]; then
  cmd=$1
  shift
  if [ "$#" -ne 2 ]; then
    echo "usage: ob-vnc --session SESSION map IMAGE_X IMAGE_Y" >&2
    echo "       ob-vnc --session SESSION hit-image IMAGE_X IMAGE_Y" >&2
    exit 1
  fi
  for value in "$1" "$2"; do
    case "$value" in
      '' | *[!0-9]*)
        echo "usage: ob-vnc --session SESSION $cmd IMAGE_X IMAGE_Y" >&2
        exit 1
        ;;
    esac
  done
  exec bun /opt/open-bot/coord.ts "$cmd" "$cdp" "$state" "$1" "$2"
fi
if [ "${1:-}" = "hit" ]; then
  shift
  if [ "$#" -ne 2 ]; then
    echo "usage: ob-vnc --session SESSION hit X Y" >&2
    exit 1
  fi
  for value in "$1" "$2"; do
    case "$value" in
      '' | *[!0-9]*)
        echo "usage: ob-vnc --session SESSION hit X Y" >&2
        exit 1
        ;;
    esac
  done
  exec bun /opt/open-bot/hittest.ts "$cdp" "$1" "$2"
fi
if [ "${1:-}" = "recover" ]; then
  shift
  if [ "$#" -gt 0 ]; then
    echo "usage: ob-vnc --session SESSION recover" >&2
    exit 1
  fi
  vncdo -s "$host" keyup ctrl keyup rctrl keyup shift keyup rshift \
    keyup alt keyup ralt keyup meta keyup rmeta keyup super keyup rsuper
  echo "released stuck modifiers. Retry the action once; if the page still does not change, stop input and hand the screen to the user."
  exit 0
fi
if [ "${1:-}" = "paste" ]; then
  shift
  if [ "$#" -eq 0 ]; then
    echo "usage: ob-vnc --session SESSION paste TEXT" >&2
    exit 1
  fi
  text="$*"
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
  if [ -n "$res" ]; then
    exec bun /opt/open-bot/xshot.ts "$cdp" "$out" "$res"
  fi
  rm -f "$state"
  if DISPLAY=:$display python3 /opt/open-bot/xcap.py "$out"; then
    exit 0
  fi
  exec vncdo -s "$host" capture "$out"
fi
# vncdotool only knows lowercase key aliases; 'Return' or 'Escape' crash with
# "ord() expected a character". Normalize the token after every key/keyup.
if printf '%s\n' "$@" | grep -qx -e key -e keyup; then
  args=/tmp/ob-vnc-args.$$
  : >"$args"
  pending=0
  for arg in "$@"; do
    if [ "$pending" = "1" ]; then
      pending=0
      lowered=$(printf '%s' "$arg" | tr 'A-Z' 'a-z')
      case "$lowered" in
        return) arg=enter ;;
        escape) arg=esc ;;
        backspace) arg=bsp ;;
        pageup) arg=pgup ;;
        pagedown) arg=pgdn ;;
        insert) arg=ins ;;
        *) arg=$lowered ;;
      esac
    fi
    case "$arg" in
      key | keyup) pending=1 ;;
    esac
    printf '%s\n' "$arg" >>"$args"
  done
  set --
  while IFS= read -r line; do
    set -- "$@" "$line"
  done <"$args"
  rm -f "$args"
fi
exec vncdo -s "$host" "$@"
