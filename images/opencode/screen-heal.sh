#!/bin/sh
# usage: screen-heal.sh SESSION
# Exit 0 when the session's screen and its Chromium are up, recreating them
# once via screen-up.sh (idempotent) if Xvfb or the browser died. Exits 1
# with a stderr message when there is nothing to heal onto.
set -eu
session=${1:-}
case "$session" in
  *[!A-Za-z0-9_-]* | "") exit 1 ;;
esac
list=/opt/open-bot/screen-list.sh
chromium() {
  pgrep -f "user-data-dir=/home/agent/.config/chromium-threads/$session" >/dev/null 2>&1
}
# Fast path: one pid check, one socket test, one pgrep — the common healthy
# case skips the whole-desktop screen-list sweep on every CLI call.
run_dir=/run/open-bot/screens/$session
display_now=$(cat "$run_dir/display" 2>/dev/null || true)
pid_now=$(cat "$run_dir/xvfb.pid" 2>/dev/null || true)
if [ -n "$display_now" ] && [ -n "$pid_now" ] \
  && kill -0 "$pid_now" 2>/dev/null \
  && [ -S "/tmp/.X11-unix/X$display_now" ] \
  && chromium; then
  exit 0
fi
if "$list" 2>/dev/null | grep -q "^$session " && chromium; then
  exit 0
fi
portfile=/home/agent/.open-bot/cdp/$session
[ -s "$portfile" ] || { echo "no screen for $session" >&2; exit 1; }
port=$(cat "$portfile")
case "$port" in
  922[4-9] | 923[01]) ;;
  *)
    echo "no screen for $session" >&2
    exit 1
    ;;
esac
display=$((port - 9222))
if "$list" 2>/dev/null | awk '{print $2}' | grep -qx "$display"; then
  echo "the screen for $session is gone and display $display is taken by another session. It returns on the next prompt." >&2
  exit 1
fi
sudo -n /opt/open-bot/screen-up.sh "$session" "$display" >/dev/null 2>&1 || true
# screen-up serializes on a flock with the prompt-path ensure; on a cold or
# busy desktop the first sync can take most of a minute. Wait for it before
# declaring the screen lost.
i=0
while [ "$i" -lt 45 ]; do
  "$list" 2>/dev/null | grep -q "^$session " && exit 0
  i=$((i + 1))
  sleep 1
done
if pgrep -f "^Xvfb :$display " >/dev/null 2>&1; then
  echo "the screen for $session is still starting (display $display). Run the command again in a moment." >&2
  exit 1
fi
echo "the screen for $session did not come back up (display $display). Last Xvfb log lines:" >&2
tail -3 "/tmp/open-bot-xvfb-$display.log" 2>/dev/null >&2 || true
exit 1
