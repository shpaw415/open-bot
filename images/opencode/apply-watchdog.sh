#!/bin/sh
# Write the watchdog daemon config (~/.config/open-bot/watchdog.json) from a
# JSON payload on stdin: {enabled, stopOnHigh, provider, accountId, apiKey,
# model, baseUrl}. Empty provider fields mean rules-only mode. The control
# plane calls this on every config change; the daemon reloads on mtime.
set -eu
marker_dir="${HOME}/.config/open-bot"
mkdir -p "$marker_dir"
payload=$(cat)
if ! printf '%s' "$payload" | jq -e 'has("enabled") and has("stopOnHigh")' >/dev/null 2>&1; then
  echo "invalid watchdog payload" >&2
  exit 1
fi
printf '%s' "$payload" | jq '{
  enabled: (.enabled == true),
  stopOnHigh: (.stopOnHigh == true),
  provider: (.provider // "" | tostring),
  accountId: (.accountId // "" | tostring),
  apiKey: (.apiKey // "" | tostring),
  model: (.model // "" | tostring),
  baseUrl: (.baseUrl // "" | tostring)
}' > "$marker_dir/watchdog.json.tmp"
mv "$marker_dir/watchdog.json.tmp" "$marker_dir/watchdog.json"
chmod 600 "$marker_dir/watchdog.json"
