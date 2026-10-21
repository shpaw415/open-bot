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
   ob-plugin review ID [--version X]  poll the marketplace security review for one version
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
  ob-plugin page ID                  page-server status: port, health, pid (loopback 4740-4759 in this container)
  ob-plugin restart ID               restart a plugin's page server (the edit loop for dashboard pages)
  ob-plugin endpoint ID              public endpoint status: url, secured state, secret (raw)
  ob-plugin endpoint ID url          print the endpoint URL (shareable public origin when the instance sets one)
  ob-plugin endpoint ID secret       print the raw secret (empty stdout + exit 1 when unset)
  ob-plugin endpoint ID secret VALUE set the secret (callers then send X-Open-Bot-Webhook-Secret or ?secret=)
  ob-plugin endpoint ID secret --generate   set a fresh random secret and print it
  ob-plugin endpoint ID secret clear   remove the secret (same as 'ob-plugin endpoint ID clear')
  ob-plugin endpoint ID clear        remove the secret (endpoint becomes public)
  ob-plugin settings ID [key=value]  show, set (KEY=value), or clear (KEY=)
                                     plugin settings
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
  # Default 300s: installs can legitimately run minutes (skill indexing).
  # Short, deliberate writes pass their own timeout so a stalled desktop
  # surfaces as a clean error instead of a multi-minute silence.
  timeout="${4:-300}"
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    if [ -n "$body" ]; then
      out=$(curl -sS -m "$timeout" -X "$method" -H "Authorization: Bearer $TOKEN" \
        -H "content-type: application/json" -d "$body" "$BASE$path" 2>&1)
      rc=$?
    else
      out=$(curl -sS -m "$timeout" -X "$method" -H "Authorization: Bearer $TOKEN" \
        "$BASE$path" 2>&1)
      rc=$?
    fi
    [ "$rc" -eq 0 ] && { printf '%s' "$out"; return 0; }
    if [ "$rc" -eq 28 ]; then
      echo "ob-plugin: control plane did not answer within ${timeout}s (timed out) — the desktop may be stalled; check the dashboard and retry" >&2
      return 1
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
  # Success responses are always JSON objects. Anything else (an HTML error
  # page from the edge, a truncated body) is a failure — print a compact
  # digest instead of echoing markup or feeding it to jq as a result.
  if ! printf '%s' "$1" | jq -e 'if type == "object" then true else empty end' >/dev/null 2>&1; then
    digest=$(printf '%s' "$1" | tr '\n\r' '  ' | sed 's/<[^>]*>//g' | sed 's/  */ /g' | cut -c1-200)
    echo "ob-plugin: control plane returned a non-JSON error page${digest:+: $digest}" >&2
    echo "  the edge/tunnel in front of $BASE may be failing — retry, or check marketplace status" >&2
    exit 1
  fi
}

# Surface a failed page-server start from the install/update response. The
# lifecycle is lazy — a fresh install reports attempted:false until the first
# dashboard/webhook request boots the server, which is not a failure.
page_warn() {
  if printf '%s' "$1" | jq -e '.plugin.page and .plugin.page.attempted and (.plugin.page.running | not)' >/dev/null 2>&1; then
    reason=$(printf '%s' "$1" | jq -r '.plugin.page.error // "did not come up in time"')
    id=$(printf '%s' "$1" | jq -r '.plugin.pluginId')
    echo "ob-plugin: warning: page server is not running ($reason)" >&2
    echo "  see ~/.open-bot/pages/$id.log on this desktop, or ob-plugin restart $id to retry" >&2
  elif printf '%s' "$1" | jq -e '.plugin.page and (.plugin.page.attempted | not) and ((.plugin.manifest | fromjson? | .dashboard.pages) != null)' >/dev/null 2>&1; then
    id=$(printf '%s' "$1" | jq -r '.plugin.pluginId')
    echo "ob-plugin: page server is lazy — it starts on the first dashboard/webhook request (ob-plugin restart $id to boot now)" >&2
  fi
}

# Surface failed root setup commands from the install/update response. The
# install itself succeeds, but the plugin's setup did not run to completion —
# say so loudly instead of leaving the failure buried in the response JSON.
init_warn() {
  if printf '%s' "$1" | jq -e '.plugin.init != null and .plugin.init.ok == false' >/dev/null 2>&1; then
    id=$(printf '%s' "$1" | jq -r '.plugin.pluginId')
    detail=$(printf '%s' "$1" | jq -r '.plugin.init.output // ""' | tr '\n\r' '  ' | sed 's/  */ /g' | tail -c 300)
    echo "ob-plugin: warning: setup commands failed${detail:+: $detail}" >&2
    echo "  the plugin is installed but its root setup did not finish — re-run: ob-plugin setup $id (log: ~/.open-bot/plugin-init/$id.log)" >&2
  fi
}

# Report per-server MCP connect status from the install/update response. The
# control plane hot-connects each declared opencode.mcp server into the
# running OpenCode daemon, so "connected" means the tools are already usable
# in new threads; anything else says when the merged config loads.
mcp_warn() {
  printf '%s' "$1" | jq -r '.plugin.mcp // {} | to_entries[]? | "\(.key): \(.value)"' 2>/dev/null |
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in
      *": connected")
        echo "mcp: $line — tools are live in new threads" >&2
        ;;
      *asleep*)
        echo "ob-plugin: note: mcp $line" >&2
        ;;
      *)
        echo "ob-plugin: warning: mcp $line — a desktop restart retries it at boot" >&2
        ;;
    esac
  done
}

# Paid premium plugins: the install/update 402 carries the buy pointer.
# Agents cannot buy — stop with clear instructions instead of retrying.
purchase_gate() {
  if printf '%s' "$1" | jq -e '.needsPurchase == true' >/dev/null 2>&1; then
    price=$(printf '%s' "$1" | jq -r '.priceCents // empty' | awk '{printf "$%.2f", $1 / 100}')
    url=$(printf '%s' "$1" | jq -r '.checkoutUrl // "https://market.open-bot.app"')
    haskey=$(printf '%s' "$1" | jq -r '.hasMarketplaceKey // false')
    echo "ob-plugin: this is a premium plugin ($price one-time, lifetime license incl. updates)" >&2
    echo "  buying is a human step: purchase it at $url (sign in, Buy), then run this install again" >&2
    if [ "$haskey" != "true" ]; then
      echo "  installs of paid plugins also need the buyer's marketplace API key — ask them to paste it on the dashboard (Config → Plugins → Marketplace account → your key)" >&2
    fi
    exit 1
  fi
}

urlencode() {
  printf '%s' "$1" | jq -sRr @uri
}

# Local filesystem pre-checks the control-plane validate cannot do (it never
# sees the checkout): every declared files[].source must exist on disk — a
# typo passes validate and only 404s at install, or worse, after the tag and
# release are cut — and payload/manifest sizes must fit the security-review
# windows. Window constants mirror packages/plugin-kit (REVIEW_*); the
# plugin-kit drift test asserts this text stays in sync.
REVIEW_PAYLOAD_FILE_CHARS=1000000
REVIEW_PAYLOAD_TOTAL_CHARS=2000000
REVIEW_MANIFEST_CHARS=150000
REVIEW_TAR_PATH_MAX=99
local_payload_checks() {
  dir="$1"
  file="$2"
  rc=0
  total=0
  missing=$(mktemp)
  oversize=$(mktemp)
  jq -r '[(.files // [])[] | .source] | .[]' "$file" > "$missing.sources" 2>/dev/null || : > "$missing.sources"
  while IFS= read -r source; do
    [ -n "$source" ] || continue
    segment_too_long=0
    printf '%s' "$source" | tr '/' '\n' | while IFS= read -r segment; do
      [ ${#segment} -le "$REVIEW_TAR_PATH_MAX" ] || exit 1
    done || segment_too_long=1
    if [ "$segment_too_long" -eq 1 ]; then
      echo "warning: files[] source \"$source\" has a path segment longer than $REVIEW_TAR_PATH_MAX chars — the review tarball cannot match it and the publish will be rejected; shorten the path" >&2
      rc=1
      continue
    fi
    if [ ! -f "$dir/$source" ]; then
      echo "$source" >> "$missing"
      rc=1
      continue
    fi
    size=$(wc -c < "$dir/$source" | tr -d ' ')
    if [ "$source" != "CONFIG.md" ] && [ "$size" -gt "$REVIEW_PAYLOAD_FILE_CHARS" ]; then
      echo "$source ($size chars)" >> "$oversize"
      rc=1
    fi
    if [ "$source" != "CONFIG.md" ]; then
      total=$((total + size))
    fi
  done < "$missing.sources"
  if [ -s "$missing" ]; then
    echo "invalid: declared files[] sources missing from the plugin directory (fix the spelling or add the files — a missing source only 404s at install time, or worse, after the tag is cut):" >&2
    sed 's/^/  - /' "$missing" >&2
  fi
  if [ -s "$oversize" ]; then
    echo "warning: payload files past the security-review window ($REVIEW_PAYLOAD_FILE_CHARS chars/file) — the publish will be rejected; shorten or split:" >&2
    sed 's/^/  - /' "$oversize" >&2
  fi
  if [ "$total" -gt "$REVIEW_PAYLOAD_TOTAL_CHARS" ]; then
    echo "warning: payload files total $total chars; the security-review window is $REVIEW_PAYLOAD_TOTAL_CHARS — the publish will be rejected; trim the payloads" >&2
    rc=1
  fi
  manifest_chars=$(jq -S . "$file" | wc -c | tr -d ' ')
  if [ "$manifest_chars" -gt "$REVIEW_MANIFEST_CHARS" ]; then
    echo "warning: manifest is $manifest_chars chars; the security-review window is $REVIEW_MANIFEST_CHARS — the publish will be rejected; trim skills/personas/tools/cron content" >&2
    rc=1
  fi
  rm -f "$missing" "$oversize" "$missing.sources"
  return "$rc"
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
        ],
        files: [
          { name: "server.ts", source: "server/server.ts", exec: true },
          { name: "index.html", source: "server/index.html", exec: false },
          { name: "app.ts", source: "server/app.ts", exec: false },
          { name: "styles.css", source: "server/styles.css", exec: false }
        ],
        dashboard: {
          pages: { entry: "server.ts", ui: "server/index.html" },
          tabs: [
            { id: $id, title: $id, icon: "dashboard", kind: "app" }
          ]
        }
      }' > "$stage/$MANIFEST_FILE"
    mkdir -p "$stage/server"
    cat > "$stage/server/server.ts" <<EOF
// Page server entry (Bun runs .ts natively, no build step).
// Env: OPEN_BOT_PAGE_PORT, OPEN_BOT_PAGE_TOKEN, OPEN_BOT_PLUGIN_ID, and
// OPEN_BOT_PAGE_UI on frozen installs (the control plane bundles index.html
// into one self-contained file at install). Local installs and previews run
// this checkout with bun --hot and import index.html live instead.

const port = Number(process.env.OPEN_BOT_PAGE_PORT ?? 4740)

// API auth for anything beyond /healthz. The dashboard proxy and public
// /hooks inject the real token as x-open-bot-page-token; a local checkout
// or ob-preview run has no token configured (or the dev-preview value) and
// stays open. Exact match only: never accept a fixed literal like
// "dev-preview" as an incoming credential while a real token is set — the
// marketplace security review flags that pattern as a backdoor.
const expectedToken = process.env.OPEN_BOT_PAGE_TOKEN ?? ""
const authorized = (req: Request) =>
  expectedToken === "" ||
  expectedToken === "dev-preview" ||
  req.headers.get("x-open-bot-page-token") === expectedToken

// The "/" route branches on the mode: the HTML import is only valid as a
// static routes value, so pick the table before the server starts.
const routes = process.env.OPEN_BOT_PAGE_UI
  ? {
      "/": () =>
        new Response(Bun.file(process.env.OPEN_BOT_PAGE_UI as string), {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    }
  : { "/": await import("./index.html").then((m) => m.default) }

const server = Bun.serve({
  port,
  routes,
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/healthz") return new Response("ok")
    if (!authorized(req)) return new Response("unauthorized", { status: 401 })
    if (url.pathname === "/api/ping") return Response.json({ pong: Date.now() })
    return new Response("not found", { status: 404 })
  },
})
EOF
    cat > "$stage/server/index.html" <<EOF
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>$name</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <h1>$name</h1>
    <p id="status">connecting&hellip;</p>
    <script type="module" src="./app.ts"></script>
  </body>
</html>
EOF
    cat > "$stage/server/app.ts" <<EOF
// Browser code: Bun bundles and transpiles this for both the live import and
// the standalone build. Relative fetch paths only ("api/ping", never
// "/api/...") — the dashboard proxies this page under /api/pages/<pluginId>/.
const status = document.getElementById("status") as HTMLElement | null
const res = await fetch("api/ping")
const data = (await res.json()) as { pong: number }
if (status) status.textContent = "pong " + data.pong
EOF
    cat > "$stage/server/styles.css" <<EOF
/* Follow the dashboard theme (it defaults to the OS setting): light default
   plus prefers-color-scheme overrides — never ship your own theme toggle. */
body {
  font-family: system-ui, sans-serif;
  margin: 0;
  padding: 24px;
  background: #eef0f4;
  color: #171a20;
}
@media (prefers-color-scheme: dark) {
  body {
    background: #0e1014;
    color: #f3f4f6;
  }
}
EOF
    cat > "$stage/smoke.test.ts" <<'EOF'
// Plugin smoke test — `bun test` from the plugin root (ob-plugin doctor runs
// it automatically when *.test.ts files exist). Keep it fast and hermetic.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const manifest = JSON.parse(
  readFileSync(new URL("./open-bot.plugin.json", import.meta.url), "utf8"),
) as {
  id?: unknown
  version?: unknown
  files?: { name: string; source: string }[]
  dashboard?: { pages?: { entry?: string } }
}

describe("plugin smoke", () => {
  test("manifest is well-formed", () => {
    expect(manifest.id).toBeString()
    expect(manifest.version).toBeString()
  })

  test("every declared files[] source exists on disk", () => {
    for (const file of manifest.files ?? []) {
      expect(
        () => readFileSync(new URL(`./${file.source}`, import.meta.url)),
        `files[] source ${file.source} is missing from the checkout`,
      ).not.toThrow()
    }
  })

  test("page server entry is a declared files[] name", () => {
    const entry = manifest.dashboard?.pages?.entry
    if (!entry) return
    expect(
      (manifest.files ?? []).some((file) => file.name === entry),
    ).toBe(true)
  })
})
EOF
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

## Testing

Run the plugin's tests with \`bun test\` — \`ob-plugin doctor\` runs them
automatically whenever *.test.ts files exist (failures are advisory, but fix
them before publishing). The scaffold ships smoke.test.ts covering the two
checks everything else depends on: a well-formed manifest and every declared
files[] source existing on disk. Grow it with real tests for your server's
logic and exports.

Manifest quick reference:
- skills[]: {name, description, body, group?} — installed into the desktop's OpenViking; group is an optional display label (max 48) the dashboard's skills/MCP directory UI shows the skill under
- personas[]: {name, instruction, skills?: [...], mcp?: [...]} — personalities the thread picker can choose; skills is an optional allowlist (max 64 skill-name slugs, never globs) limiting which skills load in threads running that persona; mcp is the same model for MCP server names (max 16, letters/digits/dots/hyphens/underscores) limiting which servers' tools load; users extend either per install with skillsExtra/mcpExtra
- cron[]: {name, message, everySeconds | cronExpr, run?: prompt|script|both|auto, script?} — scheduled jobs (run=script/both/auto needs script, max 16k chars)
- tools[]: {name, content, exec} — files installed into /usr/local/bin
- files[]: {name, source, exec} — text payloads fetched from the reviewed release tarball and installed next to tools; every frontend file the page server references (index.html, app.ts, styles.css) must be declared here; omitted exec means executable
- dashboard.pages: {entry, ui, public?} — entry is the page server files[] name; ui is the files[] source of the frontend entry (index.html) — the control plane bundles it with bun build into one self-contained HTML for frozen installs, local installs import it live; the control plane proxies this server to the dashboard under /api/pages/<pluginId>/ with that prefix stripped (your code sees bare paths); public: true also exposes /hooks/<userId>/<id>/<path> on the public internet (optional per-install secret)
- dashboard.hooks[]: {event: session.idle|thread.created, message} — up to 8; each runs an agent session in a hidden worker thread when the event fires (max 20 runs/day)
- dashboard.mentions: [{section, label?, path?}] — up to 4 dynamic @section/name composer entries; your page server answers GET <path> with {items: [{name, description?, aliases?, hint?}]}
- Write plugin code in TypeScript, not JavaScript: tool scripts (with a "#!/usr/bin/env bun" shebang), files[] payloads, and dashboard page servers are all .ts files — Bun runs .ts natively, no build step
- configs[]: {key, label, def, type?: string|bool|number|enum, options?: [...], secret?: true} — settings shown on the Plugins page; typed settings are validated and render matching inputs (max 64)
- setup: {commands: [...], uninstall: [...]} — shell commands run as root in the desktop at install and on every desktop start (commands must be idempotent, e.g. "apt-get install -y figlet"); uninstall runs at uninstall; the user sees them in the consent prompt, log at ~/.open-bot/plugin-init/<id>.log
- permissions.vaultRead / vaultCreate: vault key slugs
- dashboard.tabs[]: {id, title, icon?, kind: app|page|iframe, path? (app: your server's route to open, default /), url? (iframe: external https), dataUrl? (page: your server's JSON route), pollSeconds?, cards? (page: 1-64 cards)} — path/dataUrl are server-relative: the dashboard prepends its own /api/pages/<id> prefix, so never include it there
- pricing: {model: "one-time", amount} — USD cents 99-50000; makes the plugin a paid marketplace listing
- textbox: renderers, commands, buttons, validators, attachments
- opencode: {plugin: [npm...], mcp: {...}, agents: {...new agent defs...}, agentTools: {agent: {glob: bool}}, agentsMd: "standing instructions injected next to AGENTS.md (max 4000 chars, no secrets)"}
- Helper sessions your plugin spawns must be titled with the "worker:" prefix so they stay out of the dashboard thread list.

CONFIG.md (created alongside this file) is the configuration guide the
installing agent reads to configure the plugin with the user — fill it in
whenever the plugin declares configs[] or vault keys. It is also read by the
marketplace security reviewer on every publish: no secrets, no real personal
data, and no instructions that try to steer the agent.

Your README is shown on the marketplace listing and the dashboard detail
view — write it for the person deciding whether to install.

Privacy: publishing makes this folder public (GitHub repo + marketplace).
Never hard-code the user's personal information — real names, contacts,
addresses, government or business numbers, cards, real schedule entries — in
any file. Use placeholders (Acme Corp, Alex, example.com, <city>) and let
settings, vault keys, or runtime data personalize the plugin. The marketplace
runs an AI privacy review and rejects publishes that leak personal data.
EOF
    cat > "$stage/CONFIG.md" <<EOF
# Configuring $name with the user

<!-- open-bot config guide placeholder: replace every section below before publishing -->

You are configuring the \`$name\` open-bot plugin on this desktop for the user.
Walk them through it step by step. Never print or echo secret values; fill
them with the write-only commands shown here.

This file is read by the installing agent AND by the marketplace security
reviewer on every publish: no secrets, no real personal data, and no
instructions that try to steer the agent beyond configuring this plugin.

This file ships publicly with the plugin: placeholders only, never the
current user's personal information.

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

## Language

The dashboard's language (Config page → Langue) arrives automatically — the
\`language\` field in \`~/.config/open-bot/plugin-$name.json\` and the
\`x-open-bot-language\` header on every proxied request (\`?lang=\` rides the
app frame URL for client-side reads). Localize with it; never build your own
language selector.

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
    dir="$1"
    file="$dir/$MANIFEST_FILE"
    [ -f "$file" ] || { echo "ob-plugin: missing $file" >&2; exit 2; }
    body=$(jq -n --slurpfile m "$file" '{manifest: $m[0]}')
    out=$(request POST /api/plugins/validate "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq -r 'if .ok then "valid\n" + (.permissions[]? | " - " + .) else "invalid\n" + ([.issues[]? | " - \(.path // "manifest"): \(.message)"] | join("\n")) end'
    [ "$(printf '%s' "$out" | jq -r '.ok')" = "true" ] || exit 1
    # Local pre-check: declared sources must exist and payloads must fit the
    # security-review windows (the control plane validates JSON only).
    local_payload_checks "$dir" "$file" || exit 1
    # Local pre-check: bundle the declared dashboard frontend so build errors
    # surface before a release is cut (frozen installs get this same build
    # from the control plane at install). Skipped when bun is missing.
    ui_entry=$(jq -r '.dashboard.pages.ui // empty' "$file")
    if [ -n "$ui_entry" ]; then
      if ! command -v bun >/dev/null 2>&1; then
        echo "note: bun not found — skipping the dashboard UI build check"
      elif [ ! -f "$dir/$ui_entry" ]; then
        echo "invalid" >&2
        echo " - dashboard.pages.ui: $ui_entry is not in the plugin directory" >&2
        exit 1
      else
        build_dir=$(mktemp -d)
        if bun build --compile --target=browser "$dir/$ui_entry" --outdir "$build_dir" >"$build_dir/build.log" 2>&1; then
          echo "ui build: ok"
        else
          echo "invalid" >&2
          echo " - dashboard.pages.ui: bun build failed — fix the frontend before publishing:" >&2
          sed 's/^/   /' "$build_dir/build.log" | tail -10 >&2
          rm -rf "$build_dir"
          exit 1
        fi
        rm -rf "$build_dir"
      fi
    fi
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
    # Pre-flight: name each failure mode instead of one opaque POST error.
    # (1) The instance must actually have a marketplace configured.
    mp_out=$(request GET /api/plugins/market || true)
    if printf '%s' "$mp_out" | grep -q "marketplace is not configured"; then
      echo "ob-plugin: this instance has no marketplace configured (OPEN_BOT_MARKETPLACE_URL / OPEN_BOT_MARKETPLACE_TOKEN) — publishing is impossible here; publish from an instance with a marketplace, or install locally with: ob-plugin install --path $dir" >&2
      exit 1
    fi
    if [ -z "$mp_out" ]; then
      echo "ob-plugin: cannot reach the control plane to check the marketplace" >&2
      exit 1
    fi
    # (2) Identity echo: publish as the authenticated GitHub account — on a
    # bot account a guessed OWNER name publishes under the wrong identity.
    if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
      account=$(gh api user -q .login 2>/dev/null || echo "")
      if [ -n "$account" ]; then
        echo "publishing as @$account -> $repo" >&2
      fi
    elif [ "$dev" -eq 1 ]; then
      echo "ob-plugin: gh is not authenticated — --dev needs it to push the tag and create the release" >&2
      exit 1
    fi
    # (3) Stable publishes must ship the bytes that were tested: the
    # marketplace reviews and installs the tag tarball, not this checkout.
    if [ "$dev" -ne 1 ] && [ -d "$dir/.git" ]; then
      dirty=$(git -C "$dir" status --porcelain 2>/dev/null | head -5 || true)
      if [ -n "$dirty" ]; then
        echo "ob-plugin: $dir has uncommitted changes — commit or stash them; the release tag must contain exactly what you tested" >&2
        exit 1
      fi
      head_sha=$(git -C "$dir" rev-parse HEAD 2>/dev/null || echo "")
      tag_sha=$(git -C "$dir" rev-parse -q --verify "v$version^{commit}" 2>/dev/null || echo "")
      if [ -z "$tag_sha" ]; then
        echo "ob-plugin: local tag v$version does not exist — create it first (git tag v$version && git push origin v$version)" >&2
        exit 1
      fi
      if [ "$head_sha" != "$tag_sha" ]; then
        echo "ob-plugin: HEAD ($head_sha) is not tag v$version ($tag_sha) — move the tag onto HEAD (git tag -f v$version && git push -f origin v$version) or the reviewed tarball will not match the checkout" >&2
        exit 1
      fi
    fi
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
              echo "  the publish is queued — check the verdict later with: ob-plugin review $plugin_id --version $version" >&2
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
    if [ -d "$dir/.git" ]; then
      echo "published tag v$version at $(git -C "$dir" rev-parse HEAD 2>/dev/null || echo unknown-sha)"
    fi
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
  review)
    id=""
    version=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --version) [ $# -ge 2 ] || { usage; exit 2; }; version="$2"; shift 2 ;;
        -*) usage; exit 2 ;;
        *)
          [ -z "$id" ] || { echo "ob-plugin: unexpected argument: $1" >&2; usage; exit 2; }
          id="$1"
          shift
          ;;
      esac
    done
    [ -n "$id" ] || { usage; exit 2; }
    if [ -z "$version" ]; then
      # Default to the local checkout's manifest version (the usual case:
      # asking about the version just published).
      version=$(jq -r '.version // empty' "$CREATE_ROOT/$id/$MANIFEST_FILE" 2>/dev/null || true)
      if [ -z "$version" ]; then
        echo "ob-plugin: --version is required (no local manifest found at $CREATE_ROOT/$id)" >&2
        exit 2
      fi
    fi
    out=$(request GET "/api/plugins/review?id=$(urlencode "$id")&version=$(urlencode "$version")")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{pluginId: .pluginId, version: .version, pluginStatus: .pluginStatus, security, review}'
    status=$(printf '%s' "$out" | jq -r '.review.status // .security.status // ""')
    case "$status" in
      queued|running|"")
        echo "ob-plugin: review still in flight — poll again with: ob-plugin review $id --version $version" >&2
        exit 3
        ;;
      concern|error)
        exit 1
        ;;
    esac
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
    # Soft advisory: frontend files the page server references must be
    # declared in files[] or they never ship — frozen installs cannot load
    # them and the dashboard renders nothing.
    html_missing=0
    for rel in $(find "$dir" -name '*.html' -not -path '*/.git/*' -not -path '*/node_modules/*' 2>/dev/null | sed "s|^$dir/||" | sort); do
      if ! jq -e --arg s "$rel" '[(.files // [])[] | .source] | index($s)' "$file" >/dev/null 2>&1; then
        echo "warning: $rel is not declared in files[] — it will not ship in the release (declare it or the frozen install cannot load it)"
        html_missing=1
      fi
    done
    [ "$html_missing" -eq 1 ] && problems=1
    # Declared-source existence + review-window sizes (same checks validate
    # runs; doctor reports them as problems with fuller context).
    if ! local_payload_checks "$dir" "$file"; then
      problems=1
    fi
    # Pre-run the standalone UI build so bundle errors surface pre-publish.
    ui_entry=$(jq -r '.dashboard.pages.ui // empty' "$file")
    if [ -n "$ui_entry" ] && command -v bun >/dev/null 2>&1; then
      build_dir=$(mktemp -d)
      if bun build --compile --target=browser "$dir/$ui_entry" --outdir "$build_dir" >/dev/null 2>&1; then
        echo "ui build: ok ($ui_entry)"
      else
        echo "ui build: FAILED for $ui_entry — run: bun build --compile --target=browser $dir/$ui_entry --outdir /tmp/ui-check"
        problems=1
      fi
      rm -rf "$build_dir"
    fi
    # Run the plugin's own tests when any exist (advisory: doctor is author-
    # invoked, so flaky tests cost the author a look — never a publish gate).
    if command -v bun >/dev/null 2>&1 && ls "$dir"/*.test.ts >/dev/null 2>&1; then
      test_log=$(mktemp)
      if (cd "$dir" && bun test) > "$test_log" 2>&1; then
        echo "tests: ok"
      else
        echo "tests: FAILED — tail of bun test output:" >&2
        tail -12 "$test_log" | sed 's/^/  /' >&2
        problems=1
      fi
      rm -f "$test_log"
    fi
    # Soft advisory: plugin source ships publicly (GitHub repo + marketplace),
    # so personal information must never be hard-coded in it. The marketplace
    # privacy review rejects publishes that leak it — fix before publishing.
    privacy_hits=$(grep -rInE \
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+|([0-9]{3}[-. ][0-9]{3}[-. ][0-9]{4})|([0-9]{3}[- ][0-9]{3}[- ][0-9]{3})' \
      "$dir" \
      --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null \
      | grep -viE '@(example|sample|test|acme)\.|@(example|sample|test|acme)(\.|,| |$)|example\.(com|org|net|ca)|acme\.|jane\.doe|john\.doe' \
      | head -20 || true)
    if [ -n "$privacy_hits" ]; then
      echo "warning: possible personal information in plugin files — published source is public; use placeholders (example.com, Acme Corp, Alex) and personalize through settings/vault/runtime data instead (see the plugin-privacy skill):"
      printf '%s\n' "$privacy_hits" | sed 's/^/  - /'
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
    printf '%s' "$out" | jq -r '.plugins[]? | "- \(.id) v\(.version) [\(.status)] \(.name) — \(.description)\(if .downloads then " (\(.downloads) installs)" else "" end)\(if (.priceCents // 0) > 0 then " [premium $\(.priceCents / 100 | floor).\(.priceCents % 100 | tostring | if length < 2 then "0" + . else . end)]" else "" end)"'
    ;;
  info)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request GET "/api/plugins/market/$(urlencode "$1")")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{id: .plugin.id, name: .plugin.name, version: .plugin.version, status: .plugin.status, description: .plugin.description, author: .plugin.author, repo: .plugin.repo, category: .plugin.category, tags: .plugin.tags, downloads: .plugin.downloads, priceCents: .plugin.priceCents, versions: [.versions[].version | . + (if test("^[0-9]+\\.[0-9]+\\.[0-9]+$") then "" else " (dev)" end)]}'
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
    purchase_gate "$out"
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
          purchase_gate "$out"
          fail_on_error "$out"
          ;;
        *) echo "cancelled"; exit 1 ;;
      esac
    fi
    page_warn "$out"
    init_warn "$out"
    mcp_warn "$out"
    printf '%s' "$out" | jq '{pluginId: .plugin.pluginId, version: .plugin.version, name: .plugin.name, source: (.plugin.source // "marketplace"), page: (.plugin.page // null), setupOk: (.plugin.init.ok // null)}'
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
    purchase_gate "$out"
    fail_on_error "$out"
    page_warn "$out"
    init_warn "$out"
    mcp_warn "$out"
    printf '%s' "$out" | jq '{pluginId: .plugin.pluginId, version: .plugin.version, page: (.plugin.page // null), setupOk: (.plugin.init.ok // null)}'
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
  page)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request GET "/api/plugins/installed/$(urlencode "$1")/page")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{pluginId, enabled, running, port, pid, note}'
    if printf '%s' "$out" | jq -e '.running == true' >/dev/null 2>&1; then
      printf '%s' "$out" | jq -r '"loopback: http://127.0.0.1:\(.port)/  (click-test: ob-chrome navigate http://127.0.0.1:\(.port)/ — log: ~/.open-bot/pages/\(.pluginId).log)"' >&2
    else
      note=$(printf '%s' "$out" | jq -r '.note // empty')
      if [ -n "$note" ]; then
        echo "ob-plugin: $note" >&2
      fi
      echo "ob-plugin: page server is not running (try ob-plugin restart $1; log: ~/.open-bot/pages/$1.log)" >&2
    fi
    ;;
  restart)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request POST "/api/plugins/installed/$(urlencode "$1")/page/restart")
    fail_on_error "$out"
    port=$(printf '%s' "$out" | jq -r '.port')
    case "$(printf '%s' "$out" | jq -r '.source // ""')" in
      local)
        echo "page server for $1 restarted on port $port (local install — the checkout hot-reloads via bun --hot, no restart needed after edits)"
        ;;
      *)
        echo "page server for $1 restarted on port $port (marketplace install serves the frozen copy — restart lands edits)"
        ;;
    esac
    ;;
  endpoint)
    [ $# -ge 1 ] || { usage; exit 2; }
    id="$1"
    shift
    hook="/api/plugins/installed/$(urlencode "$id")/webhook"
    no_surface() {
      echo "ob-plugin: $id has no public endpoint (manifest dashboard.pages.public is not enabled)" >&2
      exit 1
    }
    case "${1:-show}" in
      show)
        out=$(request GET "$hook")
        fail_on_error "$out"
        printf '%s' "$out" | jq -e '.enabled == false' >/dev/null 2>&1 && no_surface
        printf '%s' "$out" | jq --arg id "$id" --arg base "$BASE" \
          '{pluginId: $id, enabled, secured, secret: (.secret // null), url: (.publicUrl // ($base + .path))}'
        if printf '%s' "$out" | jq -e '.secured == true' >/dev/null 2>&1; then
          echo "test: curl -s -H \"X-Open-Bot-Webhook-Secret: \$(ob-plugin endpoint $id secret)\" \"\$(ob-plugin endpoint $id url)\"" >&2
          echo "send the secret as the X-Open-Bot-Webhook-Secret header — the ?secret= query form is deprecated (it leaks into access logs and Referer headers)" >&2
        fi
        ;;
      url)
        out=$(request GET "$hook")
        fail_on_error "$out"
        printf '%s' "$out" | jq -e '.enabled == false' >/dev/null 2>&1 && no_surface
        if printf '%s' "$out" | jq -e '.publicUrl' >/dev/null 2>&1; then
          printf '%s\n' "$(printf '%s' "$out" | jq -r '.publicUrl')"
        else
          printf '%s\n' "$(printf '%s' "$out" | jq -r --arg base "$BASE" '($base + .path)')"
          echo "ob-plugin: internal control URL (set OPEN_BOT_PUBLIC_URL on the control plane for the shareable public origin)" >&2
        fi
        ;;
      secret)
        shift
        if [ $# -eq 0 ]; then
          out=$(request GET "$hook")
          fail_on_error "$out"
          secret=$(printf '%s' "$out" | jq -r '.secret // empty')
          if [ -z "$secret" ]; then
            echo "ob-plugin: no secret set for $id (endpoint is public)" >&2
            exit 1
          fi
          printf '%s\n' "$secret"
        elif [ "$1" = "--generate" ]; then
          secret=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
          out=$(request POST "$hook" "$(jq -n --arg s "$secret" '{secret: $s}')")
          fail_on_error "$out"
          printf '%s\n' "$secret"
        elif [ "$1" = "clear" ]; then
          out=$(request POST "$hook" '{"secret": ""}')
          fail_on_error "$out"
          echo "secret removed — $id endpoint is public"
        else
          secret="$1"
          out=$(request POST "$hook" "$(jq -n --arg s "$secret" '{secret: $s}')")
          fail_on_error "$out"
          echo "secret set for $id"
        fi
        ;;
      clear)
        out=$(request POST "$hook" '{"secret": ""}')
        fail_on_error "$out"
        echo "secret removed — $id endpoint is public"
        ;;
      *)
        echo "unknown subcommand: $1" >&2
        usage
        exit 2
        ;;
    esac
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
    clears='[]'
    for pair in "$@"; do
      key=${pair%%=*}
      value=${pair#*=}
      [ "$key" != "$pair" ] || { echo "ob-plugin: expected key=value, got $pair" >&2; exit 2; }
      # KEY= (empty value) clears the saved setting outright — including
      # secret-typed ones, which the PUT route keeps when "" arrives inside
      # settings (the dashboard resends every key on each save).
      if [ -z "$value" ]; then
        clears=$(printf '%s' "$clears" | jq --arg k "$key" '. + [$k]')
      else
        settings=$(printf '%s' "$settings" | jq --arg k "$key" --arg v "$value" '. + {($k): $v}')
      fi
    done
    body=$(jq -n --argjson s "$settings" --argjson c "$clears" '{settings: $s, clear: $c}')
    out=$(request PUT "/api/plugins/installed/$(urlencode "$id")/settings" "$body" 45)
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
    out=$(request POST "/api/plugins/installed/$(urlencode "$id")/vault" "$body" 45)
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
    # createdAt is epoch milliseconds (D1 writes Date.now()); jq's todate
    # expects seconds, so a raw todate printed years like 58765.
    printf '%s' "$out" | jq -r '.comments[]? | "\((.createdAt / 1000 | floor) | todate) \(.author): \(.body)"'
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
