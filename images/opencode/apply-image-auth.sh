#!/bin/sh
set -eu
cf_dir="${HOME}/.config/cf-ai"
marker_dir="${HOME}/.config/open-bot"
mkdir -p "$cf_dir" "$marker_dir"
payload=$(cat)
if ! printf '%s' "$payload" | jq -e . >/dev/null 2>&1; then
  echo "invalid image auth payload" >&2
  exit 1
fi
provider=$(printf '%s' "$payload" | jq -r '.provider // empty')
account=$(printf '%s' "$payload" | jq -r '.accountId // empty')
token=$(printf '%s' "$payload" | jq -r '.token // empty')
model=$(printf '%s' "$payload" | jq -r '.model // empty')

clear_all() {
  rm -f "$cf_dir/auth.json" "$cf_dir/image-model" "$marker_dir/image.json" "$marker_dir/image-auth.json"
}

if [ -z "$token" ]; then
  clear_all
  exit 0
fi
if [ -z "$provider" ]; then
  echo "image provider is required" >&2
  exit 1
fi

write_marker() {
  jq -n --arg provider "$provider" --arg model "$model" '{provider:$provider, model:$model}' > "$marker_dir/image.json"
}

write_key_auth() {
  jq -n --arg account "$account" --arg token "$token" '{accountId:(if $account == "" then null else $account end), token:$token}' > "$marker_dir/image-auth.json.tmp"
  mv "$marker_dir/image-auth.json.tmp" "$marker_dir/image-auth.json"
  chmod 600 "$marker_dir/image-auth.json"
}

case "$provider" in
  cloudflare-workers-ai)
    if [ -z "$account" ]; then
      clear_all
      exit 0
    fi
    if [ -z "$model" ]; then
      model="@cf/black-forest-labs/flux-2-klein-9b"
    fi
    clear_all
    mkdir -p "$cf_dir" "$marker_dir"
    printf '%s' "$payload" | jq '{backend:"workers-ai", accountId:.accountId, token:.token}' > "$cf_dir/auth.json.tmp"
    mv "$cf_dir/auth.json.tmp" "$cf_dir/auth.json"
    chmod 600 "$cf_dir/auth.json"
    printf '%s\n' "$model" > "$cf_dir/image-model.tmp"
    mv "$cf_dir/image-model.tmp" "$cf_dir/image-model"
    chmod 600 "$cf_dir/image-model"
    write_marker
    ;;
  xai|xai-gateway)
    if [ "$provider" = "xai-gateway" ] && [ -z "$account" ]; then
      clear_all
      exit 0
    fi
    model="${model:-grok-imagine-image}"
    clear_all
    mkdir -p "$marker_dir"
    write_key_auth
    write_marker
    ;;
  openai)
    model="${model:-gpt-image-1}"
    clear_all
    mkdir -p "$marker_dir"
    write_key_auth
    write_marker
    ;;
  google)
    model="${model:-imagen-4.0-generate-001}"
    clear_all
    mkdir -p "$marker_dir"
    write_key_auth
    write_marker
    ;;
  stability)
    model="${model:-core}"
    clear_all
    mkdir -p "$marker_dir"
    write_key_auth
    write_marker
    ;;
  replicate)
    model="${model:-black-forest-labs/flux-schnell}"
    clear_all
    mkdir -p "$marker_dir"
    write_key_auth
    write_marker
    ;;
  *)
    echo "unsupported image provider: $provider" >&2
    exit 1
    ;;
esac
