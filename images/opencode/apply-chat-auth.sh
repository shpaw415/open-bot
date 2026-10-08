#!/bin/sh
set -eu
auth_dir="${HOME}/.local/share/opencode"
auth_file="${auth_dir}/auth.json"
mkdir -p "$auth_dir"
[ -f "$auth_file" ] || printf '{}' > "$auth_file"
payload=$(cat)
if ! printf '%s' "$payload" | jq -e 'type == "object"' >/dev/null 2>&1; then
  echo "invalid chat auth payload" >&2
  exit 1
fi

applied=""
removed=""

providers=$(printf '%s' "$payload" | jq -r '[(.entries // [])[] | select((.provider // "") != "" and (.key // "") != "") | .provider] | join(" ")')
for provider in $providers; do
  key=$(printf '%s' "$payload" | jq -r --arg p "$provider" '[(.entries // [])[] | select(.provider == $p) | .key] | first // empty')
  [ -n "$key" ] || continue
  current_type=$(jq -r --arg p "$provider" '.[$p].type // ""' "$auth_file")
  if [ "$current_type" = "oauth" ]; then
    continue
  fi
  if [ "$current_type" = "api" ] && [ "$(jq -r --arg p "$provider" '.[$p].key // ""' "$auth_file")" = "$key" ]; then
    continue
  fi
  tmp="${auth_file}.tmp"
  jq --arg p "$provider" --arg k "$key" '.[$p] = {"type": "api", "key": $k}' "$auth_file" > "$tmp"
  mv "$tmp" "$auth_file"
  chmod 600 "$auth_file"
  applied="$applied $provider"
done

revoke_pairs=$(printf '%s' "$payload" | jq -r '[(.revoke // [])[] | select((.provider // "") != "") | "\(.provider)\t\(.key // "")"] | .[]')
while IFS="$(printf '\t')" read -r provider key; do
  [ -n "$provider" ] || continue
  current_type=$(jq -r --arg p "$provider" '.[$p].type // ""' "$auth_file")
  [ "$current_type" = "api" ] || continue
  current_key=$(jq -r --arg p "$provider" '.[$p].key // ""' "$auth_file")
  if [ -n "$key" ] && [ "$current_key" != "$key" ]; then
    continue
  fi
  tmp="${auth_file}.tmp"
  jq --arg p "$provider" 'del(.[$p])' "$auth_file" > "$tmp"
  mv "$tmp" "$auth_file"
  chmod 600 "$auth_file"
  removed="$removed $provider"
done <<EOF
$revoke_pairs
EOF

jq -n --arg applied "$applied" --arg removed "$removed" \
  '{changed: ($applied | split(" ") | map(select(length > 0))), removed: ($removed | split(" ") | map(select(length > 0)))}'
