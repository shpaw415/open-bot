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

## Voice (browser STT + read-aloud)

Core control-plane feature (added 2026-10-09, `apps/control/src/voice-providers.ts` + routes in `server.ts`): per-user config on the `desktops` row (`stt_/tts_` provider/account/key/model, `tts_voice`, `voice_language`; migration 0002) managed via `GET/PUT/DELETE /api/voice` (keys never returned to the browser; vault fallback — Workers AI reuses the `cloudflare` slug, xAI→`xai`, OpenAI→`openai`). `POST /api/stt` takes the browser recording as multipart `audio` (25 MB cap) and returns `{text}`; `POST /api/tts` takes `{text}` (4000-char cap) and returns audio bytes (xAI `POST /v1/tts` `{text, voice_id, language}`, OpenAI `/audio/speech`, Workers AI REST `@cf/openai/whisper` / `@cf/myshell-ai/melotts`). UI: hold-to-speak mic + read-aloud toggle live in `apps/web/src/Workspace.tsx` (Composer), Voice tab in Config (`VoiceProvider.tsx`); `speakableText` in `chat-view.ts` strips markdown/plugin-cards before synthesis. The desktop agent never sees audio — transcripts arrive as plain text in the prompt.

## Plugin system + marketplace

Plugins extend the desktop agent (skills, personas, cron, desktop tools, vault keys, dashboard tabs, chat composer features, OpenCode plugins/MCP). One manifest (`open-bot.plugin.json`; JSON schema `packages/plugin-kit/schema/open-bot.plugin.schema.json`, seeded into desktops at `~/.config/opencode/skills/plugin/` and referenced by `ob-plugin new` scaffolds — keep it in sync with the `validatePluginManifest` constants, enforced by `schema.test.ts`) describes everything; GitHub repos hold the code and releases, `apps/marketplace` (frame-master cloudflare-nextjs on Cloudflare Pages + D1) is the searchable index, review queue, and agent discussion board.

- Control plane: `apps/control/src/plugins.ts` (routes under `/api/plugins/*`, agent auth via llm token like cron/personas), `apps/control/src/plugins-apply.ts` (apply/uninstall engine; install log on the `installed_plugins` row reverses everything).
- Desktop: `scripts/ob-plugin.sh` (`new/validate/publish/search/install/...`), seed skill `images/opencode/seed/skills/plugin`, `apply-plugin-auth.sh` writes `~/.config/open-bot/plugin-<id>.json`, plugin tools land in `/usr/local/bin/ob-plugin-<id>-*`.
- Payload files: manifest `files[]` (`{name, source, exec}`) are fetched from the reviewed release tarball at install (`GET /api/plugins/<id>/artifact` streams the R2 object; control verifies sha256, extracts, installs next to tools; boot re-syncs them). Text files only; for payloads too big to inline as `tools[]`.
- Agent surfaces: `opencode.agents` registers new agent workers (deep-merged into `opencode.json`, reserved names rejected); `opencode.agentTools` patches tool globs on existing agents (e.g. `{"build": {"blender_*": false}}`); `opencode.agentsMd` injects standing instructions next to AGENTS.md (file under `~/.config/open-bot/agents-md/`, entry in the `instructions` array); plugin disable/enable and uninstall reverse them. Helper sessions a plugin spawns must be titled with the `worker:` prefix so the dashboard thread list hides them (like `cron-run:`).
- Setup commands: manifest `setup.commands` run as root in the desktop at install and re-run after every desktop recreate (`onDesktopReady` hook → `reapplyPluginSetup`), `setup.uninstall` runs best-effort at uninstall. Commands appear in the consent dialog and are security-reviewed; output logs to `~/.open-bot/plugin-init/<id>.log`.
- Publishing auto-creates a daily guard cron `plugin:<id>:guard` — the creator agent keeps the GitHub repo and marketplace discussion healthy.
- Dev tags for staging: `version` accepts semver (`X.Y.Z`, optional `-prerelease`) or a dev tag (`beta-1`; `DEV_VERSION_PATTERN`/`isDevVersion` in plugin-kit). Dev publishes get the same security review but never move `plugins.latest_version` (hidden from marketplace search); install with `ob-plugin install <id> --version beta-1`, overwrite by republishing the same tag (upsert re-reviews + re-stores the R2 tarball, force-move the git tag) and reinstalling; dev artifacts bypass the control artifact cache (`plugin-artifact.ts`), so reinstalls and boot re-syncs pick up republished builds; the dashboard Plugins tab has a version picker (dev badges), a Re-install action, and uninstall.
- Install policy (`app_settings.plugin_install_policy`): `manual` (default, confirm dialog) or `auto` (no restriction, also installs pending-review plugins). Toggle on the Plugins page (admin).
- Marketplace config for the control container (deploy/.env): `OPEN_BOT_MARKETPLACE_URL`, `OPEN_BOT_MARKETPLACE_TOKEN`, `OPEN_BOT_GITHUB_TOKEN` (agent identity, injected into desktops for gh/git).
- Marketplace secrets: `MARKETPLACE_TOKEN` (instance writes), `ADMIN_TOKEN` (review queue), optional `GITHUB_TOKEN` (README fetch + security-issue filing). D1 migrations: `apps/marketplace/migrations`; deploy `bun run --cwd apps/marketplace deploy`.
- Auto security review (marketplace, on publish): `POST /api/publish` enqueues `{pluginId, version, enqueuedAt}` on Cloudflare Queue `open-bot-marketplace-security` (Pages producer binding `SECURITY_REVIEW`) and returns immediately. Poll `GET /api/plugins/:id/review?version=` (same auth) for `queued | running | pass | concern | error`. The consumer is a separate Worker (`apps/workers/review-worker`, name `open-bot-marketplace-review`) because Pages cannot consume queues. Push to `main` deploys it through Cloudflare Workers Builds (not a manual `wrangler deploy`): root directory `apps/workers/review-worker`, production branch `main`, build command `cd ../../.. && bun install`, deploy command `bunx wrangler deploy`. The Worker name must match that wrangler file or the Git build fails. It runs GLM 5.3-flash via the Workers AI `AI` binding on the manifest + repo content at tag `v<version>`. pass → `approved`, `latest_version` moves, release tarball (25 MB cap) stored in R2 (`RELEASES`, bucket `open-bot-marketplace-releases`) with sha256 in D1. concern → that version is rejected (a newer version does not hide an already approved listing); `security-bot` comment + GitHub issue on the plugin repo. error → stays `pending`. A newer `enqueuedAt` wins. Loopback publish reviews inline. Every publish re-reviews. Ops: `wrangler queues create open-bot-marketplace-security` (+ `-dlq`), migration `0004_security_review_queue.sql`, `GITHUB_TOKEN` on the consumer Worker, then Pages redeploy so the producer binding exists.
- Marketplace accounts + API keys (migration `0003_marketplace_auth.sql`): users sign in at https://market.open-bot.app (custom domain, active on the Pages project) via openauthster — issuer project `__open_bot_18f8d590` at `https://ef328c08c4d04075a0fd1e7f175983de-auth.webcreas.com` (public PKCE client, no secret needed; vars `OPENAUTH_ISSUER_URL`/`OPENAUTH_CLIENT_ID` in wrangler.jsonc). Account page creates keys (`obm_…`, sha256-hashed in D1, shown once). Paste the key on the dashboard Plugins page ("Marketplace account", admin) → stored in `app_settings.marketplace_api_key`; `marketplace()` in `apps/control/src/plugins.ts` prefers it over the `OPEN_BOT_MARKETPLACE_TOKEN` env fallback. `POST /api/publish` accepts either the instance token or a user API key.
- Manifest or DB changes need `bun run db:generate` for new tables and an image rebuild + desktop restart (`bun run images && bun run update -- --dev`) before existing desktops see new seed skills/CLIs.
