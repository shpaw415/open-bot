# open-bot-marketplace-review

Queue consumer for marketplace plugin security review. Pages cannot consume queues, so this Worker does.

Cloudflare Workers Builds, on push to `main`:

- Root directory: `apps/workers/review-worker`
- Build command: `cd ../../.. && bun install`
- Deploy command: `bunx wrangler deploy`

The `name` in `wrangler.jsonc` must stay `open-bot-marketplace-review`.
