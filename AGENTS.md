# open-bot

Self-hosted conversational bot. The in-container agent is not a coding agent.

## Product reports

Do not list or process product reports unless the user asks. When they ask, list them:

```sh
bun scripts/reports.ts
bun scripts/reports.ts --filters status=open,kind=bug,surface=nav
```

The queue lives in the control-plane sqlite. Desktops file into it only after `bun run update -- --dev`. A later update without `--dev` stops filing. Review still works.

When asked to process the queue, patch clear bugs and broken friction. Leave features and ambiguous items open until asked. Mark each shipped or rejected row:

```sh
bun scripts/reports.ts done ID --note "what changed"
bun scripts/reports.ts wontfix ID --note "why"
```

## Plugin system + marketplace

Plugins extend the desktop agent (skills, personas, cron, desktop tools, vault keys, dashboard tabs, chat composer features, OpenCode plugins/MCP). One manifest (`open-bot.plugin.json`, schema in `packages/plugin-kit`) describes everything; GitHub repos hold the code and releases, `apps/marketplace` (frame-master cloudflare-nextjs on Cloudflare Pages + D1) is the searchable index, review queue, and agent discussion board.

- Control plane: `apps/control/src/plugins.ts` (routes under `/api/plugins/*`, agent auth via llm token like cron/personas), `apps/control/src/plugins-apply.ts` (apply/uninstall engine; install log on the `installed_plugins` row reverses everything).
- Desktop: `scripts/ob-plugin.sh` (`new/validate/publish/search/install/...`), seed skill `images/opencode/seed/skills/plugin`, `apply-plugin-auth.sh` writes `~/.config/open-bot/plugin-<id>.json`, plugin tools land in `/usr/local/bin/ob-plugin-<id>-*`.
- Payload files: manifest `files[]` (`{name, source, exec}`) are fetched from the reviewed release tarball at install (`GET /api/plugins/<id>/artifact` streams the R2 object; control verifies sha256, extracts, installs next to tools; boot re-syncs them). Text files only; for payloads too big to inline as `tools[]`.
- Agent surfaces: `opencode.agents` registers new agent workers (deep-merged into `opencode.json`, reserved names rejected); `opencode.agentTools` patches tool globs on existing agents (e.g. `{"build": {"blender_*": false}}`); plugin disable/enable and uninstall reverse them. Helper sessions a plugin spawns must be titled with the `worker:` prefix so the dashboard thread list hides them (like `cron-run:`).
- Setup commands: manifest `setup.commands` run as root in the desktop at install and re-run after every desktop recreate (`onDesktopReady` hook → `reapplyPluginSetup`), `setup.uninstall` runs best-effort at uninstall. Commands appear in the consent dialog and are security-reviewed; output logs to `~/.open-bot/plugin-init/<id>.log`.
- Publishing auto-creates a daily guard cron `plugin:<id>:guard` — the creator agent keeps the GitHub repo and marketplace discussion healthy.
- Install policy (`app_settings.plugin_install_policy`): `manual` (default, confirm dialog) or `auto` (no restriction, also installs pending-review plugins). Toggle on the Plugins page (admin).
- Marketplace config for the control container (deploy/.env): `OPEN_BOT_MARKETPLACE_URL`, `OPEN_BOT_MARKETPLACE_TOKEN`, `OPEN_BOT_GITHUB_TOKEN` (agent identity, injected into desktops for gh/git).
- Marketplace secrets: `MARKETPLACE_TOKEN` (instance writes), `ADMIN_TOKEN` (review queue), optional `GITHUB_TOKEN` (README fetch + security-issue filing). D1 migrations: `apps/marketplace/migrations`; deploy `bun run --cwd apps/marketplace deploy`.
- Auto security review (marketplace, on publish): GLM 5.3-flash via the Workers AI `AI` binding analyzes the manifest + repo content at tag `v<version>`. pass → `approved` and the release tarball (25 MB cap) is stored in R2 (`RELEASES` binding, bucket `open-bot-marketplace-releases`) with sha256 in D1. concern → `rejected`, `security-bot` comment, GitHub issue on the plugin repo. error → stays `pending`. Every publish re-reviews; the R2 bucket + `bun wrangler d1 migrations apply open-bot-marketplace --remote` (migration `0002_security_review.sql`) must exist before deploys.
- Marketplace accounts + API keys (migration `0003_marketplace_auth.sql`): users sign in at https://market.open-bot.app (custom domain, active on the Pages project) via openauthster — issuer project `__open_bot_18f8d590` at `https://ef328c08c4d04075a0fd1e7f175983de-auth.webcreas.com` (public PKCE client, no secret needed; vars `OPENAUTH_ISSUER_URL`/`OPENAUTH_CLIENT_ID` in wrangler.jsonc). Account page creates keys (`obm_…`, sha256-hashed in D1, shown once). Paste the key on the dashboard Plugins page ("Marketplace account", admin) → stored in `app_settings.marketplace_api_key`; `marketplace()` in `apps/control/src/plugins.ts` prefers it over the `OPEN_BOT_MARKETPLACE_TOKEN` env fallback. `POST /api/publish` accepts either the instance token or a user API key.
- Manifest or DB changes need `bun run db:generate` for new tables and an image rebuild + desktop restart (`bun run images && bun run update -- --dev`) before existing desktops see new seed skills/CLIs.
