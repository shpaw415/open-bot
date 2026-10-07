#!/bin/sh
set -u
display=${1:-}
port=${2:-}
while true; do
  x11vnc -display ":$display" -rfbport "$port" -nopw -shared -forever -noxdamage -noshm -snapfb || true
  sleep 2
done
