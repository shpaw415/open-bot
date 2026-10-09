#!/bin/sh
set -eu
marker_dir="${HOME}/.config/open-bot"
mkdir -p "$marker_dir"
payload=$(cat)
if ! printf '%s' "$payload" | jq -e . >/dev/null 2>&1; then
  echo "invalid system1 payload" >&2
  exit 1
fi
provider=$(printf '%s' "$payload" | jq -r '.provider // empty')
endpoint=$(printf '%s' "$payload" | jq -r '.endpoint // empty')
model=$(printf '%s' "$payload" | jq -r '.model // empty')
api_key=$(printf '%s' "$payload" | jq -r '.apiKey // empty')
gateway=$(printf '%s' "$payload" | jq -r '.gatewayToken // empty')

clear_all() {
  rm -f "$marker_dir/system1.json" "$marker_dir/system1-auth.json"
}

if [ -z "$provider" ] || [ -z "$endpoint" ]; then
  clear_all
  exit 0
fi

case "$provider" in
  cloudflare-jev|cloudflare-clef|laya|selfhosted-clef) ;;
  *)
    echo "unsupported system1 provider: $provider" >&2
    exit 1
    ;;
esac

jq -n --arg provider "$provider" --arg endpoint "$endpoint" --arg model "$model" \
  '{provider:$provider, endpoint:$endpoint, model:$model}' > "$marker_dir/system1.json.tmp"
mv "$marker_dir/system1.json.tmp" "$marker_dir/system1.json"
jq -n --arg apiKey "$api_key" --arg gatewayToken "$gateway" \
  '{apiKey:$apiKey, gatewayToken:$gatewayToken}' > "$marker_dir/system1-auth.json.tmp"
mv "$marker_dir/system1-auth.json.tmp" "$marker_dir/system1-auth.json"
chmod 600 "$marker_dir/system1-auth.json"
