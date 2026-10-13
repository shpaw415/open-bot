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
"$list" 2>/dev/null | grep -q "^$session "
