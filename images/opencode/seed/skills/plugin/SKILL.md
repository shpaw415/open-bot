---
name: plugin
description: Create, publish, install, and maintain open-bot plugins. Use when a task needs a capability the desktop does not have, when the user asks about plugins or the marketplace, or when a message starts with [cron: and mentions a plugin guard.
---

# Plugins

Plugins extend what you can do: skills, personalities, scheduled jobs, desktop tools, dashboard tabs, chat composer features, vault keys, and OpenCode extensions. They live on the open-bot plugin marketplace. Use the `ob-plugin` CLI.

## When you lack a capability

When a task needs something you cannot do with current tools, skills, or plugins, search the marketplace before building anything: run `ob-plugin search` with keywords from the task (plus `ob-plugin info <id>` on candidates). If a maintained plugin fits, install it with `ob-plugin install <id>` — the instance's install policy still applies, so `manual` mode shows the user a consent dialog — and skip the rest of this section. Only build a plugin instead of giving up or hand-rolling a one-off when the search finds nothing suitable, a candidate falls short of the task, or the marketplace is unreachable:

1. Scaffold: `ob-plugin new <slug>` creates `~/plugins-create/<slug>/` with `open-bot.plugin.json`, a README, and a CONFIG.md template, and registers it in the dashboard project list under the plugins group — no separate `ob-project add` needed.
2. Implement: fill the manifest following the JSON schema at `~/.config/opencode/skills/plugin/open-bot.plugin.schema.json` — read it before writing any field you are unsure about; every field name, pattern, and limit is defined there, and unknown fields are rejected. Inline sections: `skills`, `personas`, `cron`, `tools`, `configs`, `setup`, `hooks`, `permissions`, `dashboard`, `textbox`, `opencode`. Tool files are plain scripts installed into `/usr/local/bin`. Larger text payloads go in `files[]` (`{name, source, exec}` — repo-relative paths shipped in the release tarball, installed next to tools). `configs[]` are settings shown on the Plugins page — give each a `type` (`string` default, `bool`, `number`, `enum` with `options[]`, `secret`) so the user gets a proper input and values are validated. `cron[]` declares scheduled jobs: `{name, message, everySeconds}` or `{name, message, cronExpr}` (5-field, UTC). Jobs can also run scripts: add `run` + `script` (max 16k chars) — `run: "script"` runs the script and posts its output to the job thread without waking the agent (`message` optional), `run: "auto"` runs the script and wakes the agent only when an output line starts with `[cron-agent]` (prefer it for guards that usually have nothing to do), `run: "both"` runs the script then wakes the agent with the output plus `message`. `hooks[]` run a short prompt in a hidden worker thread when `session.idle` or `thread.created` fires (max 8, capped at 20 runs/day per plugin; worker threads never re-trigger hooks — use them for reactive automation, not loops). `permissions.notifications: true` lets the plugin's tools and skills post dashboard notifications with `ob-plugin notify <id> "title" "body"`. `opencode.agents` registers new agent workers (built-in names are rejected); `opencode.agentTools` patches tool globs on existing agents (e.g. `{"build": {"myplugin_*": false}}`); `opencode.agentsMd` is a short block of standing instructions (max 4000 chars) injected next to AGENTS.md for as long as the plugin is installed — durable behavioral rules the agent must always follow, never secrets and never per-task prompts; `opencode.mcp` maps MCP server names to configs (`{"type": "local", "command": ["..."]}` or `{"type": "remote", "url": "..."}`, optional `environment`/`headers`/`enabled`) that install merges into opencode.json and hot-connects into the running daemon — the install output prints per-server status and `connected` means the `<server>_*` tools are already usable in new threads, no restart needed (never restart the OpenCode daemon yourself to activate MCP tools: it kills your own session). `setup.commands` are shell commands run as root in the desktop at install and re-run after every desktop recreate — use them for environment setup the plugin needs (e.g. `"sudo apt-get install -y figlet"`); keep them idempotent and minimal, and pair destructive ones with `setup.uninstall` cleanup. Helper sessions the plugin spawns (worker pipelines, batch jobs) must be titled with the `worker:` prefix so they stay out of the dashboard thread list (same convention as `cron-run:`).
3. Test locally: run the tool scripts yourself, walk through the skill steps, and check the cron prompt reads well.
4. Write the config guide: whenever the plugin declares `configs[]` or vault keys, replace the scaffold placeholder in `~/plugins-create/<slug>/CONFIG.md` with a real walkthrough for the installing agent — what the plugin needs, each setting and what to ask the user, each vault slug and where the user gets the key (`ob-plugin vault` for vaultCreate; the dashboard Plugins tab → Settings → Vault keys for any slug, with shared provider slugs on the Config Keys tab), the ask → fill → verify order, and how to prove it works. It ships with the release, installs to `~/.config/open-bot/plugin-<id>.CONFIG.md` on every desktop, and `ob-plugin guide <id>` prints it — never put real secret values in it.
5. Validate: `ob-plugin validate ~/plugins-create/<slug>` and fix every issue.
6. Install locally: `ob-plugin install --path ~/plugins-create/<slug>`. It lands in the installed list with (local) beside the name. Re-run that command, or Re-install on the Plugins page, to pick up edits. Remove works like any other install.
7. Publish (see below), then `ob-plugin install <slug>` when the plugin should leave this desktop and live on the marketplace.
8. Stress-test: load the `stress-test` skill and run the installed plugin through complex use cases from the user's seat, filing defects and iterating versions until every case passes. Do not tell the user it works before it passes. Iterate on a dev tag (`beta-1`) while staging — see below — and publish semver once it passes.

Tell the user in one sentence that you built and published a plugin for it.

## Publish checklist

Publishing requires the manifest to be on GitHub at the matching release tag:

```sh
cd ~/plugins-create/NAME
ob-plugin validate ~/plugins-create/NAME
git init -b main && git add -A && git commit -m "v1.0.0"
gh repo create OWNER/NAME --public --source . --push
gh release create v1.0.0 -R OWNER/NAME --notes "First release"
ob-plugin publish ~/plugins-create/NAME
ob-plugin install NAME
```

- `publish` registers the manifest on the marketplace and automatically creates a daily guard cron named `plugin:NAME:guard`. Keep that job; it is your maintenance duty. It survives uninstalling the plugin.
- Bump `version` (semver) for every change, commit, create a matching `v<version>` release, and publish again so the marketplace serves the new version.
- Never put secrets in a manifest. Request vault slugs with `permissions.vaultCreate`. The user can fill any declared slug on the dashboard (Plugins tab → Settings → Vault keys), and you can fill vaultCreate slugs yourself with `ob-plugin vault ID SLUG=value` (write-only; values are stored in the key vault and survive disable/enable/reinstall). Slugs under `permissions.vaultRead` are the user's own keys only they fill: shared provider slugs live on the Config page Keys tab, plugin-specific ones in the same Vault keys section. Tools and page servers receive declared vault values in `~/.config/open-bot/plugin-<id>.json` (`vault.<slug>` = `{apiKey, accountId, baseUrl}`); when the user rotates a shared key on the Keys tab, the control plane re-syncs that file on its own — read it fresh instead of caching secrets.
- Premium plugins: a manifest `pricing: {model: "one-time", amount: <USD cents>}` ($0.99–$500) makes the listing paid — the user buys once on the marketplace (Stripe) and owns it forever, updates included. Installing or updating a premium plugin fails while the signed-in user has not bought it: the CLI prints the marketplace page to buy at — relay that to the user and stop; buying is a human step, never attempt to purchase. Paid installs ride the user's personal marketplace API key (dashboard Config → Plugins → Marketplace account); if installs still fail after the purchase, ask them to set that key. Declaring pricing is allowed whenever the user asks for a paid listing; the price ships with each version like any manifest change.
- Never put the user's personal information in any plugin file — published source is public and the marketplace's AI privacy review rejects publishes that leak it. Load the `plugin-privacy` skill when creating or updating a plugin and follow it: placeholders in examples, personalization through settings/vault/runtime data, and a doctor privacy check before publishing.

## Staging a release (dev tags)

For stress-testing and staging before a stable release, publish a dev tag instead of bumping semver. Set the manifest `version` to a short lowercase tag (e.g. `beta-1`, `staging.2`), then let one command do the whole loop — commit, push, force-move the `v<tag>` tag, clobber the release, publish, wait for the review, and reinstall the pinned version if the plugin is already installed:

```sh
ob-plugin publish ~/plugins-create/NAME --dev
```

`--no-commit` skips the git commit step if you already committed. The manual equivalent is:

```sh
git add -A && git commit -m "beta-1"
git tag -f vbeta-1 && git push -f origin vbeta-1
gh release create vbeta-1 -R OWNER/NAME --notes "Dev build" ||
  gh release edit vbeta-1 -R OWNER/NAME --notes "Dev build"
ob-plugin publish ~/plugins-create/NAME
ob-plugin install NAME --version beta-1
```

- Dev versions pass the same security review, consent flow, and policy as stable ones, but stay out of marketplace search and never become the listing's "latest".
- `ob-plugin publish` returns after the marketplace queues the security review, then waits up to 8 minutes for `queued` / `running` to become `pass`, `concern`, or `error`. A previous review's error does not skip that wait. The review is flaky sometimes (slow or unparsable verdicts) — republishing re-reviews and eventually passes; space retries out.
- Reinstalling the pinned version (`ob-plugin install NAME --version beta-1` again, or Re-install on the dashboard Plugins tab) picks up the republish: it re-pulls the release and re-runs setup. Uninstall from the same tab any time.
- When the plugin passes, bump to semver (`1.0.0`), tag, and publish — the stable version becomes the marketplace latest, and a plain `ob-plugin install NAME` upgrades installs pinned to the dev tag.

Before a first publish, `ob-plugin doctor ~/plugins-create/NAME` checks the manifest, repo reachability, and the `v<version>` tag in one pass.

## Maintaining your plugins (guard cron)

When a message starts with `[cron: plugin:NAME:guard]`, do the maintenance pass in this temporary session:

1. `gh issue list -R OWNER/NAME --state open` and `gh pr list -R OWNER/NAME --state open`.
2. For each: read it and act. Answer questions, fix clear bugs in `~/plugins-create/NAME`, review PRs (`gh pr diff NUMBER -R OWNER/NAME`, `gh pr checks NUMBER -R OWNER/NAME`) and merge satisfying ones with `gh pr merge NUMBER -R OWNER/NAME --squash --delete-branch`, close invalid ones with a kind comment.
3. Check the marketplace discussion: `ob-plugin comments NAME`, reply with `ob-plugin comment NAME "..."`.
4. If merged changes warrant a release: bump the version, commit, release the new tag, `ob-plugin publish ~/plugins-create/NAME`.
5. End with what you did. If there was nothing to do, say exactly that.

`ob-plugin guard status NAME` shows the job; `ob-plugin guard off NAME` deletes it when you (or the user) decide to stop maintaining a plugin. Only use `guard off` on plugins you published — never on another creator's guard cron.

## Using and installing plugins

```sh
ob-plugin search weather       # search the marketplace
ob-plugin info weather-pro     # details, versions, repo
ob-plugin install weather-pro  # installs skills, personas, cron, tools, tabs
ob-plugin install --path ~/plugins-create/weather-pro  # local dev install, shown as (local)
ob-plugin list                 # installed plugins
ob-plugin outdated             # installed plugins with a newer marketplace version
ob-plugin update weather-pro   # update to the newest known stable
ob-plugin remove weather-pro   # uninstall (reverses everything it created)
ob-plugin issue weather-pro "Title" "Details"   # file a GitHub issue
ob-plugin settings weather-pro units=imperial   # change settings (validated against the manifest types)
ob-plugin vault weather-pro apikey=sk-...       # fill a vaultCreate slug (write-only, survives updates)
ob-plugin vault weather-pro                     # list owned vault slugs and whether a key is saved
ob-plugin notify weather-pro "Backup done" "3 files copied"   # dashboard notification (needs permissions.notifications)
```

Install respects the instance policy: `manual` asks the user to confirm the permission list (a `--yes` flag skips only when the policy allows it), `auto` installs immediately. After installing a plugin that still needs configuration — settings at their defaults or empty vault slugs (`ob-plugin settings <id>` / `ob-plugin vault <id>` show the state) — read its config guide with `ob-plugin guide <id>` and offer to walk the user through it, following the guide's order and verification steps; skip the offer when everything is already filled in. The guide lives at `~/.config/open-bot/plugin-<id>.CONFIG.md` and is removed while the plugin is disabled. To report a bug in a plugin you use, prefer `ob-plugin issue` — the creator's guard cron picks it up within a day. While developing or stress-testing a plugin from a local checkout, file findings with `ob-report` instead (see the `report` skill): reports stay on this desktop, other threads can fix them, and the user tracks them in the dashboard Reports view with `@reports/<slug>` mentions.

## Dashboard pages (live plugin dashboards)

A plugin can ship a dashboard: a view in the workspace drawer's Dashboards list where the user sees live data and can act on it (stock lists, trackers, admin panels). Two building blocks in the manifest:

- `dashboard.pages: { "entry": "server.ts", "ui": "server/index.html" }` — declares a page server: `entry` is a `files[]` payload (a Bun HTTP server, written in TypeScript — Bun runs `.ts` natively). The control plane installs it next to tools and runs it with Bun lazily: on the first dashboard request, webhook hit, or @mention lookup — never at install or boot — and it stops after five quiet minutes, so keep startup fast and stateless. Env: `OPEN_BOT_PAGE_PORT` (listen port), `OPEN_BOT_PAGE_TOKEN` (shared secret; check `x-open-bot-page-token` on requests if you want), `OPEN_BOT_PLUGIN_ID`, and `OPEN_BOT_PAGE_UI` (see the UI bullet). Settings and vault keys arrive through the same `~/.config/open-bot/plugin-<id>.json` config file tools get; the file is regenerated from the control plane, so persist vault changes with `ob-plugin vault` (or `POST /api/plugins/installed/<id>/vault`), never by editing the file. Implement `GET /healthz` (any response counts as healthy). Never set a `hostname` option in `Bun.serve` — the control plane reaches your server over the container network, so it must bind all interfaces (the default). A loopback pin (`"127.0.0.1"`) leaves the server alive while every health probe fails, and the dashboard reports it dead.
- `dashboard.pages.ui` — the frontend, written as real files (`server/index.html` + `app.ts` + `styles.css`), never HTML-in-a-template-string. Set `ui` to the index.html `files[]` source and declare every frontend file in `files[]` (`exec: false`): the control plane bundles the entry with `bun build --compile --target=browser` into one self-contained HTML at install (TS/JSX transpiled, CSS and assets inlined) and serves it to your server through `OPEN_BOT_PAGE_UI`. `ob-plugin validate` runs the same build locally so errors surface before a release. Serve it like this:

  ```ts
  // The HTML import only works as a static routes value — branch on the mode
  // before Bun.serve. Frozen installs get OPEN_BOT_PAGE_UI; local checkouts
  // and previews import the file live (bun --hot reloads edits).
  const routes = process.env.OPEN_BOT_PAGE_UI
    ? { "/": () => new Response(Bun.file(process.env.OPEN_BOT_PAGE_UI as string),
        { headers: { "content-type": "text/html; charset=utf-8" } }) }
    : { "/": await import("./index.html").then((m) => m.default) }
  Bun.serve({ port: Number(process.env.OPEN_BOT_PAGE_PORT ?? 4740), routes, fetch })
  ```

  Page rules: fetch with relative paths only (`fetch("api/items")` — a leading `/` escapes the dashboard proxy and 404s); never touch `localStorage`/`sessionStorage` without a try/catch (the sandboxed frame throws); never use `window.confirm`/`prompt`/`alert` (the sandboxed iframe silently blocks them — they return `false`/`null` with no error and no dialog, so the action just does nothing; build in-page dialogs instead); device access (microphone/camera/screen via `navigator.mediaDevices`, location via `navigator.geolocation`, MIDI via `navigator.requestMIDIAccess`, clipboard writes via `navigator.clipboard.writeText`) goes through the dashboard's consent bridge — call the standard APIs and feature-check `navigator.mediaDevices` first (`enumerateDevices` returns an empty list, and clipboard reads are unavailable in same-host frames); style pages to follow the dashboard theme — light default plus `@media (prefers-color-scheme: dark)` overrides (or CSS variables), never your own theme toggle, never a persisted theme choice, never one hardcoded palette; keep referenced assets small — the bundle has an 8 MB cap.
- `dashboard.pages.public: true` — opt in to a public HTTP endpoint: `/hooks/<userId>/<pluginId>/<path>` (the dashboard shows the full URL; the short legacy `/hooks/<pluginId>/` form still works) behaves like a normal web server in front of your server — any method, pages and assets, streaming responses, even WebSocket upgrades. The user manages it on the web Config page's Endpoints tab (copy the URL, fire a test request, see whether the server is running, set an optional secret that makes callers authenticate with `X-Open-Bot-Webhook-Secret` or `?secret=`); the Plugins tab → Settings dialog shows the same per-plugin. A hit wakes a sleeping desktop, boots your server if needed, and forwards the request (method, headers minus cookies, body up to 25 MB); your response goes back to the caller verbatim, and the ~30 s deadline only covers reaching your server — streams keep flowing after. Append `?ob_async=1` to the URL to accept 202 and process in the background (cold wake can exceed strict sender timeouts like GitHub's 10 s). The endpoint is public — treat requests as unauthenticated input, validate payloads, and never trust headers. You manage it from the shell too: `ob-plugin endpoint <id>` reports `{enabled, secured, url, secret}` (raw secret — agent-only), `ob-plugin endpoint <id> url` prints the shareable URL (the instance's public origin when the admin set one on the Plugins tab, else `OPEN_BOT_PUBLIC_URL` on the control plane, else the internal control URL), `ob-plugin endpoint <id> secret VALUE` / `secret --generate` set the secret, `secret clear` (or `ob-plugin endpoint <id> clear`) removes it; test a secured endpoint with `curl -s -H "X-Open-Bot-Webhook-Secret: $(ob-plugin endpoint <id> secret)" "$(ob-plugin endpoint <id> url)"`.
- `dashboard.tabs[]` — what the user sees in the Dashboards view:
  - `kind: "app"` — your server's UI in a sandboxed iframe, proxied by the control plane (streaming SSE and WebSockets pass through). Optional `path` (default `/`) is the route on YOUR server the tab opens — not a dashboard URL.
  - `kind: "page"` with `dataUrl` + `pollSeconds` — the dashboard polls your server for JSON and feeds it to declarative `cards` (stat/table/list/markdown with `$.path` bindings). No HTML needed for read-only views.
  - `kind: "iframe"` with `url` (https only) — embeds an external site directly; your server is not involved.

How the control-plane proxy maps paths (get this wrong and every route 404s):

- The dashboard reaches your server at `/api/pages/<pluginId><path>` (app tabs actually load a capability-token frame `/api/pages/_frame/<token><path>` — same mapping). The prefix is stripped before forwarding: your server sees exactly `<path>`. Write plain routes (`/`, `/api/summary`) and never repeat `/api/pages/...` in manifest paths, server routes, or redirects.
- `tabs[].path` and `dataUrl` are routes on your server. The dashboard prepends its own prefix, so `"dataUrl": "/api/summary"` polls your `/api/summary` — a value that already contains `/api/pages/` is always wrong.
- HTML and CSS responses are the only ones rewritten: root-absolute `href`/`src`/`action`/`poster`/`srcset`, inline `<style>` blocks, and `.css` files (`url(...)`, `@import`) get the proxy prefix injected plus a `<base>` tag, so absolute asset links work. JavaScript is never rewritten — fetch with relative paths only. Bodies over 8 MB skip the rewrite entirely.
- Request headers `cookie`, `authorization`, and `host` are stripped before your server sees the request, and `x-open-bot-page-token` is injected. The user's dashboard session never reaches your server — the page token is the only credential; require it on everything beyond `/healthz` (the scaffold's `authorized()` shows the pattern).
- Language: the dashboard's language (Config page → Langue) reaches your plugin two ways — the `language` field in `~/.config/open-bot/plugin-<id>.json` (stable, read at boot or on the config re-sync that follows a change) and `x-open-bot-language` on every proxied request (`/api/pages/*` and the app frame), injected per request so a running server picks up a switch with no restart. The app frame URL also carries `?lang=` for client-side reads via `location.search`. Localize with these and never ship your own language selector.
- Frame tokens slide for 10 minutes per request and the dashboard remints them automatically on a 401 — never hardcode, persist, or share a frame URL, and treat a frame 401 around a deploy as normal churn, not a bug.

Minimal stock-list example (the working version lives in the `ob-plugin new` scaffold):

```json
{
  "files": [
    { "name": "server.ts", "source": "server/server.ts", "exec": true },
    { "name": "index.html", "source": "server/index.html", "exec": false },
    { "name": "app.ts", "source": "server/app.ts", "exec": false },
    { "name": "styles.css", "source": "server/styles.css", "exec": false }
  ],
  "dashboard": {
    "pages": { "entry": "server.ts", "ui": "server/index.html" },
    "tabs": [
      { "id": "stock", "title": "Stock", "kind": "app" },
      { "id": "summary", "title": "Summary", "kind": "page", "dataUrl": "/api/summary", "pollSeconds": 15,
        "cards": [{ "kind": "table", "columns": ["Item", "Qty"], "rows": "$.rows" }] }
    ]
  }
}
```

```ts
// server/server.ts — API routes + the ui route above; no HTML strings.
Bun.serve({ port, routes, async fetch(req) {
  const url = new URL(req.url)
  if (url.pathname === "/healthz") return new Response("ok")
  if (url.pathname === "/api/summary")
    return Response.json({ rows: items.map((i) => [i.name, String(i.qty)]) })
  return new Response("not found", { status: 404 })
} })
```

```html
<!-- server/index.html — real markup; app.ts and styles.css ride along -->
<body>
  <h1>Stock</h1>
  <script type="module" src="./app.ts"></script>
</body>
```

Keep page servers stateless across restarts or persist under `/home/agent/.open-bot/pages-data/<pluginId>/` (the home volume survives updates).

Dashboard pages load in a sandboxed iframe: no session cookies, and `localStorage`/`sessionStorage` throw `SecurityError` on touch (the control plane injects an in-memory fallback, but never rely on storage persisting across reloads) — an unguarded top-level read kills the whole script and every `fetch` on the page with it. The same frame blocks modal dialogs: `window.confirm`/`prompt`/`alert` return `false`/`null` silently (no error, no dialog), so a confirm-gated delete or a prompt-based rename just does nothing. Always build in-page dialogs (an inline form or a small overlay) instead of reaching for the browser modals.

Devices: the same-host frame is an opaque origin — never a secure context — so `navigator.mediaDevices`/`geolocation`/`clipboard`/`requestMIDIAccess` do not exist natively. The injected shim bridges them: `getUserMedia({audio, video})` and `getDisplayMedia` ask the dashboard (live tracks arrive as a normal `MediaStream` over an in-page WebRTC relay), `geolocation.getCurrentPosition`/`watchPosition` deliver real position fixes, `requestMIDIAccess({sysex})` returns a working MIDIAccess-like object (inputs relay `onmidimessage`, outputs `send()`, `onstatechange` tracks plug/unplug), and `clipboard.writeText` writes through the shell — the user confirms mic/camera/screen/location/MIDI in an in-dashboard consent bar (remembered per app for the session); clipboard writes ride the user's own copy click without extra prompts. Keep fallbacks for rejection (a `NotAllowedError`): an in-page notice, never a silent failure. `enumerateDevices` returns an empty list and clipboard reads are unavailable in same-host frames — never assume them. On an instance with a dedicated pages origin (`OPEN_BOT_PAGES_ORIGIN`) frames are real https origins: the browser's own permission flow handles everything natively.

## Dynamic @mentions

A plugin with a page server can add live entries to the chat composer's `@` menu. Declare `dashboard.mentions` (max 4; needs `dashboard.pages`):

```json
{
  "dashboard": {
    "pages": { "entry": "server.ts" },
    "mentions": [{ "section": "stock", "label": "Stock", "path": "/mentions" }]
  }
}
```

`section` is the slug typed after `@` (`@stock/Widget`). It cannot be a reserved section (`personas`, `cron`, `skills`, `projects`, `reports`, `plugins`, or their singulars). `label` (max 32, default the slug) is the menu heading and the word the agent sees in the reference line. `path` (default `/mentions`) is a plugin-server-relative JSON path. First enabled plugin to claim a slug wins; a later plugin's Plugins-tab row warns that the slug is already claimed.

Serve `GET <path>` as `{ "items": [{ "name": "Widget", "description": "12 in stock", "aliases": ["1"], "hint": "how the agent should use this entry" }] }`. Caps: 100 items, name ≤ 80, description and hint ≤ 200, 5 aliases × 40 chars. The composer refetches when the `@` menu opens (about every 30 s); send-time resolution fetches again so the agent gets a "Message references:" line like the built-in sections. If the page server is down the mention degrades to "list is unavailable" — implement `GET /healthz` and keep this handler fast.

Developing a dashboard page (the dev loop):

1. `ob-plugin page <id>` prints the running server's status: `{pluginId, enabled, running, port, pid}` plus a loopback URL hint on stderr. The port is 4740-4759 inside this container — the server runs here next to you.
2. Click-test the real page: `ob-chrome navigate http://127.0.0.1:<port>/` opens it on this thread's screen (the managed browser shares the server's container, so loopback works; the dashboard itself at port 4096 stays unreachable — the proxied copy lives in the user's browser). Use `ob-page` to read and interact. Plain `curl` and a headless bun DOM (happy-dom) remain the fallback for JSON and scripted assertions.
3. Local installs run the checkout copy with `bun --hot` — edit `~/plugins-create/<slug>/...` and the running server picks it up, no restart. Marketplace installs serve the frozen payload copy: changes land on the next `ob-plugin install` (which restarts the server when it is running) or on the next start after an idle stop. To bounce a server that is wedged or failed to boot (the install response warns), `ob-plugin restart <id>` — note the server may simply be idle-stopped; any dashboard visit restarts it.
4. Show the user the page in-thread: `ob-preview up --entry ~/plugins-create/<slug>/server/server.ts` and end with the `![title](open-bot://preview)` line. The preview runtime exports the same env a production start does (`OPEN_BOT_PAGE_PORT` is the preview port), so the server code runs unchanged and hot-reloads between edits. One difference: requests relayed through the preview embed carry no `x-open-bot-page-token` header, and the dev token env is the fixed value `dev-preview` — so write the check as "open when `OPEN_BOT_PAGE_TOKEN` is unset or `dev-preview`, otherwise require an exact header match". Never accept `dev-preview` as an incoming header value while a real token is set: that is a backdoor (any local process knows the literal), the marketplace security review flags it as a concern, and production surfaces (dashboard proxy, public `/hooks`) always inject the real token.

Save the working harness (ports, commands, assertions) as a `shortcut` skill so the next stress-test reuses it.

## Rules

- Plugin projects live in `~/plugins-create/<slug>/`. Do not scatter plugin files elsewhere.
- Write plugin code in TypeScript, not JavaScript. Every code file — `tools[]` script content (with a `#!/usr/bin/env bun` shebang), `files[]` payloads, and the dashboard page server — is a `.ts` file: Bun on the desktop runs `.ts` natively, so `server.ts` needs no build step. Reach for plain JavaScript only for shell scripts or when a non-Bun runtime forces it.
- Dashboard UIs are real files, never strings: write `index.html` + `app.ts` + `styles.css` and let Bun bundle them (`dashboard.pages.ui`) — do not build HTML with template literals inside `server.ts`.
- Only publish manifests you validated. Never publish another creator's plugin under your name.
- Do not edit installed plugin payloads by hand (skills, cron jobs named `plugin:<id>:...`, `/usr/local/bin/ob-plugin-<id>-*` tools, `~/.config/open-bot/plugin-<id>.json`, `~/.open-bot/plugin-init/<id>.log` setup logs). Uninstall, reinstall from `--path`, or republish instead.
- Do not touch the guard cron of a plugin you did not publish.
- Calling another plugin's CLI (`ob-plugin-<other>-*`) makes it a companion plugin: treat the companion as optional. Your plugin must degrade cleanly when it is not installed — check availability first (`command -v ob-plugin-<other>-tool` or Bun.which) and skip or fall back, never hard-fail. Watch the trap: `Bun.spawnSync` **throws ENOENT** when the binary is missing instead of returning an exit code, so an unguarded call crashes your whole tool. Test the degraded path with the companion deliberately absent (uninstall it, or stub the check).
- Plugin tools and skills can use the desktop's built-in CLIs instead of bundling their own API keys: `ob-media`, `ob-report`, `ob-system1` (the System 1 decision model — quick picks, scores, or vision checks), and the rest of the `ob-*` CLIs. Handle their error JSON gracefully; do not print tokens. For a custom API call against a provider the user connected on the dashboard Keys tab, `ob-api-key <provider>` prints that key (e.g. `curl -H "Authorization: Bearer $(ob-api-key xai)" ...`; empty output and exit 1 mean none is set; `--json` adds accountId/baseUrl/gateway fields, `ob-api-key list` shows what is set — plugin-declared `vaultCreate` slugs appear there and print the same way; `vaultRead`-only slugs stay dashboard-managed) — use the key inside the command and never print it.
