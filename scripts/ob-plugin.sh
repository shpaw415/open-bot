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
                                     (also adds it to the dashboard project list, plugins group)
  ob-plugin validate DIR             validate DIR/open-bot.plugin.json
  ob-plugin publish DIR [--yes]      publish the plugin to the marketplace (repo + release must
                                      exist; --yes skips the non-TTY confirmation, so scripts
                                      don't need `yes |`)
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
  ob-plugin guide ID                 print the plugin's CONFIG.md configuration guide (how to configure it with the user)
  ob-plugin vault ID                 list the plugin's vaultCreate slugs (hasKey only, never values)
  ob-plugin vault ID SLUG=value [--account ACCOUNT] [--url URL]
                                      fill or clear one of the plugin's vaultCreate slugs (write-only).
                                      The user can also set these (and the plugin's vaultRead slugs)
                                      on the dashboard: Plugins tab -> Settings -> Vault keys
  ob-plugin issue ID TITLE [BODY]    file a GitHub issue on the plugin repo
  ob-plugin notify ID TITLE [BODY]   post a dashboard notification as an installed plugin (needs permissions.notifications)
  ob-plugin comments ID              read marketplace discussion
  ob-plugin comment ID TEXT          post to marketplace discussion

Plugin layout (DIR):
  open-bot.plugin.json   the manifest (id, version, skills, personas, cron, tools, ...)
  README.md              shown on the marketplace page
  CONFIG.md              configuration guide for the installing agent: how to
                         configure the plugin with the user (settings, vault
                         keys, walkthrough, verification). Installed to the
                         desktop as ~/.config/open-bot/plugin-<id>.CONFIG.md;
                         read it with `ob-plugin guide <id>` before configuring.

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

# Surface a failed page-server start from the install/update response.
page_warn() {
  if printf '%s' "$1" | jq -e '.plugin.page and .plugin.page.attempted and (.plugin.page.running | not)' >/dev/null 2>&1; then
    reason=$(printf '%s' "$1" | jq -r '.plugin.page.error // "did not come up in time"')
    id=$(printf '%s' "$1" | jq -r '.plugin.pluginId')
    echo "ob-plugin: warning: page server is not running ($reason)" >&2
    echo "  see ~/.open-bot/pages/$id.log on this desktop, or ob-plugin disable/enable $id to retry" >&2
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
- Write plugin code in TypeScript, not JavaScript: tool scripts (with a "#!/usr/bin/env bun" shebang), files[] payloads, and dashboard page servers are all .ts files — Bun runs .ts natively, no build step
- configs[]: {key, label, def} — settings shown on the Plugins page
- setup: {commands: [...], uninstall: [...]} — shell commands run as root in the desktop at install and on every desktop start (commands must be idempotent, e.g. "apt-get install -y figlet"); uninstall runs at uninstall; the user sees them in the consent prompt, log at ~/.open-bot/plugin-init/<id>.log
- permissions.vaultRead / vaultCreate: vault key slugs
- dashboard.tabs[]: {id, title, kind: page|iframe, url?, cards?}
- textbox: renderers, commands, buttons, validators, attachments
- opencode: {plugin: [npm...], mcp: {...}, agents: {...new agent defs...}, agentTools: {agent: {glob: bool}}, agentsMd: "standing instructions injected next to AGENTS.md (max 4000 chars, no secrets)"}
- Helper sessions your plugin spawns must be titled with the "worker:" prefix so they stay out of the dashboard thread list.

CONFIG.md (created alongside this file) is the configuration guide the
installing agent reads to configure the plugin with the user — fill it in
whenever the plugin declares configs[] or vault keys.
EOF
    cat > "$stage/CONFIG.md" <<EOF
# Configuring $name with the user

<!-- open-bot config guide placeholder: replace every section below before publishing -->

You are configuring the \`$name\` open-bot plugin on this desktop for the user.
Walk them through it step by step. Never print or echo secret values; fill
them with the write-only commands shown here.

## What this plugin needs

- One or two bullets: what the plugin does and what must be configured
  (settings, API keys, accounts) before it is useful.

## Settings

Change with \`ob-plugin settings $name KEY=value\` (or the Plugins page).

| key | type | default | what to ask the user |
| --- | ---- | ------- | -------------------- |
| example | string | example-value | The question to ask, and how to pick a good value |

## Vault keys

Fill with \`ob-plugin vault $name SLUG=value\` (write-only; never echo the value).
The user can also set them on the dashboard: Plugins tab → Settings →
Vault keys (the agent never sees the values either way).

- \`example-key\` — what it is and where the user creates/finds it.
- Keys the plugin only reads (vaultRead) are the user's own: shared provider
  slugs live on the Config page Keys tab; plugin-specific slugs can be set
  from the Vault keys section above. Point them there, do not ask for the
  value in chat.

## Walkthrough

1. Ask the user for the values above (only the ones still missing — check
   \`ob-plugin settings $name\` and \`ob-plugin vault $name\` first).
2. Fill each one as it is confirmed.
3. Restart or re-test anything the plugin needs after configuration.

## Verify

- The exact command or dashboard check that proves the plugin works now.

## Troubleshooting

- The most likely failure and its fix.
EOF
    mkdir -p "$CREATE_ROOT"
    mv "$stage" "$dir"
    trap - EXIT
    echo "scaffolded $dir"
    # Register the scaffold in the dashboard project list (grouped under the
    # "plugins" sub-category). Best effort, single attempt: a 409 means it is
    # already registered; any failure just prints a note and keeps the exit
    # code at 0 so the scaffold never fails because of this.
    out=$(curl -sS -m 10 -X POST -H "Authorization: Bearer $TOKEN" \
      -H "content-type: application/json" \
      -d "$(jq -nc --arg path "$dir" --arg name "$name" '{path: $path, name: $name}')" \
      "$BASE/api/projects" 2>/dev/null) && ok=1 || ok=0
    if [ "$ok" -eq 1 ] && printf '%s' "$out" | jq -e '.project.id' >/dev/null 2>&1; then
      echo "added to the project list (plugins)"
    elif [ "$ok" -eq 1 ] && printf '%s' "$out" | jq -re '.error' >/dev/null 2>&1; then
      echo "note: project entry not added ($(printf '%s' "$out" | jq -r '.error'))"
    else
      echo "note: could not reach the control plane to add the project entry"
    fi
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
    yes=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --dev) dev=1; shift ;;
        --no-commit) no_commit=1; shift ;;
        --yes) yes=1; shift ;;
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
        # gh release create has no --clobber: fall back to editing the
        # existing release (dev republishes force-move the tag instead).
        gh release create "v$version" -R "$repo" --notes "Dev build $version" >/dev/null 2>&1 ||
          gh release edit "v$version" -R "$repo" --notes "Dev build $version" --draft=false >/dev/null 2>&1 ||
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
        if [ "$yes" -eq 1 ]; then
          echo "ob-plugin: --yes given; publishing anyway" >&2
        elif [ ! -t 0 ]; then
          echo "ob-plugin: publish needs confirmation but stdin is not a terminal — declined" >&2
          echo "  (pass --yes to publish from a script instead of piping \`yes |\`)" >&2
          exit 1
        else
          printf 'publish anyway? [y/N] '
          read -r answer
          case "$answer" in y|Y|yes|Yes) ;; *) exit 1 ;; esac
        fi
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
    dir="$1"
    file="$dir/$MANIFEST_FILE"
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
    # raw.githubusercontent 404s on fresh, private, or not-yet-CDN-cached
    # repos; fall back to the GitHub API / git protocol before failing.
    repo_ok=0
    if curl -fsSL -o /dev/null "https://raw.githubusercontent.com/$repo/HEAD/README.md" 2>/dev/null; then
      repo_ok=1
      echo "repo: reachable ($repo)"
    elif command -v gh >/dev/null 2>&1 && gh api "repos/$repo" --jq .full_name >/dev/null 2>&1; then
      repo_ok=1
      echo "repo: reachable ($repo, via gh api — raw.githubusercontent not serving it yet)"
    fi
    if [ "$repo_ok" -eq 0 ]; then
      echo "repo: NOT reachable ($repo)"
      problems=1
    fi
    tag_ok=0
    if curl -fsSL -o /dev/null "https://raw.githubusercontent.com/$repo/v$version/$MANIFEST_FILE" 2>/dev/null; then
      tag_ok=1
      echo "release tag: v$version serves the manifest"
    elif git ls-remote --tags "https://github.com/$repo.git" "refs/tags/v$version" 2>/dev/null | grep -q "refs/tags/v$version"; then
      tag_ok=1
      echo "release tag: v$version exists (raw.githubusercontent not serving it yet)"
    fi
    if [ "$tag_ok" -eq 0 ]; then
      echo "release tag: v$version missing (push the tag + release before publishing)"
      problems=1
    fi
    # Soft advisory: a plugin that needs configuration should tell the
    # installing agent how to walk the user through it.
    needs_guide=0
    if jq -e '((.configs // []) | length > 0) or ((.permissions.vaultCreate // []) | length > 0)' "$file" >/dev/null 2>&1; then
      needs_guide=1
    fi
    if [ "$needs_guide" -eq 1 ]; then
      if [ ! -f "$dir/CONFIG.md" ]; then
        echo "warning: the plugin declares configs/vault keys but ships no CONFIG.md — add one (ob-plugin new scaffolds a template) so the installing agent knows how to configure it with the user"
      elif grep -q "open-bot config guide placeholder" "$dir/CONFIG.md"; then
        echo "warning: CONFIG.md is still the untouched scaffold template — fill in the real configuration walkthrough before publishing"
      else
        echo "config guide: CONFIG.md ok"
      fi
    fi
    # Soft advisory: Bun on the desktop runs .ts natively, so plugin code
    # should be TypeScript; plain JavaScript only for shell scripts.
    js_files=$(jq -r '
      [ (.dashboard.pages.entry // empty) ] +
      [ (.files // [])[] | .name, .source ]
      | .[]
      | select(test("\\.(js|mjs|cjs)$"))]' "$file" 2>/dev/null | sort -u)
    if [ -n "$js_files" ]; then
      echo "warning: prefer TypeScript over JavaScript for plugin code (Bun runs .ts natively); JavaScript found in:"
      printf '%s\n' "$js_files" | sed 's/^/  - /'
    fi
    if [ "$problems" -ne 0 ]; then
      exit 1
    fi
    echo "ready: ob-plugin publish $dir (pass --yes when publishing from a script)"
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
      if [ ! -t 0 ]; then
        echo "ob-plugin: install needs confirmation but stdin is not a terminal — re-run with --yes" >&2
        exit 2
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
    page_warn "$out"
    printf '%s' "$out" | jq '{pluginId: .plugin.pluginId, version: .plugin.version, name: .plugin.name, source: (.plugin.source // "marketplace"), page: (.plugin.page // null)}'
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
    page_warn "$out"
    printf '%s' "$out" | jq '{pluginId: .plugin.pluginId, version: .plugin.version, page: (.plugin.page // null)}'
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
  guide)
    [ $# -eq 1 ] || { usage; exit 2; }
    guide_file="$HOME/.config/open-bot/plugin-$1.CONFIG.md"
    if [ ! -f "$guide_file" ]; then
      echo "ob-plugin: no config guide for $1 (the plugin ships no CONFIG.md)" >&2
      exit 1
    fi
    cat "$guide_file"
    ;;
  settings)
    [ $# -ge 1 ] || { usage; exit 2; }
    id="$1"
    shift
    if [ $# -eq 0 ]; then
      out=$(request GET "/api/plugins/installed")
      fail_on_error "$out"
      settings_hint="$HOME/.config/open-bot/plugin-$id.CONFIG.md"
      [ -f "$settings_hint" ] &&
        echo "config guide: $settings_hint (ob-plugin guide $id — read it and configure with the user)" >&2
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
  vault)
    [ $# -ge 1 ] || { usage; exit 2; }
    id="$1"
    shift
    if [ $# -eq 0 ]; then
      out=$(request GET "/api/plugins/installed/$(urlencode "$id")/vault")
      fail_on_error "$out"
      vault_hint="$HOME/.config/open-bot/plugin-$id.CONFIG.md"
      [ -f "$vault_hint" ] &&
        echo "config guide: $vault_hint (ob-plugin guide $id — read it and configure with the user)" >&2
      printf '%s' "$out" | jq -r '.slugs[] | "\(.slug): \(if .hasKey then "key saved" else "empty" end)"'
      exit 0
    fi
    pair="$1"
    shift
    slug=${pair%%=*}
    value=${pair#*=}
    [ "$slug" != "$pair" ] || { echo "ob-plugin: expected SLUG=value, got $pair" >&2; exit 2; }
    account=""
    url=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --account) [ $# -ge 2 ] || { usage; exit 2; }; account="$2"; shift 2 ;;
        --url) [ $# -ge 2 ] || { usage; exit 2; }; url="$2"; shift 2 ;;
        *) echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    body=$(jq -n --arg s "$slug" --arg k "$value" --arg a "$account" --arg u "$url" \
      '{slug: $s, value: {apiKey: $k, accountId: $a, baseUrl: $u}}')
    out=$(request POST "/api/plugins/installed/$(urlencode "$id")/vault" "$body")
    fail_on_error "$out"
    echo "vault $slug saved for $id"
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
