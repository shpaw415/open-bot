#!/bin/sh
# apply-plugin-auth.sh — write or remove a plugin's merged config file
# (~/.config/open-bot/<file>) from a JSON payload on stdin:
#   {"file":"plugin-weather-pro.json","data":{...}}   write
#   {"file":"plugin-weather-pro.json","data":null}    remove
set -eu
payload=$(cat)
if ! printf '%s' "$payload" | jq -e . >/dev/null 2>&1; then
  echo "invalid plugin auth payload" >&2
  exit 1
fi
file=$(printf '%s' "$payload" | jq -r '.file // empty')
data=$(printf '%s' "$payload" | jq '.data')
case "$file" in
  ""|*/*) echo "invalid plugin config file name" >&2; exit 1 ;;
esac
dir="${HOME}/.config/open-bot"
target="$dir/$file"
case "$file" in
  plugin-*.json) ;;
  *) echo "only plugin-<id>.json configs are managed here" >&2; exit 1 ;;
esac
if [ "$data" = "null" ]; then
  rm -f "$target"
  exit 0
fi
if ! printf '%s' "$data" | jq -e 'type == "object"' >/dev/null 2>&1; then
  echo "plugin config must be an object" >&2
  exit 1
fi
mkdir -p "$dir"
tmp="$target.tmp"
printf '%s' "$data" | jq . > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$target"
