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

profile=/home/agent/.config/chromium-threads/$session
port=$((5900 + display))
cdp=$((9222 + display))
mkdir -p /home/agent/.open-bot/vnc /home/agent/.open-bot/cdp /home/agent/.open-bot/screens
echo "computer::$port" >/home/agent/.open-bot/vnc/$session
echo "$cdp" >/home/agent/.open-bot/cdp/$session
chown -R agent:agent /home/agent/.open-bot
state=/home/agent/.open-bot/screens/$session.url

url=""
if [ -f "$state" ]; then
  candidate=$(head -c 2048 "$state" | tr -d "\r\n")
  case $candidate in
    http://* | https://*) url=$candidate ;;
  esac
fi

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
    "$@" >/tmp/open-bot-$name-$display.log 2>&1 &
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
      "${url:-about:blank}"
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
      "${url:-about:blank}"
  fi
}

start_urlwatch() {
  if ! pid_alive "$run_dir/urlwatch.pid"; then
    start_group urlwatch bun /opt/open-bot/url-watch.ts "$session" "$cdp" "$state"
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
    start_urlwatch
    echo "ok $display"
    exit 0
  fi
fi

for name in xvfb openbox chromium urlwatch; do
  if [ -f "$run_dir/$name.pid" ]; then
    pid=$(cat "$run_dir/$name.pid")
    kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  fi
done
rm -f "/tmp/.X11-unix/X$display"

mkdir -p "$profile" "/tmp/open-bot-runtime-$display"
/opt/open-bot/sync-chromium.sh pull "$session"
pkill -f "user-data-dir=$profile" 2>/dev/null || true
rm -f "$profile/SingletonLock" "$profile/SingletonCookie" "$profile/SingletonSocket"
chown -R agent:agent /home/agent/.config/chromium /home/agent/.config/chromium-threads "/tmp/open-bot-runtime-$display"
fix_prefs

start_group xvfb Xvfb ":$display" -screen 0 1920x1200x24 -ac -extension MIT-SHM
i=0
while [ ! -S "/tmp/.X11-unix/X$display" ]; do
  i=$((i + 1))
  if [ "$i" -gt 50 ]; then
    echo "Xvfb did not start" >&2
    exit 1
  fi
  sleep 0.1
done
chmod 777 "/tmp/.X11-unix/X$display" || true
start_group openbox openbox
start_chromium
start_urlwatch
echo "$display" >"$run_dir/display"
echo "ok $display"
