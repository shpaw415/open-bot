#!/bin/bash
# Sandbox entrypoint: the control plane writes the generated
# opencode.json, AGENTS.md, skills, and copied-in files first, then
# drops ~/.open-bot/ready. Only then does opencode start, so no window
# exists where a default-config daemon could answer.
set -eu
export HOME=/home/sandbox
mkdir -p \
  "$HOME/.config/opencode/skills" \
  "$HOME/.local/share/opencode" \
  "$HOME/.local/bin" \
  "$HOME/.open-bot" \
  /workspace

deadline=$(( $(date +%s) + 600 ))
while [ ! -f "$HOME/.open-bot/ready" ]; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "sandbox: timed out waiting for control-plane provisioning" >&2
    exit 1
  fi
  sleep 0.2
done

cd /workspace
exec opencode serve --hostname 0.0.0.0 --port 4096
