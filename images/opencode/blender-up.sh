#!/bin/sh
set -eu
export HOME=/home/agent
mkdir -p /home/agent/.open-bot /home/agent/workspace
flag=/home/agent/.open-bot/blender-mcp-disabled
log=/home/agent/.open-bot/blender.log
while true; do
  if [ ! -f "$flag" ] && command -v blender >/dev/null 2>&1 && [ -f /opt/open-bot/blender-mcp/blender-serve.py ]; then
    echo "$(date -u +%FT%TZ) blender starting" >>"$log"
    BLENDER_MCP_PORT="${BLENDER_MCP_PORT:-9876}" \
      PYTHONPATH="/opt/blender-requests${PYTHONPATH:+:$PYTHONPATH}" \
      xvfb-run -a blender --factory-startup -noaudio \
      -P /opt/open-bot/blender-mcp/blender-serve.py >>"$log" 2>&1 || true
    echo "$(date -u +%FT%TZ) blender exited; restarting in 2s" >>"$log"
    sleep 2
  else
    sleep 2
  fi
done
