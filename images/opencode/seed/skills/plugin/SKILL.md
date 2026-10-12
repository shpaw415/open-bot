---
name: plugin
description: Create, publish, install, and maintain open-bot plugins. Use when a task needs a capability the desktop does not have, when the user asks about plugins or the marketplace, or when a message starts with [cron: and mentions a plugin guard.
---

# Plugins

Plugins extend what you can do: skills, personalities, scheduled jobs, desktop tools, dashboard tabs, chat composer features, vault keys, and OpenCode extensions. They live on the open-bot plugin marketplace. Use the `ob-plugin` CLI.

## When you lack a capability

When a task needs something you cannot do with current tools, skills, or plugins, search the marketplace before building anything: run `ob-plugin search` with keywords from the task (plus `ob-plugin info <id>` on candidates). If a maintained plugin fits, install it with `ob-plugin install <id>` — the instance's install policy still applies, so `manual` mode shows the user a consent dialog — and skip the rest of this section. Only build a plugin instead of giving up or hand-rolling a one-off when the search finds nothing suitable, a candidate falls short of the task, or the marketplace is unreachable:

1. Scaffold: `ob-plugin new <slug>` creates `~/plugins-create/<slug>/` with `open-bot.plugin.json` and a README.
2. Implement: fill the manifest following the JSON schema at `~/.config/opencode/skills/plugin/open-bot.plugin.schema.json` — read it before writing any field you are unsure about; every field name, pattern, and limit is defined there, and unknown fields are rejected. Inline sections: `skills`, `personas`, `cron`, `tools`, `configs`, `setup`, `hooks`, `permissions`, `dashboard`, `textbox`, `opencode`. Tool files are plain scripts installed into `/usr/local/bin`. Larger text payloads go in `files[]` (`{name, source, exec}` — repo-relative paths shipped in the release tarball, installed next to tools). `configs[]` are settings shown on the Plugins page — give each a `type` (`string` default, `bool`, `number`, `enum` with `options[]`, `secret`) so the user gets a proper input and values are validated. `hooks[]` run a short prompt in a hidden worker thread when `session.idle` or `thread.created` fires (max 8, capped at 20 runs/day per plugin; worker threads never re-trigger hooks — use them for reactive automation, not loops). `permissions.notifications: true` lets the plugin's tools and skills post dashboard notifications with `ob-plugin notify <id> "title" "body"`. `opencode.agents` registers new agent workers (built-in names are rejected); `opencode.agentTools` patches tool globs on existing agents (e.g. `{"build": {"myplugin_*": false}}`); `opencode.agentsMd` is a short block of standing instructions (max 4000 chars) injected next to AGENTS.md for as long as the plugin is installed — durable behavioral rules the agent must always follow, never secrets and never per-task prompts. `setup.commands` are shell commands run as root in the desktop at install and re-run after every desktop recreate — use them for environment setup the plugin needs (e.g. `"sudo apt-get install -y figlet"`); keep them idempotent and minimal, and pair destructive ones with `setup.uninstall` cleanup. Helper sessions the plugin spawns (worker pipelines, batch jobs) must be titled with the `worker:` prefix so they stay out of the dashboard thread list (same convention as `cron-run:`).
3. Test locally: run the tool scripts yourself, walk through the skill steps, and check the cron prompt reads well.
4. Validate: `ob-plugin validate ~/plugins-create/<slug>` and fix every issue.
5. Install locally: `ob-plugin install --path ~/plugins-create/<slug>`. It lands in the installed list with (local) beside the name. Re-run that command, or Re-install on the Plugins page, to pick up edits. Remove works like any other install.
6. Publish (see below), then `ob-plugin install <slug>` when the plugin should leave this desktop and live on the marketplace.
7. Stress-test: load the `stress-test` skill and run the installed plugin through complex use cases from the user's seat, filing defects and iterating versions until every case passes. Do not tell the user it works before it passes. Iterate on a dev tag (`beta-1`) while staging — see below — and publish semver once it passes.

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
- Never put secrets in a manifest. Request vault slugs with `permissions.vaultCreate` and let the user fill values on the Config Keys page.

## Staging a release (dev tags)

For stress-testing and staging before a stable release, publish a dev tag instead of bumping semver. Set the manifest `version` to a short lowercase tag (e.g. `beta-1`, `staging.2`), then let one command do the whole loop — commit, push, force-move the `v<tag>` tag, clobber the release, publish, wait for the review, and reinstall the pinned version if the plugin is already installed:

```sh
ob-plugin publish ~/plugins-create/NAME --dev
```

`--no-commit` skips the git commit step if you already committed. The manual equivalent is:

```sh
git add -A && git commit -m "beta-1"
git tag -f vbeta-1 && git push -f origin vbeta-1
gh release create vbeta-1 -R OWNER/NAME --notes "Dev build" --clobber || true
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
ob-plugin notify weather-pro "Backup done" "3 files copied"   # dashboard notification (needs permissions.notifications)
```

Install respects the instance policy: `manual` asks the user to confirm the permission list (a `--yes` flag skips only when the policy allows it), `auto` installs immediately. To report a bug in a plugin you use, prefer `ob-plugin issue` — the creator's guard cron picks it up within a day. While developing or stress-testing a plugin from a local checkout, file findings with `ob-report` instead (see the `report` skill): reports stay on this desktop, other threads can fix them, and the user tracks them in the dashboard Reports view with `@reports/<slug>` mentions.

## Dashboard pages (live plugin dashboards)

A plugin can ship a dashboard: a view in the workspace drawer's Dashboards list where the user sees live data and can act on it (stock lists, trackers, admin panels). Two building blocks in the manifest:

- `dashboard.pages: { "entry": "server.js" }` — declares a page server: `server.js` must be a `files[]` payload (a Bun HTTP server). The control plane installs it next to tools and runs it with Bun at install, at enable, and after every desktop restart, on a port it manages. Env: `OPEN_BOT_PAGE_PORT` (listen port), `OPEN_BOT_PAGE_TOKEN` (shared secret; check `x-open-bot-page-token` on requests if you want), `OPEN_BOT_PLUGIN_ID`. Settings and vault keys arrive through the same `~/.config/open-bot/plugin-<id>.json` config file tools get. Implement `GET /healthz` (any response counts as healthy).
- `dashboard.tabs[]` — what the user sees in the Dashboards view:
  - `kind: "app"` — your server's full UI, proxied same-origin by the control plane under `/api/pages/<pluginId>/` (so `fetch("/api/items")` from your page hits your server; relative paths just work). Streaming (SSE) and WebSockets pass through. Optional `path` (default `/`).
  - `kind: "page"` with `dataUrl` + `pollSeconds` — the dashboard polls your server for JSON and feeds it to declarative `cards` (stat/table/list/markdown with `$.path` bindings). No HTML needed for read-only views.

Minimal stock-list example:

```json
{
  "dashboard": {
    "pages": { "entry": "server.js" },
    "tabs": [
      { "id": "stock", "title": "Stock", "kind": "app" },
      { "id": "summary", "title": "Summary", "kind": "page", "dataUrl": "/api/summary", "pollSeconds": 15,
        "cards": [{ "kind": "table", "columns": ["Item", "Qty"], "rows": "$.rows" }] }
    ]
  }
}
```

```js
// files: [{ "name": "server.js", "source": "server/server.js", "exec": true }]
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

## Rules

- Plugin projects live in `~/plugins-create/<slug>/`. Do not scatter plugin files elsewhere.
- Only publish manifests you validated. Never publish another creator's plugin under your name.
- Do not edit installed plugin payloads by hand (skills, cron jobs named `plugin:<id>:...`, `/usr/local/bin/ob-plugin-<id>-*` tools, `~/.config/open-bot/plugin-<id>.json`, `~/.open-bot/plugin-init/<id>.log` setup logs). Uninstall, reinstall from `--path`, or republish instead.
- Do not touch the guard cron of a plugin you did not publish.
- Plugin tools and skills can use the desktop's built-in CLIs instead of bundling their own API keys: `ob-media`, `ob-report`, `ob-system1` (the System 1 decision model — quick picks, scores, or vision checks), and the rest of the `ob-*` CLIs. Handle their error JSON gracefully; do not print tokens.
