#!/bin/sh
set -eu
payload=$(cat)
if ! printf '%s' "$payload" | jq -e . >/dev/null 2>&1; then
  echo "invalid blender mcp payload" >&2
  exit 1
fi
enabled=$(printf '%s' "$payload" | jq -r '.enabled')
cfg="${HOME}/.config/opencode/opencode.json"
flag="${HOME}/.open-bot/blender-mcp-disabled"
if [ ! -f "$cfg" ]; then
  echo "opencode.json not found" >&2
  exit 1
fi
if [ "$enabled" = "true" ]; then
  rm -f "$flag"
  jq '.mcp = ((.mcp // {}) + {blender: ((.mcp.blender // {}) + {enabled: true})})' \
    "$cfg" > "${cfg}.blender" \
    && mv "${cfg}.blender" "$cfg"
  exit 0
fi
if [ "$enabled" = "false" ]; then
  touch "$flag"
  jq '.mcp = ((.mcp // {}) + {blender: ((.mcp.blender // {}) + {enabled: false})})' \
    "$cfg" > "${cfg}.blender" \
    && mv "${cfg}.blender" "$cfg"
  pkill -f blender-serve.py 2>/dev/null || true
  exit 0
fi
echo "enabled must be true or false" >&2
exit 1
