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
  ob-plugin publish DIR --dev        staging loop for a dev-tag version: commit, push, force-move the
                                     v<tag> tag, clobber the release, publish, then reinstall pinned
                                     (--no-commit skips the git commit step)
  ob-plugin doctor DIR               pre-publish checks: manifest validity, repo reachability, tag
  ob-plugin guard status ID          show the plugin's maintenance guard cron
  ob-plugin guard off ID             delete the plugin's maintenance guard cron (stop maintaining)
  ob-plugin search [QUERY]           search the marketplace
  ob-plugin info ID                  marketplace details for one plugin
  ob-plugin install ID [--version X] [--yes]   install a marketplace plugin (--version takes semver or a dev tag like beta-1; --yes skips the consent prompt)
  ob-plugin install --path DIR [--yes]   install a local plugin directory (shows as (local); reinstall re-reads DIR)
  ob-plugin list                     list installed plugins
  ob-plugin outdated                 installed plugins with a newer marketplace version
  ob-plugin update ID [VERSION]      update an installed plugin (defaults to the newest known stable)
  ob-plugin remove ID                uninstall a plugin
  ob-plugin enable ID | disable ID   toggle a plugin (disable pauses its cron jobs and unloads its skills)
  ob-plugin setup ID                 re-run a plugin's root setup commands (retry after a failure)
  ob-plugin settings ID [key=value]  show or update plugin settings
  ob-plugin issue ID TITLE [BODY]    file a GitHub issue on the plugin repo
  ob-plugin notify ID TITLE [BODY]   post a dashboard notification as an installed plugin (needs permissions.notifications)
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

Staging a release (dev tags):
  Set the manifest version to a dev tag (e.g. "beta-1"), move the tag, publish,
  install pinned, stress-test, then bump to semver for the stable release:
  git tag -f vbeta-1 && git push -f origin vbeta-1
  ob-plugin publish ~/plugins-create/NAME
  ob-plugin install NAME --version beta-1
  Dev tags stay out of marketplace search; republishing the same tag overwrites
  it, and reinstalling the pinned version updates the install in place.

Local development (no publish):
  ob-plugin install --path ~/plugins-create/NAME
  The plugin appears in the installed list with (local) beside the name.
  Re-install from this command or the Plugins page re-reads that directory.
EOF
}

request() {
  method="$1"
  path="$2"
  body="${3:-}"
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    if [ -n "$body" ]; then
      out=$(curl -sS -m 300 -X "$method" -H "Authorization: Bearer $TOKEN" \
        -H "content-type: application/json" -d "$body" "$BASE$path" 2>&1) &&
        { printf '%s' "$out"; return 0; }
    else
      out=$(curl -sS -m 300 -X "$method" -H "Authorization: Bearer $TOKEN" \
        "$BASE$path" 2>&1) &&
        { printf '%s' "$out"; return 0; }
    fi
    if [ "$attempt" -ge 4 ]; then
      echo "ob-plugin: control plane unreachable after $attempt attempts ($out)" >&2
      return 1
    fi
    sleep $((attempt * 2))
  done
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
    repo_hint="OWNER/$name"
    schema="/home/agent/.config/opencode/skills/plugin/open-bot.plugin.schema.json"
    stage=$(mktemp -d)
    trap 'rm -rf "$stage"' EXIT
    jq -n --arg id "$name" --arg repo "$repo_hint" --arg schema "$schema" \
      '{
        "$schema": $schema,
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
            body: ("# " + $id + "\n\nInstructions for the agent.\n")
          }
        ]
      }' > "$stage/$MANIFEST_FILE"
    cat > "$stage/README.md" <<EOF
# $name

open-bot plugin. Edit \`$MANIFEST_FILE\`, then install it locally:

\`\`\`sh
ob-plugin validate ~/plugins-create/$name
ob-plugin install --path ~/plugins-create/$name
\`\`\`

Publish when it is ready:

\`\`\`sh
git init -b main && git add -A && git commit -m "v0.1.0"
gh repo create $repo_hint --public --source . --push
gh release create v0.1.0 -R $repo_hint --notes "First release"
ob-plugin publish ~/plugins-create/$name
\`\`\`

While iterating on a dev tag (set \`version\` to e.g. \`beta-1\`), one command does
commit, tag, release, publish, and reinstall:

\`\`\`sh
ob-plugin publish ~/plugins-create/$name --dev
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
- opencode: {plugin: [npm...], mcp: {...}, agents: {...new agent defs...}, agentTools: {agent: {glob: bool}}, agentsMd: "standing instructions injected next to AGENTS.md (max 4000 chars, no secrets)"}
- Helper sessions your plugin spawns must be titled with the "worker:" prefix so they stay out of the dashboard thread list.
EOF
    mkdir -p "$CREATE_ROOT"
    mv "$stage" "$dir"
    trap - EXIT
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
    dir=""
    dev=0
    no_commit=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --dev) dev=1; shift ;;
        --no-commit) no_commit=1; shift ;;
        -*) echo "unknown option: $1" >&2; usage; exit 2 ;;
        *)
          [ -z "$dir" ] || { echo "ob-plugin: unexpected argument: $1" >&2; usage; exit 2; }
          dir="$1"
          shift
          ;;
      esac
    done
    [ -n "$dir" ] || { usage; exit 2; }
    file="$dir/$MANIFEST_FILE"
    [ -f "$file" ] || { echo "ob-plugin: missing $file" >&2; exit 2; }
    plugin_id=$(jq -r '.id' "$file")
    version=$(jq -r '.version' "$file")
    repo=$(jq -r '.repo' "$file")
    stable=1
    printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || stable=0
    if [ "$dev" -eq 1 ]; then
      if [ "$stable" -eq 1 ]; then
        echo "ob-plugin: --dev stages a dev tag (e.g. beta-1); manifest version is $version" >&2
        exit 2
      fi
      if [ -d "$dir/.git" ]; then
        if [ "$no_commit" -eq 0 ]; then
          git -C "$dir" add -A
          # First-time publishers have no git identity; set a repo-local one
          # rather than failing the commit.
          git -C "$dir" config user.email >/dev/null 2>&1 ||
            git -C "$dir" config user.email "agent@open-bot.local"
          git -C "$dir" config user.name >/dev/null 2>&1 ||
            git -C "$dir" config user.name "open-bot agent"
          if ! git -C "$dir" diff --cached --quiet 2>/dev/null; then
            git -C "$dir" commit -m "v$version" >/dev/null
          fi
        fi
        branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD)
        git -C "$dir" push origin "$branch"
        git -C "$dir" tag -f "v$version" >/dev/null
        git -C "$dir" push -f origin "v$version"
        gh release create "v$version" -R "$repo" --notes "Dev build $version" --clobber >/dev/null 2>&1 ||
          gh release edit "v$version" -R "$repo" --draft=false >/dev/null 2>&1 ||
          true
      else
        echo "ob-plugin: $dir is not a git repo; expecting tag v$version to exist already" >&2
      fi
    else
      if curl -fsSL -o /dev/null "https://raw.githubusercontent.com/$repo/v$version/$MANIFEST_FILE" 2>/dev/null; then
        :
      else
        echo "ob-plugin: warning: $MANIFEST_FILE for v$version is not on GitHub yet ($repo tag v$version)." >&2
        echo "  Push the repo and create the tag first — see ob-plugin help (dev tags may be force-moved)." >&2
        printf 'publish anyway? [y/N] '
        read -r answer
        case "$answer" in y|Y|yes|Yes) ;; *) exit 1 ;; esac
      fi
    fi
    body=$(jq -n --slurpfile m "$file" '{manifest: $m[0]}')
    out=$(request POST /api/plugins/publish "$body")
    fail_on_error "$out"
    security_status=$(printf '%s' "$out" | jq -r '.marketplace.security.status // empty')
    review_status=$(printf '%s' "$out" | jq -r '.marketplace.review.status // empty')
    poll=$(printf '%s' "$out" | jq -r '.review.poll // empty')
    if [ -n "$poll" ] && { [ "$security_status" = "queued" ] || [ "$security_status" = "running" ] || [ "$review_status" = "queued" ] || [ "$review_status" = "running" ]; }; then
      echo "ob-plugin: waiting for security review..." >&2
      deadline=$(( $(date +%s) + 480 ))
      while :; do
        polled=$(request GET "$poll")
        fail_on_error "$polled"
        status=$(printf '%s' "$polled" | jq -r '.security.status // .status // empty')
        case "$status" in
          queued|running|"")
            if [ "$(date +%s)" -ge "$deadline" ]; then
              echo "ob-plugin: security review still ${status:-pending} after 8 minutes" >&2
              break
            fi
            sleep 2
            ;;
          *)
            out=$(printf '%s' "$out" | jq --argjson polled "$polled" --arg status "$status" '.marketplace.security = $polled.security | .marketplace.review.status = $status | .marketplace.status = ($polled.pluginStatus // .marketplace.status)')
            if [ "$status" = "error" ]; then
              echo "ob-plugin: security review error: $(printf '%s' "$polled" | jq -r '.security.error // "security review failed"')" >&2
            fi
            break
            ;;
        esac
      done
    fi
    printf '%s' "$out" | jq '{pluginId, version, marketplace, guardCronId, review}'
    echo "guard cron keeps this plugin maintained daily: ob-cron list | grep guard"
    if [ "$dev" -eq 1 ]; then
      installed=$(request GET /api/plugins/installed)
      if printf '%s' "$installed" | jq -e --arg id "$plugin_id" '.plugins[] | select(.pluginId == $id and .source == "marketplace")' >/dev/null 2>&1; then
        echo "ob-plugin: reinstalling pinned v$version to pick up the republish..." >&2
        rebody=$(jq -n --arg id "$plugin_id" --arg v "$version" '{pluginId: $id, version: $v, confirm: true}')
        reout=$(request POST /api/plugins/install "$rebody")
        fail_on_error "$reout"
      fi
    fi
    ;;
  guard)
    [ $# -eq 2 ] || { usage; exit 2; }
    guard_action="$1"
    plugin_id="$2"
    case "$guard_action" in
      status|off) ;;
      *) usage; exit 2 ;;
    esac
    jobs=$(request GET /api/cron)
    fail_on_error "$jobs"
    job_id=$(printf '%s' "$jobs" | jq -r --arg name "plugin:$plugin_id:guard" '.[] | select(.name == $name) | .id' | head -1)
    if [ -z "$job_id" ]; then
      echo "no guard cron for $plugin_id"
      exit 0
    fi
    if [ "$guard_action" = "status" ]; then
      printf '%s' "$jobs" | jq -r --arg name "plugin:$plugin_id:guard" '.[] | select(.name == $name) | "guard: \(.name) [\(.id)] \(if .enabled then "enabled" else "paused" end), runs=\(.runCount), next=\(if .nextRunAt then (.nextRunAt / 1000 | strftime("%Y-%m-%dT%H:%M:%SZ")) else "unscheduled" end)"'
    else
      out=$(request DELETE "/api/cron/$(urlencode "$job_id")")
      fail_on_error "$out"
      echo "guard cron for $plugin_id deleted (the plugin is no longer maintained)"
    fi
    ;;
  doctor)
    [ $# -eq 1 ] || { usage; exit 2; }
    file="$1/$MANIFEST_FILE"
    [ -f "$file" ] || { echo "ob-plugin: missing $file" >&2; exit 2; }
    body=$(jq -n --slurpfile m "$file" '{manifest: $m[0]}')
    out=$(request POST /api/plugins/validate "$body")
    if printf '%s' "$out" | jq -e '.ok == true' >/dev/null 2>&1; then
      echo "manifest: valid"
    else
      echo "manifest: invalid"
      printf '%s' "$out" | jq -r '.issues[]? | " - \(.path // "manifest"): \(.message)"'
      exit 1
    fi
    repo=$(jq -r '.repo' "$file")
    version=$(jq -r '.version' "$file")
    problems=0
    if curl -fsSL -o /dev/null "https://raw.githubusercontent.com/$repo/HEAD/README.md" 2>/dev/null; then
      echo "repo: reachable ($repo)"
    else
      echo "repo: NOT reachable ($repo)"
      problems=1
    fi
    if curl -fsSL -o /dev/null "https://raw.githubusercontent.com/$repo/v$version/$MANIFEST_FILE" 2>/dev/null; then
      echo "release tag: v$version serves the manifest"
    else
      echo "release tag: v$version missing (push the tag + release before publishing)"
      problems=1
    fi
    if [ "$problems" -ne 0 ]; then
      exit 1
    fi
    echo "ready: ob-plugin publish $1"
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
    printf '%s' "$out" | jq '{id: .plugin.id, name: .plugin.name, version: .plugin.version, status: .plugin.status, description: .plugin.description, author: .plugin.author, repo: .plugin.repo, category: .plugin.category, tags: .plugin.tags, downloads: .plugin.downloads, versions: [.versions[].version | . + (if test("^[0-9]+\\.[0-9]+\\.[0-9]+$") then "" else " (dev)" end)]}'
    ;;
  install)
    path=""
    id=""
    version=""
    yes=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --path) [ $# -ge 2 ] || { usage; exit 2; }; path="$2"; shift 2 ;;
        --version) [ $# -ge 2 ] || { usage; exit 2; }; version="$2"; shift 2 ;;
        --yes) yes=1; shift ;;
        -*) echo "unknown option: $1" >&2; usage; exit 2 ;;
        *)
          if [ -n "$id" ]; then
            echo "ob-plugin: unexpected argument: $1" >&2
            usage
            exit 2
          fi
          id="$1"
          shift
          ;;
      esac
    done
    if [ -n "$path" ] && { [ -n "$id" ] || [ -n "$version" ]; }; then
      echo "ob-plugin: --path cannot be combined with an id or --version" >&2
      exit 2
    fi
    if [ -z "$path" ] && [ -z "$id" ]; then
      usage
      exit 2
    fi
    confirm=false
    [ "$yes" -eq 1 ] && confirm=true
    if [ -n "$path" ]; then
      [ -d "$path" ] || { echo "ob-plugin: not a directory: $path" >&2; exit 2; }
      [ -f "$path/$MANIFEST_FILE" ] || { echo "ob-plugin: missing $path/$MANIFEST_FILE" >&2; exit 2; }
      abs=$(realpath "$path") || { echo "ob-plugin: cannot resolve $path" >&2; exit 2; }
      body=$(jq -n --arg path "$abs" --argjson confirm "$confirm" '{path: $path, confirm: $confirm}')
    else
      version_json="null"
      [ -n "$version" ] && version_json=$(jq -Rn --arg v "$version" '$v')
      body=$(jq -n --arg id "$id" --argjson v "$version_json" --argjson confirm "$confirm" '{pluginId: $id, version: $v, confirm: $confirm}')
    fi
    echo "installing (skill indexing on OpenViking can take up to ~2 min)..." >&2
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
          if [ -n "$path" ]; then
            body=$(jq -n --arg path "$abs" '{path: $path, confirm: true}')
          else
            body=$(jq -n --arg id "$id" --argjson v "$version_json" '{pluginId: $id, version: $v, confirm: true}')
          fi
          echo "installing (skill indexing on OpenViking can take up to ~2 min)..." >&2
          out=$(request POST /api/plugins/install "$body")
          fail_on_error "$out"
          ;;
        *) echo "cancelled"; exit 1 ;;
      esac
    fi
    printf '%s' "$out" | jq '{pluginId: .plugin.pluginId, version: .plugin.version, name: .plugin.name, source: (.plugin.source // "marketplace")}'
    ;;
  list)
    out=$(request GET /api/plugins/installed)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '.plugins[] | "- \(.pluginId) v\(.version)\(if .updateAvailable then " -> v\(.updateAvailable) available" else "" end)\(if .source == "local" then " (local)" else "" end)\(if .enabled then "" else " (disabled)" end)\(if .init and .init.ok == false then " (setup failed — ob-plugin setup \(.pluginId))" else "" end) \(.name) — \(.description)"'
    ;;
  outdated)
    out=$(request GET /api/plugins/installed)
    fail_on_error "$out"
    count=$(printf '%s' "$out" | jq '[.plugins[] | select(.updateAvailable)] | length')
    if [ "$count" = "0" ]; then
      echo "all installed plugins are up to date"
    else
      printf '%s' "$out" | jq -r '.plugins[] | select(.updateAvailable) | "- \(.pluginId): v\(.version) -> v\(.updateAvailable)"'
    fi
    ;;
  update)
    [ $# -ge 1 ] || { usage; exit 2; }
    plugin_id="$1"
    target="${2:-}"
    if [ -z "$target" ]; then
      out=$(request GET /api/plugins/installed)
      fail_on_error "$out"
      target=$(printf '%s' "$out" | jq -r --arg id "$plugin_id" '.plugins[] | select(.pluginId == $id) | .updateAvailable // empty')
      if [ -z "$target" ]; then
        echo "ob-plugin: $plugin_id is up to date (pin one with: ob-plugin update $plugin_id VERSION)"
        exit 0
      fi
    fi
    body=$(jq -n --arg id "$plugin_id" --arg v "$target" '{pluginId: $id, version: $v, confirm: true}')
    echo "installing v$target (skill indexing on OpenViking can take up to ~2 min)..." >&2
    out=$(request POST /api/plugins/install "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{pluginId: .plugin.pluginId, version: .plugin.version}'
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
  setup)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request POST "/api/plugins/installed/$(urlencode "$1")/setup")
    fail_on_error "$out"
    echo "setup re-run for $1"
    ;;
  settings)
    [ $# -ge 1 ] || { usage; exit 2; }
    id="$1"
    shift
    if [ $# -eq 0 ]; then
      out=$(request GET "/api/plugins/installed")
      fail_on_error "$out"
      printf '%s' "$out" | jq --arg id "$id" \
        '.plugins[] | select(.pluginId == $id) | . as $p | .manifest.configs[]? | . as $c |
         (($p.settings // {})[$c.key]) as $v |
         {key: .key, label: .label, type: (.type // (if .secret then "secret" else "string" end)), options: (.options // []), "default": (if (.type == "secret") or .secret then "(hidden)" else .def end), value: (if (.type == "secret") or .secret then (if $v == null then null else "(saved, hidden)" end) else $v end)}'
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
  notify)
    [ $# -ge 2 ] || { usage; exit 2; }
    plugin_id="$1"
    title="$2"
    shift 2
    text="$*"
    body=$(jq -n --arg id "$plugin_id" --arg t "$title" --arg b "$text" '{pluginId: $id, title: $t, body: $b}')
    out=$(request POST /api/plugins/notice "$body")
    fail_on_error "$out"
    echo "notification sent"
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
