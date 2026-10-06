#!/bin/sh
set -eu
if [ -z "${OPEN_BOT_MODEL_PROVIDER:-}" ] || [ -z "${OPEN_BOT_MODEL:-}" ]; then
  exit 0
fi
jq --arg m "${OPEN_BOT_MODEL_PROVIDER}/${OPEN_BOT_MODEL}" \
  '.model = $m | .small_model = $m' \
  /home/agent/.config/opencode/opencode.json > /tmp/oc.json
mv /tmp/oc.json /home/agent/.config/opencode/opencode.json
chown agent:agent /home/agent/.config/opencode/opencode.json
