#!/bin/sh
set -eu
marker_dir="${HOME}/.config/open-bot"
mkdir -p "$marker_dir"
payload=$(cat)
if ! printf '%s' "$payload" | jq -e . >/dev/null 2>&1; then
  echo "invalid video auth payload" >&2
  exit 1
fi
provider=$(printf '%s' "$payload" | jq -r '.provider // empty')
account=$(printf '%s' "$payload" | jq -r '.accountId // empty')
token=$(printf '%s' "$payload" | jq -r '.token // empty')
model=$(printf '%s' "$payload" | jq -r '.model // empty')

clear_all() {
  rm -f "$marker_dir/video.json" "$marker_dir/video-auth.json"
}

if [ -z "$token" ]; then
  clear_all
  exit 0
fi
if [ -z "$provider" ]; then
  echo "video provider is required" >&2
  exit 1
fi

write_marker() {
  jq -n --arg provider "$provider" --arg model "$model" '{provider:$provider, model:$model}' > "$marker_dir/video.json"
}

write_key_auth() {
  jq -n --arg account "$account" --arg token "$token" '{accountId:(if $account == "" then null else $account end), token:$token}' > "$marker_dir/video-auth.json.tmp"
  mv "$marker_dir/video-auth.json.tmp" "$marker_dir/video-auth.json"
  chmod 600 "$marker_dir/video-auth.json"
}

case "$provider" in
  xai)
    model="${model:-grok-imagine-video-1.5}"
    clear_all
    mkdir -p "$marker_dir"
    write_key_auth
    write_marker
    ;;
  xai-gateway)
    if [ -z "$account" ]; then
      clear_all
      exit 0
    fi
    model="${model:-grok-imagine-video-1.5}"
    clear_all
    mkdir -p "$marker_dir"
    write_key_auth
    write_marker
    ;;
  openai)
    model="${model:-sora-2}"
    clear_all
    mkdir -p "$marker_dir"
    write_key_auth
    write_marker
    ;;
  google)
    model="${model:-veo-3.0-fast-generate-001}"
    clear_all
    mkdir -p "$marker_dir"
    write_key_auth
    write_marker
    ;;
  replicate)
    model="${model:-google/veo-3-fast}"
    clear_all
    mkdir -p "$marker_dir"
    write_key_auth
    write_marker
    ;;
  fal)
    model="${model:-fal-ai/veo3}"
    clear_all
    mkdir -p "$marker_dir"
    write_key_auth
    write_marker
    ;;
  *)
    echo "unsupported video provider: $provider" >&2
    exit 1
    ;;
esac
