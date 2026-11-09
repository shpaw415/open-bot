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
if [ ! -s "$file" ] && [ -s "/home/agent/.open-bot/cdp/$session" ]; then
  # A stopped screen still has its cdp port file; heal can bring the whole
  # screen (and this vnc file) back, so try that before giving up.
  /opt/open-bot/screen-heal.sh "$session" >&2 || true
fi
if [ ! -s "$file" ]; then
  echo "no screen for $session. Do not try port 5900 or another host." >&2
  exit 1
fi
if [ -f "${file}.hold" ]; then
  echo "The user has this screen. Stop input until they say they are done on the screen." >&2
  exit 1
fi
/opt/open-bot/screen-heal.sh "$session"
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

# The VNC server lives on the computer container (vnc-up.sh) and can die while
# the local X display — and capture, which prefers X11/CDP — stays up. Refused
# input falls back to xdotool on the local display so the ladder keeps a
# working input channel; xdotool speaks the same screen coordinate space.
xkey() {
  case "$1" in
    enter) printf 'Return' ;;
    esc) printf 'Escape' ;;
    bsp) printf 'BackSpace' ;;
    pgup) printf 'Page_Up' ;;
    pgdn) printf 'Page_Down' ;;
    ins) printf 'Insert' ;;
    del) printf 'Delete' ;;
    tab) printf 'Tab' ;;
    home) printf 'Home' ;;
    end) printf 'End' ;;
    up) printf 'Up' ;;
    down) printf 'Down' ;;
    left) printf 'Left' ;;
    right) printf 'Right' ;;
    *) printf '%s' "$1" ;;
  esac
}

xdotool_input() {
  cmd=$1
  shift
  case "$cmd" in
    move)
      DISPLAY=:$display xdotool mousemove "$1" "$2"
      shift 2
      ;;
    click)
      DISPLAY=:$display xdotool click "$1"
      shift
      ;;
    mousedown)
      DISPLAY=:$display xdotool mousedown "$1"
      shift
      ;;
    mouseup)
      DISPLAY=:$display xdotool mouseup "$1"
      shift
      ;;
    key | keyup)
      DISPLAY=:$display xdotool "$cmd" "$(xkey "$1")"
      shift
      ;;
    type)
      DISPLAY=:$display xdotool type --delay 8 -- "$1"
      shift
      ;;
    *)
      echo "ob-vnc: no local input fallback for '$cmd'" >&2
      return 1
      ;;
  esac
  [ "$#" -gt 0 ] && xdotool_input "$@"
  return 0
}

vnc_input() {
  status=0
  # A wedged vncdo must never hang the CLI (field #72: drag never returned
  # and left modifiers/buttons stuck). Bounded, with a best-effort local
  # release of buttons and modifiers on timeout.
  err=$(timeout 20 vncdo -s "$host" "$@" 2>&1) || status=$?
  [ "$status" -eq 0 ] && return 0
  if [ "$status" -eq 124 ]; then
    echo "ob-vnc: vnc input timed out after 20s — released buttons/modifiers locally; run ob-vnc recover, then retry once" >&2
    DISPLAY=:$display xdotool mouseup 1 keyup ctrl keyup shift keyup alt keyup super >/dev/null 2>&1 || true
    return "$status"
  fi
  case "$err" in
    *refused* | *Refused* | *ECONNREFUSED* | *timed\ out*)
      echo "ob-vnc: vnc input unavailable on $host — using the local X display" >&2
      xdotool_input "$@"
      return $?
      ;;
    *)
      printf '%s\n' "$err" >&2
      return "$status"
      ;;
  esac
}

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
  vnc_input mouseup 1 mouseup 2 mouseup 3 keyup ctrl keyup rctrl keyup shift keyup rshift \
    keyup alt keyup ralt keyup meta keyup rmeta keyup super keyup rsuper
  echo "released stuck modifiers and pointer buttons. Retry the action once; if the page still does not change, stop input and hand the screen to the user."
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
    vnc_input key ctrl-v
    sleep 0.15
    pkill -x xclip >/dev/null 2>&1 || true
    exit 0
  fi
  vnc_input type "$text"
  exit 0
fi
if [ "${1:-}" = "drag" ]; then
  shift
  # drag X2 Y2 drags from the current pointer position; drag X1 Y1 X2 Y2
  # starts at X1,Y1. Implemented as an explicit move/mousedown/move/mouseup
  # sequence — vncdotool's own drag verb hangs in the field (#72) and its
  # parser rejects the 4-coordinate form.
  if [ "$#" -ne 2 ] && [ "$#" -ne 4 ]; then
    echo "usage: ob-vnc --session SESSION drag X2 Y2 | drag X1 Y1 X2 Y2" >&2
    exit 1
  fi
  for value in "$@"; do
    case "$value" in
      '' | *[!0-9]*)
        echo "usage: ob-vnc --session SESSION drag X2 Y2 | drag X1 Y1 X2 Y2" >&2
        exit 1
        ;;
    esac
  done
  drag_status=0
  if [ "$#" -eq 4 ]; then
    start_x=$1 start_y=$2 end_x=$3 end_y=$4
    vnc_input move "$start_x" "$start_y" mousedown 1 move "$end_x" "$end_y" mouseup 1 || drag_status=$?
  else
    vnc_input mousedown 1 move "$1" "$2" mouseup 1 || drag_status=$?
  fi
  if [ "$drag_status" -ne 0 ]; then
    # Never leave the button (or modifiers) held after a failed drag.
    vnc_input mouseup 1 >/dev/null 2>&1 || true
    DISPLAY=:$display xdotool mouseup 1 keyup ctrl keyup shift keyup alt keyup super >/dev/null 2>&1 || true
    echo "ob-vnc: drag failed — pointer button released; run ob-vnc recover if keys still misbehave" >&2
    exit "$drag_status"
  fi
  exit 0
fi
if [ "${1:-}" = "windows" ]; then
  shift
  if [ "$#" -gt 0 ]; then
    echo "usage: ob-vnc --session SESSION windows" >&2
    exit 1
  fi
  # Native dialogs (GTK file choosers, #82) are separate X windows; VNC key
  # input follows X focus, so list windows and focus explicitly instead of
  # hoping the dialog kept it between calls.
  active=$(DISPLAY=:$display xdotool getactivewindow 2>/dev/null || true)
  for win in $(DISPLAY=:$display xdotool search --onlyvisible "" 2>/dev/null); do
    name=$(DISPLAY=:$display xdotool getwindowname "$win" 2>/dev/null || true)
    [ -n "$name" ] || continue
    mark=""
    [ "$win" = "$active" ] && mark=" [active]"
    printf '%s %s%s\n' "$win" "$name" "$mark"
  done
  exit 0
fi
if [ "${1:-}" = "focus" ]; then
  shift
  if [ "$#" -ne 1 ]; then
    echo "usage: ob-vnc --session SESSION focus WINDOW_ID (from: ob-vnc windows)" >&2
    exit 1
  fi
  case "$1" in
    '' | *[!0-9]*)
      echo "usage: ob-vnc --session SESSION focus WINDOW_ID (from: ob-vnc windows)" >&2
      exit 1
      ;;
  esac
  DISPLAY=:$display xdotool windowactivate --sync "$1"
  echo "focused $1 $(DISPLAY=:$display xdotool getwindowname "$1" 2>/dev/null || true)"
  exit 0
fi
if [ "${1:-}" = "capture" ]; then
  shift
  out=${1:-}
  res=${2:-}
  if [ -z "$out" ] || [ "$#" -gt 2 ]; then
    echo "usage: ob-vnc --session SESSION capture FILE [2|WxH — width 640..3840, height 480..2400]" >&2
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
        # Browser zoom-in (#11/#58): vncdotool has no "plus" keysym alias
        # and crashes on it; Ctrl+equal is the same zoom chord.
        plus) arg=equal ;;
        *-plus) arg="${lowered%-plus}-equal" ;;
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

vnc_input "$@"
