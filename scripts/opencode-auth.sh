#!/bin/sh
set -eu
if [ ! -f /opt/open-bot/instance ]; then
  echo "refusing to run outside an open-bot opencode container" >&2
  exit 1
fi
export HOME=/home/agent
export XDG_CONFIG_HOME=/home/agent/.config
export XDG_DATA_HOME=/home/agent/.local/share
cd /home/agent/workspace
if [ -n "${OB_AUTH_PROVIDER:-}" ]; then
  set -- "$@" --provider "$OB_AUTH_PROVIDER"
fi
if [ -n "${OB_AUTH_METHOD:-}" ]; then
  set -- "$@" --method "$OB_AUTH_METHOD"
fi
exec opencode auth "$@"
