#!/bin/sh
# Write the per-user agent step cap (~/.config/open-bot/agent-cap.json) from
# a JSON payload on stdin: {stepCap: <int>|null}. Null (or a missing file at
# boot) means the 512 default. The entrypoint reads this file on every boot
# and forces agent.build.steps from it, so the value survives recreates.
set -eu
marker_dir="${HOME}/.config/open-bot"
mkdir -p "$marker_dir"
payload=$(cat)
if ! printf '%s' "$payload" | jq -e 'has("stepCap") and (.stepCap == null or ((.stepCap | type) == "number" and (.stepCap | floor) == .stepCap and .stepCap >= 1 and .stepCap <= 100000))' >/dev/null 2>&1; then
  echo "invalid agent-cap payload" >&2
  exit 1
fi
printf '%s' "$payload" | jq '{stepCap: .stepCap}' > "$marker_dir/agent-cap.json.tmp"
mv "$marker_dir/agent-cap.json.tmp" "$marker_dir/agent-cap.json"
chmod 600 "$marker_dir/agent-cap.json"
