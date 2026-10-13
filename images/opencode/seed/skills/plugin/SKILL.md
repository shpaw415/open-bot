---
name: plugin
description: Create, publish, install, and maintain open-bot plugins. Use when a task needs a capability the desktop does not have, when the user asks about plugins or the marketplace, or when a message starts with [cron: and mentions a plugin guard.
---

# Plugins

Plugins extend what you can do: skills, personalities, scheduled jobs, desktop tools, dashboard tabs, chat composer features, vault keys, and OpenCode extensions. They live on the open-bot plugin marketplace. Use the `ob-plugin` CLI.

## When you lack a capability

When a task needs something you cannot do with current tools, skills, or plugins, search the marketplace before building anything: run `ob-plugin search` with keywords from the task (plus `ob-plugin info <id>` on candidates). If a maintained plugin fits, install it with `ob-plugin install <id>` — the instance's install policy still applies, so `manual` mode shows the user a consent dialog — and skip the rest of this section. Only build a plugin instead of giving up or hand-rolling a one-off when the search finds nothing suitable, a candidate falls short of the task, or the marketplace is unreachable:

1. Scaffold: `ob-plugin new <slug>` creates `~/plugins-create/<slug>/` with `open-bot.plugin.json`, a README, and a CONFIG.md template, and registers it in the dashboard project list under the plugins group — no separate `ob-project add` needed.
2. Implement: fill the manifest following the JSON schema at `~/.config/opencode/skills/plugin/open-bot.plugin.schema.json` — read it before writing any field you are unsure about; every field name, pattern, and limit is defined there, and unknown fields are rejected. Inline sections: `skills`, `personas`, `cron`, `tools`, `configs`, `setup`, `hooks`, `permissions`, `dashboard`, `textbox`, `opencode`. Tool files are plain scripts installed into `/usr/local/bin`. Larger text payloads go in `files[]` (`{name, source, exec}` — repo-relative paths shipped in the release tarball, installed next to tools). `configs[]` are settings shown on the Plugins page — give each a `type` (`string` default, `bool`, `number`, `enum` with `options[]`, `secret`) so the user gets a proper input and values are validated. `cron[]` declares scheduled jobs: `{name, message, everySeconds}` or `{name, message, cronExpr}` (5-field, UTC). Jobs can also run scripts: add `run` + `script` (max 16k chars) — `run: "script"` runs the script and posts its output to the job thread without waking the agent (`message` optional), `run: "auto"` runs the script and wakes the agent only when an output line starts with `[cron-agent]` (prefer it for guards that usually have nothing to do), `run: "both"` runs the script then wakes the agent with the output plus `message`. `hooks[]` run a short prompt in a hidden worker thread when `session.idle` or `thread.created` fires (max 8, capped at 20 runs/day per plugin; worker threads never re-trigger hooks — use them for reactive automation, not loops). `permissions.notifications: true` lets the plugin's tools and skills post dashboard notifications with `ob-plugin notify <id> "title" "body"`. `opencode.agents` registers new agent workers (built-in names are rejected); `opencode.agentTools` patches tool globs on existing agents (e.g. `{"build": {"myplugin_*": false}}`); `opencode.agentsMd` is a short block of standing instructions (max 4000 chars) injected next to AGENTS.md for as long as the plugin is installed — durable behavioral rules the agent must always follow, never secrets and never per-task prompts. `setup.commands` are shell commands run as root in the desktop at install and re-run after every desktop recreate — use them for environment setup the plugin needs (e.g. `"sudo apt-get install -y figlet"`); keep them idempotent and minimal, and pair destructive ones with `setup.uninstall` cleanup. Helper sessions the plugin spawns (worker pipelines, batch jobs) must be titled with the `worker:` prefix so they stay out of the dashboard thread list (same convention as `cron-run:`).
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
- Never put secrets in a manifest. Request vault slugs with `permissions.vaultCreate`. The user can fill any declared slug on the dashboard (Plugins tab → Settings → Vault keys), and you can fill vaultCreate slugs yourself with `ob-plugin vault ID SLUG=value` (write-only; values are stored in the key vault and survive disable/enable/reinstall). Slugs under `permissions.vaultRead` are the user's own keys only they fill: shared provider slugs live on the Config page Keys tab, plugin-specific ones in the same Vault keys section.

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

- `dashboard.pages: { "entry": "server.ts" }` — declares a page server: `server.ts` must be a `files[]` payload (a Bun HTTP server, written in TypeScript — Bun runs `.ts` natively). The control plane installs it next to tools and runs it with Bun at install, at enable, and after every desktop restart, on a port it manages. Env: `OPEN_BOT_PAGE_PORT` (listen port), `OPEN_BOT_PAGE_TOKEN` (shared secret; check `x-open-bot-page-token` on requests if you want), `OPEN_BOT_PLUGIN_ID`. Settings and vault keys arrive through the same `~/.config/open-bot/plugin-<id>.json` config file tools get; the file is regenerated from the control plane, so persist vault changes with `ob-plugin vault` (or `POST /api/plugins/installed/<id>/vault`), never by editing the file. Implement `GET /healthz` (any response counts as healthy).
- `dashboard.tabs[]` — what the user sees in the Dashboards view:
  - `kind: "app"` — your server's full UI, proxied same-origin by the control plane under `/api/pages/<pluginId>/` (so `fetch("api/items")` from your page hits your server; relative paths without a leading slash just work — a leading `/` escapes the proxy to the dashboard root and 404s). Streaming (SSE) and WebSockets pass through. Optional `path` (default `/`).
  - `kind: "page"` with `dataUrl` + `pollSeconds` — the dashboard polls your server for JSON and feeds it to declarative `cards` (stat/table/list/markdown with `$.path` bindings). No HTML needed for read-only views.

Minimal stock-list example:

```json
{
  "dashboard": {
    "pages": { "entry": "server.ts" },
    "tabs": [
      { "id": "stock", "title": "Stock", "kind": "app" },
      { "id": "summary", "title": "Summary", "kind": "page", "dataUrl": "/api/summary", "pollSeconds": 15,
        "cards": [{ "kind": "table", "columns": ["Item", "Qty"], "rows": "$.rows" }] }
    ]
  }
}
```

```ts
// files: [{ "name": "server.ts", "source": "server/server.ts", "exec": true }]
const items = [{ name: "Widget", qty: 12 }]
Bun.serve({
  port: Number(process.env.OPEN_BOT_PAGE_PORT ?? 4740),
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/healthz") return new Response("ok")
    if (url.pathname === "/api/summary")
      return Response.json({ rows: items.map((i) => [i.name, String(i.qty)]) })
    if (url.pathname === "/") return new Response(indexHtml(), { headers: { "content-type": "text/html" } })
    return new Response("not found", { status: 404 })
  },
})
```

Keep page servers stateless across restarts or persist under `/home/agent/.open-bot/pages-data/<pluginId>/` (the home volume survives updates).

Click-testing your page: `ob-nav http://localhost:4096/...` cannot reach the dashboard — the desktop's Chromium sits outside the control plane's network namespace (it ends in chrome-error), and the proxied dashboard lives in the user's browser, out of ob-nav's reach. To click-test, read the page server's own port (`OPEN_BOT_PAGE_PORT`, loopback 4740-4759 inside the container) and drive a headless DOM against `http://127.0.0.1:<port>/` from bun (happy-dom), or plain `curl` for the JSON endpoints. Save the working harness as a `shortcut` skill so the next stress-test reuses it.

## Rules

- Plugin projects live in `~/plugins-create/<slug>/`. Do not scatter plugin files elsewhere.
- Write plugin code in TypeScript, not JavaScript. Every code file — `tools[]` script content (with a `#!/usr/bin/env bun` shebang), `files[]` payloads, and the dashboard page server — is a `.ts` file: Bun on the desktop runs `.ts` natively, so `server.ts` needs no build step. Reach for plain JavaScript only for shell scripts or when a non-Bun runtime forces it.
- Only publish manifests you validated. Never publish another creator's plugin under your name.
- Do not edit installed plugin payloads by hand (skills, cron jobs named `plugin:<id>:...`, `/usr/local/bin/ob-plugin-<id>-*` tools, `~/.config/open-bot/plugin-<id>.json`, `~/.open-bot/plugin-init/<id>.log` setup logs). Uninstall, reinstall from `--path`, or republish instead.
- Do not touch the guard cron of a plugin you did not publish.
- Plugin tools and skills can use the desktop's built-in CLIs instead of bundling their own API keys: `ob-media`, `ob-report`, `ob-system1` (the System 1 decision model — quick picks, scores, or vision checks), and the rest of the `ob-*` CLIs. Handle their error JSON gracefully; do not print tokens.
