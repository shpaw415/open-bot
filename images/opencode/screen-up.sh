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
if [ -f "$run_dir/display" ] && [ "$(cat "$run_dir/display")" = "$display" ] && [ -f "$run_dir/xvfb.pid" ]; then
  pid=$(cat "$run_dir/xvfb.pid")
  if kill -0 "$pid" 2>/dev/null && [ -S "/tmp/.X11-unix/X$display" ] && pgrep -f "user-data-dir=$profile" >/dev/null 2>&1; then
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
rm -f "/tmp/.X11-unix/X$display"

mkdir -p "$profile" "/tmp/open-bot-runtime-$display"
pkill -f "user-data-dir=$profile" 2>/dev/null || true
rm -f "$profile/SingletonLock" "$profile/SingletonCookie" "$profile/SingletonSocket"
chown -R agent:agent /home/agent/.config/chromium-threads "/tmp/open-bot-runtime-$display"

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

start_group xvfb Xvfb ":$display" -screen 0 1280x800x24 -ac -extension MIT-SHM
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
start_group chromium chromium --no-sandbox --disable-dev-shm-usage --disable-gpu --window-size=1280,800 --user-data-dir="$profile" about:blank
echo "$display" >"$run_dir/display"
echo "ok $display"
