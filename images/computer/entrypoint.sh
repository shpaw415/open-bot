#!/bin/sh
set -u
while [ ! -S /tmp/.X11-unix/X1 ]; do
  sleep 0.5
done
while true; do
  x11vnc -display :1 -rfbport 5900 -nopw -shared -forever -noxdamage -noshm || true
  sleep 2
done &
exec websockify --web=/usr/share/novnc 6080 localhost:5900
