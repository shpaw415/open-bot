#!/bin/sh
set -eu
session=${1:-}
display=${2:-}
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
case "$display" in
  [2-9]) ;;
  *)
    echo "bad display" >&2
    exit 1
    ;;
esac

run_dir=/run/open-bot/screens/$session
mkdir -p "$run_dir" /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix
# Prompt-time ensure (control plane) and CLI-side screen-heal.sh can both get
# here at once; serialize so a full restart never tears down the other's Xvfb.
# A bounded wait keeps CLI calls from blocking past the agent's step budget.
exec 9>"$run_dir.lock"
flock -w 60 9 || true

profile=/home/agent/.config/chromium-threads/$session
port=$((5900 + display))
cdp=$((9222 + display))
mkdir -p /home/agent/.open-bot/vnc /home/agent/.open-bot/cdp
echo "computer::$port" >/home/agent/.open-bot/vnc/$session
echo "$cdp" >/home/agent/.open-bot/cdp/$session
chown -R agent:agent /home/agent/.open-bot

pid_alive() {
  [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null
}

fix_prefs() {
  prefs=$profile/Default/Preferences
  [ -f "$prefs" ] || return 0
  tmp=$(mktemp)
  if jq '.profile.exit_type = "Normal" | .profile.exited_cleanly = true' "$prefs" >"$tmp"; then
    mv "$tmp" "$prefs"
    chown agent:agent "$prefs"
  else
    rm -f "$tmp"
  fi
}

start_group() {
  name=$1
  shift
  setsid runuser -u agent -- env \
    HOME=/home/agent \
    DISPLAY=":$display" \
    XDG_RUNTIME_DIR="/tmp/open-bot-runtime-$display" \
    "$@" >/tmp/open-bot-$name-$display.log 2>&1 9>&- &
  echo $! >"$run_dir/$name.pid"
}

start_chromium() {
  if [ -x /opt/google/chrome/google-chrome ]; then
    start_group chromium /opt/google/chrome/google-chrome \
      --disable-namespace-sandbox \
      --disable-dev-shm-usage \
      --disable-gpu \
      --ozone-platform=x11 \
      --window-position=0,0 \
      --password-store=basic \
      --hide-crash-restore-bubble \
      --no-first-run \
      --remote-debugging-port="$cdp" \
      --remote-debugging-address=127.0.0.1 \
      --remote-allow-origins=* \
      --disable-search-engine-choice-screen \
      --window-size=1920,1200 \
      --force-device-scale-factor=1 \
      --user-data-dir="$profile" \
      about:blank
  else
    start_group chromium chromium \
      --no-sandbox \
      --disable-dev-shm-usage \
      --disable-gpu \
      --ozone-platform=x11 \
      --window-position=0,0 \
      --password-store=basic \
      --hide-crash-restore-bubble \
      --no-first-run \
      --remote-debugging-port="$cdp" \
      --remote-debugging-address=127.0.0.1 \
      --remote-allow-origins=* \
      --window-size=1920,1200 \
      --force-device-scale-factor=1 \
      --user-data-dir="$profile" \
      about:blank
  fi
}

if [ -f "$run_dir/display" ] && [ "$(cat "$run_dir/display")" = "$display" ]; then
  if pid_alive "$run_dir/xvfb.pid" && [ -S "/tmp/.X11-unix/X$display" ]; then
    if ! pid_alive "$run_dir/openbox.pid"; then
      start_group openbox openbox
    fi
    if ! pgrep -f "user-data-dir=$profile" >/dev/null 2>&1; then
      pkill -f "user-data-dir=$profile" 2>/dev/null || true
      rm -f "$profile/SingletonLock" "$profile/SingletonCookie" "$profile/SingletonSocket"
      fix_prefs
      start_chromium
    fi
    echo "ok $display"
    exit 0
  fi
fi

for name in xvfb openbox chromium; do
  if [ -f "$run_dir/$name.pid" ]; then
    pid=$(cat "$run_dir/$name.pid")
    kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  fi
done
rm -f "/tmp/.X11-unix/X$display" "/tmp/.X$display-lock"

mkdir -p "$profile" "/tmp/open-bot-runtime-$display"
/opt/open-bot/sync-chromium.sh pull "$session"
pkill -f "user-data-dir=$profile" 2>/dev/null || true
# A crashed earlier start can leave an Xvfb alive on this display holding the
# abstract socket with no pid file; take the display over completely.
pkill -f "Xvfb :$display " 2>/dev/null || true
i=0
while pgrep -f "^Xvfb :$display " >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 30 ]; then break; fi
  sleep 0.1
done
rm -f "$profile/SingletonLock" "$profile/SingletonCookie" "$profile/SingletonSocket"
chown -R agent:agent /home/agent/.config/chromium /home/agent/.config/chromium-threads "/tmp/open-bot-runtime-$display"
fix_prefs

start_group xvfb Xvfb ":$display" -screen 0 1920x1200x24 -ac -extension MIT-SHM
i=0
while [ ! -S "/tmp/.X11-unix/X$display" ]; do
  i=$((i + 1))
  if [ "$i" -gt 150 ]; then
    echo "Xvfb did not start" >&2
    exit 1
  fi
  sleep 0.1
done
# start_group records the runuser wrapper pid, which can die independently of
# the server; screen-list needs the real Xvfb pid to stay listed.
server_pid=$(pgrep -f "^Xvfb :$display " | head -n 1 || true)
[ -n "$server_pid" ] && echo "$server_pid" >"$run_dir/xvfb.pid" || true
chmod 777 "/tmp/.X11-unix/X$display" || true
start_group openbox openbox
start_chromium
echo "$display" >"$run_dir/display"
echo "ok $display"
