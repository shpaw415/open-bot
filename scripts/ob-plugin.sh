#!/bin/sh
# ob-plugin — search, install, publish, and maintain open-bot plugins.
# Talks to the open-bot control plane; never prints the auth token.
set -eu

BASE="${OPEN_BOT_CONTROL_URL:-http://open-bot:8787}"
TOKEN="${OPEN_BOT_LLM_TOKEN:?OPEN_BOT_LLM_TOKEN is not set}"
CREATE_ROOT="${HOME}/plugins-create"
MANIFEST_FILE="open-bot.plugin.json"

usage() {
  cat >&2 <<'EOF'
Usage:
  ob-plugin new NAME                 scaffold a plugin project in ~/plugins-create/NAME
  ob-plugin validate DIR             validate DIR/open-bot.plugin.json
  ob-plugin publish DIR              publish the plugin to the marketplace (repo + release must exist)
  ob-plugin search [QUERY]           search the marketplace
  ob-plugin info ID                  marketplace details for one plugin
  ob-plugin install ID [--version X] [--yes]   install a plugin (--yes skips the consent prompt)
  ob-plugin list                     list installed plugins
  ob-plugin remove ID                uninstall a plugin
  ob-plugin enable ID | disable ID   toggle a plugin
  ob-plugin settings ID [key=value]  show or update plugin settings
  ob-plugin issue ID TITLE [BODY]    file a GitHub issue on the plugin repo
  ob-plugin comments ID              read marketplace discussion
  ob-plugin comment ID TEXT          post to marketplace discussion

Plugin layout (DIR):
  open-bot.plugin.json   the manifest (id, version, skills, personas, cron, tools, ...)
  README.md              shown on the marketplace page

Publish checklist (run before ob-plugin publish):
  cd ~/plugins-create/NAME
  git init -b main && git add -A && git commit -m "v1.0.0"
  gh repo create OWNER/NAME --public --source . --push
  gh release create v1.0.0 -R OWNER/NAME --notes "First release"
  ob-plugin publish ~/plugins-create/NAME
EOF
}

request() {
  method="$1"
  path="$2"
  body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" \
      -H "content-type: application/json" -d "$body" "$BASE$path"
  else
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" "$BASE$path"
  fi
}

fail_on_error() {
  msg=$(printf '%s' "$1" | jq -r 'if type == "object" then (.error // empty) else empty end' 2>/dev/null) || msg=""
  if [ -n "$msg" ]; then
    echo "ob-plugin: $msg" >&2
    exit 1
  fi
}

urlencode() {
  printf '%s' "$1" | jq -sRr @uri
}

[ $# -ge 1 ] || { usage; exit 2; }
cmd="$1"
shift

case "$cmd" in
  new)
    [ $# -eq 1 ] || { usage; exit 2; }
    name="$1"
    if ! printf '%s' "$name" | grep -Eq '^[a-z0-9][a-z0-9-]{1,62}$'; then
      echo "ob-plugin: NAME must be 2-63 lowercase letters, digits, hyphens" >&2
      exit 2
    fi
    dir="$CREATE_ROOT/$name"
    [ ! -e "$dir" ] || { echo "ob-plugin: $dir already exists" >&2; exit 2; }
    mkdir -p "$dir"
    repo_hint="OWNER/$name"
    jq -n --arg id "$name" --arg repo "$repo_hint" \
      '{
        id: $id,
        name: $id,
        version: "0.1.0",
        description: "What this plugin does for the agent.",
        author: "open-bot agent",
        repo: $repo,
        category: "utilities",
        tags: [],
        skills: [
          {
            name: $id,
            description: "When to load this skill",
            body: "# " + $id + "\n\nInstructions for the agent.\n"
          }
        ]
      }' > "$dir/$MANIFEST_FILE"
    cat > "$dir/README.md" <<EOF
# $name

open-bot plugin. Edit \`$MANIFEST_FILE\`, then:

\`\`\`sh
ob-plugin validate ~/plugins-create/$name
git init -b main && git add -A && git commit -m "v0.1.0"
gh repo create $repo_hint --public --source . --push
gh release create v0.1.0 -R $repo_hint --notes "First release"
ob-plugin publish ~/plugins-create/$name
\`\`\`

Manifest quick reference:
- skills[]: {name, description, body} — installed into the desktop's OpenViking
- personas[]: {name, instruction} — personalities the thread picker can choose
- cron[]: {name, message, everySeconds | cronExpr} — scheduled jobs
- tools[]: {name, content, exec} — files installed into /usr/local/bin
- files[]: {name, source, exec} — text payloads fetched from the reviewed release tarball and installed next to tools
- configs[]: {key, label, def} — settings shown on the Plugins page
- setup: {commands: [...], uninstall: [...]} — shell commands run as root in the desktop at install and on every desktop start (commands must be idempotent, e.g. "apt-get install -y figlet"); uninstall runs at uninstall; the user sees them in the consent prompt, log at ~/.open-bot/plugin-init/<id>.log
- permissions.vaultRead / vaultCreate: vault key slugs
- dashboard.tabs[]: {id, title, kind: page|iframe, url?, cards?}
- textbox: renderers, commands, buttons, validators, attachments
- opencode: {plugin: [npm...], mcp: {...}, agents: {...new agent defs...}, agentTools: {agent: {glob: bool}}}
- Helper sessions your plugin spawns must be titled with the "worker:" prefix so they stay out of the dashboard thread list.
EOF
    echo "scaffolded $dir"
    ;;
  validate)
    [ $# -eq 1 ] || { usage; exit 2; }
    file="$1/$MANIFEST_FILE"
    [ -f "$file" ] || { echo "ob-plugin: missing $file" >&2; exit 2; }
    body=$(jq -n --slurpfile m "$file" '{manifest: $m[0]}')
    out=$(request POST /api/plugins/validate "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq -r 'if .ok then "valid\n" + (.permissions[]? | " - " + .) else "invalid\n" + ([.issues[]? | " - \(.path // "manifest"): \(.message)"] | join("\n")) end'
    [ "$(printf '%s' "$out" | jq -r '.ok')" = "true" ]
    ;;
  publish)
    [ $# -eq 1 ] || { usage; exit 2; }
    file="$1/$MANIFEST_FILE"
    [ -f "$file" ] || { echo "ob-plugin: missing $file" >&2; exit 2; }
    version=$(jq -r '.version' "$file")
    repo=$(jq -r '.repo' "$file")
    if curl -fsSL -o /dev/null "https://raw.githubusercontent.com/$repo/v$version/$MANIFEST_FILE" 2>/dev/null; then
      :
    else
      echo "ob-plugin: warning: $MANIFEST_FILE for v$version is not on GitHub yet ($repo tag v$version)." >&2
      echo "  Push the repo and create the release first — see ob-plugin help." >&2
      printf 'publish anyway? [y/N] '
      read -r answer
      case "$answer" in y|Y|yes|Yes) ;; *) exit 1 ;; esac
    fi
    body=$(jq -n --slurpfile m "$file" '{manifest: $m[0]}')
    out=$(request POST /api/plugins/publish "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{pluginId, version, marketplace, guardCronId}'
    echo "guard cron keeps this plugin maintained daily: ob-cron list | grep guard"
    ;;
  search)
    query="${1:-}"
    if [ -n "$query" ]; then
      out=$(request GET "/api/plugins/market?q=$(urlencode "$query")")
    else
      out=$(request GET /api/plugins/market)
    fi
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '.plugins[]? | "- \(.id) v\(.version) [\(.status)] \(.name) — \(.description)\(if .downloads then " (\(.downloads) installs)" else "" end)"'
    ;;
  info)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request GET "/api/plugins/market/$(urlencode "$1")")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{id: .plugin.id, name: .plugin.name, version: .plugin.version, status: .plugin.status, description: .plugin.description, author: .plugin.author, repo: .plugin.repo, category: .plugin.category, tags: .plugin.tags, downloads: .plugin.downloads, versions: [.versions[].version]}'
    ;;
  install)
    [ $# -ge 1 ] || { usage; exit 2; }
    id="$1"
    shift
    version=""
    yes=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --version) [ $# -ge 2 ] || { usage; exit 2; }; version="$2"; shift 2 ;;
        --yes) yes=1; shift ;;
        *) echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    version_json="null"
    [ -n "$version" ] && version_json=$(jq -Rn --arg v "$version" '$v')
    body=$(jq -n --arg id "$id" --argjson v "$version_json" --argjson confirm "$([ "$yes" -eq 1 ] && echo true || echo false)" '{pluginId: $id, version: $v, confirm: $confirm}')
    out=$(request POST /api/plugins/install "$body")
    fail_on_error "$out"
    if printf '%s' "$out" | jq -e '.needsConfirm == true' >/dev/null 2>&1; then
      echo "this plugin needs confirmation (policy: manual):"
      printf '%s' "$out" | jq -r '.permissions[] | " - " + .'
      if printf '%s' "$out" | jq -e '.setupCommands | length > 0' >/dev/null 2>&1; then
        echo "setup commands (run as root in this desktop at install and on every desktop start):"
        printf '%s' "$out" | jq -r '.setupCommands[] | "   $ \(.)"'
      fi
      printf 'install? [y/N] '
      read -r answer
      case "$answer" in
        y|Y|yes|Yes)
          body=$(jq -n --arg id "$id" '{pluginId: $id, confirm: true}')
          out=$(request POST /api/plugins/install "$body")
          fail_on_error "$out"
          ;;
        *) echo "cancelled"; exit 1 ;;
      esac
    fi
    printf '%s' "$out" | jq '{pluginId: .plugin.pluginId, version: .plugin.version, name: .plugin.name}'
    ;;
  list)
    out=$(request GET /api/plugins/installed)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '.plugins[] | "- \(.pluginId) v\(.version)\(if .enabled then "" else " (disabled)" end) \(.name) — \(.description)"'
    ;;
  remove)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request DELETE "/api/plugins/installed/$(urlencode "$1")")
    fail_on_error "$out"
    echo "removed $1"
    ;;
  enable|disable)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request POST "/api/plugins/installed/$(urlencode "$1")/$cmd")
    fail_on_error "$out"
    echo "$cmd $1"
    ;;
  settings)
    [ $# -ge 1 ] || { usage; exit 2; }
    id="$1"
    shift
    if [ $# -eq 0 ]; then
      out=$(request GET "/api/plugins/installed")
      fail_on_error "$out"
      printf '%s' "$out" | jq --arg id "$id" '.plugins[] | select(.pluginId == $id) | .manifest.configs[]? | {key, label, def}'
      exit 0
    fi
    settings='{}'
    for pair in "$@"; do
      key=${pair%%=*}
      value=${pair#*=}
      [ "$key" != "$pair" ] || { echo "ob-plugin: expected key=value, got $pair" >&2; exit 2; }
      settings=$(printf '%s' "$settings" | jq --arg k "$key" --arg v "$value" '. + {($k): $v}')
    done
    body=$(jq -n --argjson s "$settings" '{settings: $s}')
    out=$(request PUT "/api/plugins/installed/$(urlencode "$id")/settings" "$body")
    fail_on_error "$out"
    echo "updated settings for $id"
    ;;
  issue)
    [ $# -ge 2 ] || { usage; exit 2; }
    id="$1"
    title="$2"
    body_text="${3:-}"
    body=$(jq -n --arg id "$id" --arg t "$title" --arg b "$body_text" '{pluginId: $id, title: $t, body: $b}')
    out=$(request POST /api/plugins/issue "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{number, url}'
    ;;
  comments)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request GET "/api/plugins/market/$(urlencode "$1")/comments")
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '.comments[]? | "\(.createdAt | todate) \(.author): \(.body)"'
    ;;
  comment)
    [ $# -ge 2 ] || { usage; exit 2; }
    id="$1"
    shift
    text="$*"
    body=$(jq -n --arg b "$text" '{body: $b}')
    out=$(request POST "/api/plugins/market/$(urlencode "$id")/comments" "$body")
    fail_on_error "$out"
    echo "comment posted"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2
    usage
    exit 2
    ;;
esac
