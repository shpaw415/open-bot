#!/bin/sh
# Team-mode shared OpenCode provider auth: merges the admin's auth.json
# snapshot (each entry may be `api` or `oauth`) into this desktop's auth.json.
# Shared entries overwrite same-provider ids; everything else is preserved.
# stdin: {"entries": {"<providerId>": {...auth entry...}}}
# stdout: {"changed": ["<providerId>", ...]}
set -eu
auth_dir="${HOME}/.local/share/opencode"
auth_file="${auth_dir}/auth.json"
mkdir -p "$auth_dir"
[ -f "$auth_file" ] || printf '{}' > "$auth_file"
payload=$(cat)
if ! printf '%s' "$payload" | jq -e '(.entries // {}) | type == "object"' >/dev/null 2>&1; then
  echo "invalid opencode auth payload" >&2
  exit 1
fi

changed=""

providers=$(printf '%s' "$payload" | jq -r '[(.entries // {}) | keys[]] | join(" ")')
for provider in $providers; do
  shared_type=$(printf '%s' "$payload" | jq -r --arg p "$provider" '(.entries[$p].type // "")')
  shared_blob=$(printf '%s' "$payload" | jq -c --arg p "$provider" '(.entries[$p])')
  [ -n "$shared_blob" ] || continue
  [ "$shared_type" = "api" ] || [ "$shared_type" = "oauth" ] || continue
  if [ "$(jq -c --arg p "$provider" '.[$p] // null' "$auth_file")" = "$shared_blob" ]; then
    continue
  fi
  tmp="${auth_file}.tmp"
  jq --arg p "$provider" --argjson e "$shared_blob" '.[$p] = $e' "$auth_file" > "$tmp"
  mv "$tmp" "$auth_file"
  chmod 600 "$auth_file"
  changed="$changed $provider"
done

jq -n --arg changed "$changed" \
  '{changed: ($changed | split(" ") | map(select(length > 0)))}'
