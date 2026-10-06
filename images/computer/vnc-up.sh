#!/bin/sh
set -u
session=${1:-}
display=${2:-}
port=${3:-}
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
case "$port" in
  590[2-9]) ;;
  *)
    echo "bad port" >&2
    exit 1
    ;;
esac

i=0
while [ ! -S "/tmp/.X11-unix/X$display" ]; do
  i=$((i + 1))
  if [ "$i" -gt 100 ]; then
    echo "display :$display is not ready" >&2
    exit 1
  fi
  sleep 0.1
done

mkdir -p /run/open-bot/vnc
run_dir=/run/open-bot/vnc/$session
mkdir -p "$run_dir"
if [ -f "$run_dir/pid" ] && kill -0 "$(cat "$run_dir/pid")" 2>/dev/null; then
  if [ "$(cat "$run_dir/meta" 2>/dev/null || true)" = "$display $port" ]; then
    /opt/open-bot/vnc-token.sh "$session" "$port"
    echo ok
    exit 0
  fi
fi
if [ -f "$run_dir/pid" ]; then
  pid=$(cat "$run_dir/pid")
  kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
fi
setsid /opt/open-bot/vnc-loop.sh "$display" "$port" >/tmp/open-bot-vnc-$port.log 2>&1 &
echo $! >"$run_dir/pid"
echo "$display $port" >"$run_dir/meta"
/opt/open-bot/vnc-token.sh "$session" "$port"
echo ok
