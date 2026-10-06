# OpenViking models via Cloudflare Workers AI

Each desktop's OpenViking instance needs an embedding model and a VLM. Every user sets their own on the **Config** page (`/config`); an admin can set a fallback default under **Admin → OpenViking models (default)** that applies to users who have not saved their own values.

## Prerequisites

- A Cloudflare account with Workers AI enabled (Workers Paid for the models below)
- An API token with Workers AI edit permission (create one in dash.cloudflare.com → My Profile → API Tokens)
- Your Cloudflare account ID (dash.cloudflare.com overview, right sidebar)

## Set the models

1. Log in to the control plane.
2. Open **Config** (every user; saves to your own desktop) — or **Admin → OpenViking models (default)** for the account-wide fallback.
3. Fill the form:

| Field | Value |
| --- | --- |
| Base URL | `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1` |
| API key | the Workers AI token |
| Embed model | `@cf/qwen/qwen3-embedding-0.6b` |
| Embed dimension | `1024` |
| VLM model | `@cf/zai-org/glm-5.3-flash` |

4. Click **Save OpenViking models**. A blank API key keeps the already-saved key.

The Base URL is the Workers AI OpenAI-compatible endpoint; model IDs keep the `@cf/` prefix. The same values are proven in `~/.openviking/ov.conf` on the host.

## Apply

Restart the desktop (sleep it, then start it again) so the per-user OpenViking container is recreated with the saved config. Desktop start passes the config to the OpenViking container via the `OPENVIKING_CONF_CONTENT` environment variable (`apps/control/src/docker.ts` `vikingConfig`), so there is no config file to manage on the host.

## Form limitations

The Admin form sends no extra fields, so it cannot set:

- `cf-aig-gateway-id` — the host `~/.openviking/ov.conf` routes embeddings through an AI Gateway named `embeddings` for caching and logs. Without the header, requests go straight to Workers AI; they still work, just without gateway caching/analytics.
- `reasoning_effort: low` for the VLM. GLM-5.3-Flash still answers without it.

## Verify

- `curl http://127.0.0.1:8787/api/health` returns `{"ok":true}` (adjust host/port to your publish address)
- Start a desktop, then from inside the OpenCode container: `ov find "anything"` — recall returning results means embeddings work
- Ask the agent to take a screenshot — a described image means the VLM works

## Related

- Chat models are not set here. Connect them on the **Providers** page with `opencode auth login` inside the user container.
