#!/bin/sh
set -u
mkdir -p /tmp/.X11-unix /run/open-bot
chmod 1777 /tmp/.X11-unix
touch /run/open-bot/tokens
exec websockify --web=/usr/share/novnc --token-plugin TokenFile --token-source /run/open-bot/tokens 6080
