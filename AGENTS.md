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
- Publishing auto-creates a daily guard cron `plugin:<id>:guard` — the creator agent keeps the GitHub repo and marketplace discussion healthy.
- Install policy (`app_settings.plugin_install_policy`): `manual` (default, confirm dialog) or `auto` (no restriction, also installs pending-review plugins). Toggle on the Plugins page (admin).
- Marketplace config for the control container (deploy/.env): `OPEN_BOT_MARKETPLACE_URL`, `OPEN_BOT_MARKETPLACE_TOKEN`, `OPEN_BOT_GITHUB_TOKEN` (agent identity, injected into desktops for gh/git).
- Marketplace secrets: `MARKETPLACE_TOKEN` (instance writes), `ADMIN_TOKEN` (review queue), optional `GITHUB_TOKEN` (README fetch). D1 migrations: `apps/marketplace/migrations`; deploy `bun run --cwd apps/marketplace deploy`.
- Manifest or DB changes need `bun run db:generate` for new tables and an image rebuild + desktop restart (`bun run images && bun run update -- --dev`) before existing desktops see new seed skills/CLIs.
