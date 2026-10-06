#!/bin/sh
set -u
display=${1:-}
port=${2:-}
while true; do
  x11vnc -display ":$display" -rfbport "$port" -nopw -shared -forever -noxdamage -noshm || true
  sleep 2
done
