#!/bin/sh
set -eu
marker_dir="${HOME}/.config/open-bot"
mkdir -p "$marker_dir"
payload=$(cat)
if ! printf '%s' "$payload" | jq -e . >/dev/null 2>&1; then
  echo "invalid model3d auth payload" >&2
  exit 1
fi
provider=$(printf '%s' "$payload" | jq -r '.provider // empty')
account=$(printf '%s' "$payload" | jq -r '.accountId // empty')
token=$(printf '%s' "$payload" | jq -r '.token // empty')
model=$(printf '%s' "$payload" | jq -r '.model // empty')

clear_all() {
  rm -f "$marker_dir/model3d.json" "$marker_dir/model3d-auth.json"
}

if [ -z "$token" ]; then
  clear_all
  exit 0
fi
if [ -z "$provider" ]; then
  echo "3d model provider is required" >&2
  exit 1
fi

write_marker() {
  jq -n --arg provider "$provider" --arg model "$model" '{provider:$provider, model:$model}' > "$marker_dir/model3d.json"
}

write_key_auth() {
  jq -n --arg account "$account" --arg token "$token" '{accountId:(if $account == "" then null else $account end), token:$token}' > "$marker_dir/model3d-auth.json.tmp"
  mv "$marker_dir/model3d-auth.json.tmp" "$marker_dir/model3d-auth.json"
  chmod 600 "$marker_dir/model3d-auth.json"
}

case "$provider" in
  meshy)
    model="${model:-meshy-5}"
    clear_all
    mkdir -p "$marker_dir"
    write_key_auth
    write_marker
    ;;
  tripo)
    model="${model:-latest}"
    clear_all
    mkdir -p "$marker_dir"
    write_key_auth
    write_marker
    ;;
  replicate)
    model="${model:-firtoz/trellis}"
    clear_all
    mkdir -p "$marker_dir"
    write_key_auth
    write_marker
    ;;
  fal)
    model="${model:-fal-ai/tripo/v2.5/text-to-3d}"
    clear_all
    mkdir -p "$marker_dir"
    write_key_auth
    write_marker
    ;;
  *)
    echo "unsupported 3d model provider: $provider" >&2
    exit 1
    ;;
esac
