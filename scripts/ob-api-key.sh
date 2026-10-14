#!/bin/sh
# ob-api-key — print a dashboard-registered provider API key for custom API calls.
# Talks to the open-bot control plane; never prints the auth token.
set -eu

BASE="${OPEN_BOT_CONTROL_URL:-http://open-bot:8787}"
TOKEN="${OPEN_BOT_LLM_TOKEN:?OPEN_BOT_LLM_TOKEN is not set}"

usage() {
  cat >&2 <<'EOF'
Usage:
  ob-api-key SLUG [--json]
  ob-api-key list
  ob-api-key -h|--help

Print the API key the user registered for a provider on the dashboard Keys
tab (xai, openai, google, anthropic, openrouter, cloudflare, stability,
replicate, fal, meshy, tripo, laya). With no key set, stdout stays empty and
the exit code is 1. Use the key inside commands and never print it in chat:

  curl -H "Authorization: Bearer $(ob-api-key xai)" https://api.x.ai/v1/...

Options:
  --json  print the full record (apiKey, accountId, baseUrl, gateway fields)
  list    show which slugs have keys, without secrets
EOF
}

request() {
  curl -sS -H "Authorization: Bearer $TOKEN" "$BASE$1"
}

urlencode() {
  printf '%s' "$1" | jq -sRr @uri
}

fail_on_error() {
  msg=$(printf '%s' "$1" | jq -r '.error // empty' 2>/dev/null) || msg=""
  if [ -n "$msg" ]; then
    echo "ob-api-key: $msg" >&2
    slugs=$(printf '%s' "$1" | jq -r '(.slugs // []) | join(", ")' 2>/dev/null) || slugs=""
    if [ -n "$slugs" ]; then
      echo "ob-api-key: known slugs: $slugs" >&2
    fi
    exit 1
  fi
}

[ $# -ge 1 ] || { usage; exit 2; }
cmd="$1"
shift

case "$cmd" in
  -h|--help|help)
    usage
    ;;
  list)
    out=$(request /api/keys)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '.keys[] | "- \(.label) [\(.slug)] \(if .hasKey then "set" else "not set" end)"'
    ;;
  -*)
    echo "unknown option: $cmd" >&2; usage; exit 2
    ;;
  *)
    slug="$cmd"
    json_out=""
    for arg in "$@"; do
      case "$arg" in
        --json) json_out=1 ;;
        *) echo "unknown option: $arg" >&2; usage; exit 2 ;;
      esac
    done
    out=$(request "/api/keys/$(urlencode "$slug")")
    fail_on_error "$out"
    if [ -n "$json_out" ]; then
      printf '%s\n' "$out"
    else
      printf '%s\n' "$out" | jq -r '.apiKey'
    fi
    ;;
esac
