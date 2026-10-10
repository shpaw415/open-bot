#!/bin/sh
# ob-app — launch and manage native apps on this thread's screen.
set -eu

usage() {
  echo "usage: ob-app --session SESSION launch APP [ARG...]" >&2
  echo "       ob-app --session SESSION launch chrome [URL] [--profile NAME]" >&2
  echo "       ob-app --session SESSION list" >&2
  echo "       ob-app --session SESSION focus TITLE" >&2
  echo "       ob-app --session SESSION close APP|PID" >&2
  echo "       ob-app catalog" >&2
  echo "SESSION is the screen id in the system instructions. Do not guess a port." >&2
  exit 1
}

REFUSED="chromium google-chrome chrome-sandbox Xvfb x11vnc websockify vncdo xclip xsel ttyd"

refused() {
  name=$1
  for bad in $REFUSED; do
    if [ "$name" = "$bad" ]; then
      return 0
    fi
  done
  return 1
}

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\000-\037'
}

catalog() {
  printf '{"id":"chrome","name":"Google Chrome","exec":"__chrome__"}\n'
  python3 - <<'PY'
import configparser, glob, json, os, shlex

files = glob.glob("/usr/share/applications/*.desktop")
files += glob.glob(os.path.expanduser("~/.local/share/applications/*.desktop"))
entries = {}
for path in files:
    cp = configparser.ConfigParser(interpolation=None, strict=False)
    try:
        cp.read(path, encoding="utf-8", errors="replace")
    except Exception:
        continue
    if not cp.has_section("Desktop Entry"):
        continue
    sec = cp["Desktop Entry"]
    ident = os.path.splitext(os.path.basename(path))[0]
    if sec.get("NoDisplay", "").strip().lower() == "true":
        entries.pop(ident, None)
        continue
    if sec.get("Hidden", "").strip().lower() == "true":
        entries.pop(ident, None)
        continue
    if sec.get("Terminal", "").strip().lower() == "true":
        continue
    name = (sec.get("Name") or "").strip()
    execline = (sec.get("Exec") or "").strip()
    if not name or not execline:
        continue
    try:
        argv = [
            a for a in shlex.split(execline)
            if not (a.startswith("%") and len(a) <= 2)
        ]
    except ValueError:
        continue
    if not argv:
        continue
    if os.path.basename(argv[0]) in ("chromium", "google-chrome", "chrome"):
        continue
    entries[ident] = {"id": ident, "name": name, "exec": " ".join(argv)}
for row in sorted(entries.values(), key=lambda r: r["name"].lower()):
    print(json.dumps(row))
PY
}

if [ "${1:-}" = "catalog" ] && [ "$#" -eq 1 ]; then
  catalog
  exit 0
fi

if [ "${1:-}" != "--session" ] || [ -z "${2:-}" ]; then
  usage
fi
session=$2
shift 2
case "$session" in
  *[!A-Za-z0-9_-]* | "") usage ;;
esac
if [ "${#session}" -gt 128 ]; then
  usage
fi

cmd=${1:-}
[ -n "$cmd" ] || usage
shift

file=/home/agent/.open-bot/vnc/$session
host=""
if [ -s "$file" ]; then
  host=$(cat "$file")
fi
display=""
case "$host" in
  computer::590[2-9]) display=$(( ${host##*::} - 5900 )) ;;
esac
if [ -z "$display" ] || [ ! -S "/tmp/.X11-unix/X$display" ]; then
  echo "no screen for $session. Do not try port 5900 or another host." >&2
  exit 1
fi

apps_dir=/home/agent/.open-bot/apps/$session

if [ "$cmd" = "launch" ]; then
  if [ "$#" -lt 1 ]; then
    usage
  fi
  app=$1
  case "$app" in
    */*) app=${app##*/} ;;
  esac
  url=""
  profile_name=""
  if [ "$app" = "chrome" ]; then
    shift
    while [ "$#" -gt 0 ]; do
      case "$1" in
        http://* | https://*)
          if [ -z "$url" ]; then
            url=$1
          fi
          ;;
        --profile)
          if [ "$#" -lt 2 ]; then
            echo "--profile needs a name" >&2
            exit 1
          fi
          profile_name=$2
          shift
          ;;
        --profile=*)
          profile_name=${1#--profile=}
          ;;
        *)
          echo "chrome accepts a URL and --profile NAME only" >&2
          exit 1
          ;;
      esac
      shift
    done
    case "$profile_name" in
      "" | *[!A-Za-z0-9_-]*) echo "bad profile name" >&2 ; exit 1 ;;
    esac
    if [ "${#profile_name}" -gt 64 ]; then
      echo "bad profile name" >&2
      exit 1
    fi
    binary=$(command -v google-chrome || command -v chromium || true)
    if [ -z "$binary" ]; then
      echo "no chrome binary found (google-chrome or chromium)" >&2
      exit 1
    fi
    profile_root=$HOME/.config/apps/chrome
    mkdir -p "$profile_root"
    if [ -n "$profile_name" ]; then
      user_data="$profile_root/$session-$profile_name"
    else
      user_data="$profile_root/$session"
    fi
    set -- "$binary" \
      --user-data-dir="$user_data" \
      --no-first-run \
      --password-store=basic \
      --ozone-platform=x11 \
      --window-size=1920,1200
    if [ -n "$url" ]; then
      set -- "$@" "$url"
    fi
  elif refused "$app"; then
    case "$app" in
      chromium | google-chrome)
        echo "the managed browser is not an app. Pages go through ob-nav; a standalone Chrome window is ob-app launch chrome." >&2
        ;;
      *)
        echo "refusing to launch $app" >&2
        ;;
    esac
    exit 1
  else
    target=$1
    shift
    binary=$(command -v "$target" 2>/dev/null || true)
    if [ -z "$binary" ] && [ -x "$target" ]; then
      binary=$target
    fi
    if [ -z "$binary" ]; then
      echo "$target is not installed. Install it first (sudo apt-get install <package>), then launch again." >&2
      exit 1
    fi
    set -- "$binary" "$@"
  fi

  runtime=/tmp/open-bot-runtime-$display
  if [ ! -d "$runtime" ]; then
    mkdir -p "$runtime"
  fi
  log=/tmp/open-bot-app-$display-$app.log
  if ! : >"$log" 2>/dev/null; then
    log=/tmp/open-bot-app-$display.log
  fi
  setsid env DISPLAY=:$display XDG_RUNTIME_DIR="$runtime" HOME="$HOME" "$@" >>"$log" 2>&1 &
  pid=$!
  mkdir -p "$apps_dir"
  echo "$pid" >"$apps_dir/$pid.pid"
  echo "$app" >"$apps_dir/$pid.name"

  sleep 1
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "$app exited immediately. Last log lines:" >&2
    tail -n 5 "$log" >&2 || true
    rm -f "$apps_dir/$pid.pid" "$apps_dir/$pid.name"
    exit 1
  fi

  maximized=0
  i=0
  while [ "$i" -lt 50 ]; do
    win=$(DISPLAY=:$display wmctrl -lp 2>/dev/null | awk -v p="$pid" '$3==p{print $1; exit}') || win=""
    if [ -n "$win" ]; then
      DISPLAY=:$display wmctrl -i -r "$win" -b add,maximized_vert,maximized_horz 2>/dev/null || true
      maximized=1
      break
    fi
    i=$((i + 1))
    sleep 0.1
  done
  if [ "$maximized" -eq 0 ]; then
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "$app exited during startup. Log: $log" >&2
      rm -f "$apps_dir/$pid.pid" "$apps_dir/$pid.name"
      exit 1
    fi
  fi
  printf '{"ok":true,"app":"%s","pid":%s,"display":%s,"maximized":%s,"log":"%s"}\n' \
    "$(json_escape "$app")" "$pid" "$display" "$maximized" "$(json_escape "$log")"
  exit 0
fi

if [ "$cmd" = "list" ]; then
  if [ "$#" -ne 0 ]; then
    usage
  fi
  running=""
  if [ -d "$apps_dir" ]; then
    for pidfile in "$apps_dir"/*.pid; do
      [ -f "$pidfile" ] || continue
      pid=$(cat "$pidfile")
      name=$(cat "${pidfile%.pid}.name" 2>/dev/null || echo unknown)
      if kill -0 "$pid" 2>/dev/null; then
        running="$running{\"pid\":$pid,\"app\":\"$(json_escape "$name")\"},"
      fi
    done
  fi
  running=${running%,}
  wins=$(DISPLAY=:$display wmctrl -l 2>/dev/null |
    sed -e 's/^0x[0-9a-fA-F]*[[:space:]]*[-0-9]*[[:space:]]*[^[:space:]]*[[:space:]]*//' \
        -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/.*/"&"/' |
    tr '\n' ',') || wins=""
  wins=${wins%,}
  printf '{"apps":[%s],"windows":[%s]}\n' "$running" "$wins"
  exit 0
fi

if [ "$cmd" = "focus" ]; then
  if [ "$#" -ne 1 ]; then
    usage
  fi
  if DISPLAY=:$display wmctrl -a "$1" 2>/dev/null; then
    echo ok
    exit 0
  fi
  echo "no window matching $1" >&2
  exit 1
fi

if [ "$cmd" = "close" ]; then
  if [ "$#" -ne 1 ]; then
    usage
  fi
  target=$1
  pids=""
  case "$target" in
    '' | *[!0-9]*)
      if [ -d "$apps_dir" ]; then
        for namefile in "$apps_dir"/*.name; do
          [ -f "$namefile" ] || continue
          if [ "$(cat "$namefile")" = "$target" ]; then
            pids="$pids ${namefile%.name}"
          fi
        done
      fi
      ;;
    *)
      pids=" $target"
      ;;
  esac
  if [ -z "$pids" ]; then
    echo "no launched app $target" >&2
    exit 1
  fi
  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done
  i=0
  while [ "$i" -lt 20 ]; do
    alive=0
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then
        alive=1
      fi
    done
    if [ "$alive" -eq 0 ]; then
      break
    fi
    i=$((i + 1))
    sleep 0.1
  done
  for pid in $pids; do
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$apps_dir/$pid.pid" "$apps_dir/$pid.name"
  done
  echo ok
  exit 0
fi

usage
