#!/bin/sh
set -u
session=${1:-}
shift 2>/dev/null || true
purge=0
note=""
while [ "${1:-}" != "" ]; do
  case "$1" in
    --purge) purge=1 ;;
    --note)
      shift
      note=${1:-}
      ;;
  esac
  shift
done
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
# Stop a live screen recording first so ffmpeg finalizes its file instead
# of dying with the display; the recording file itself is kept.
rec_state=/home/agent/.open-bot/recordings/$session/current.json
if [ -f "$rec_state" ] && command -v jq >/dev/null 2>&1; then
  rec_pid=$(jq -r '.pid // empty' "$rec_state" 2>/dev/null || true)
  case "$rec_pid" in
    '' | *[!0-9]*) ;;
    *)
      kill -INT -- "-$rec_pid" 2>/dev/null || kill -INT "$rec_pid" 2>/dev/null || true
      i=0
      while kill -0 "$rec_pid" 2>/dev/null && [ "$i" -lt 30 ]; do
        i=$((i + 1))
        sleep 0.1
      done
      kill -KILL -- "-$rec_pid" 2>/dev/null || true
      ;;
  esac
  rm -f "$rec_state"
fi
if [ -d "$run_dir" ]; then
    for name in xvfb openbox chromium devtools; do
    if [ -f "$run_dir/$name.pid" ]; then
      pid=$(cat "$run_dir/$name.pid")
      kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$run_dir"
fi
apps_dir=/home/agent/.open-bot/apps/$session
if [ -d "$apps_dir" ]; then
  for pidfile in "$apps_dir"/*.pid; do
    [ -f "$pidfile" ] || continue
    pid=$(cat "$pidfile")
    kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  done
  rm -rf "$apps_dir"
fi
profile=/home/agent/.config/chromium-threads/$session
pkill -f "user-data-dir=$profile" 2>/dev/null || true
if [ -x /opt/open-bot/sync-chromium.sh ]; then
  /opt/open-bot/sync-chromium.sh push "$session" || true
fi
if [ -n "$display" ]; then
  pkill -f "Xvfb :$display " 2>/dev/null || true
  rm -f "/tmp/.X11-unix/X$display"
fi
rm -f "/home/agent/.open-bot/vnc/$session" "/home/agent/.open-bot/vnc/$session.hold"
if [ "$purge" -eq 1 ]; then
  rm -rf "$profile"
  rm -rf "/home/agent/.config/apps/chrome/$session" "/home/agent/.config/apps/chrome/$session"-* 2>/dev/null || true
fi
file=/home/agent/.open-bot/screens.log
(touch "$file" && chmod 0666 "$file") 2>/dev/null || true
printf '%s down %s %s %s\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$session" "${display:-none}" "$note" \
  >>"$file" 2>/dev/null || true
echo ok
