---
name: gen-video
description: Generate videos from text prompts with the gen-video CLI. It reads the provider configured on the open-bot config page and dispatches xAI Grok Imagine, OpenAI Sora 2, Google Veo, Replicate, or fal.ai. Use whenever the user asks for a video, a clip, an animation, or any text-to-video render. Triggers - gen-video, video, clip, generate video, animation, grok imagine, sora, veo, kling, minimax.
---

# gen-video — open-bot video generation

`gen-video` reads the provider configured on the config page from
`~/.config/open-bot/video.json` (`{provider, model}`) and its credentials from
`~/.config/open-bot/video-auth.json` (mode 600). One command works for every
provider — never call provider APIs directly and never read the auth file.

## Usage

```sh
gen-video "a neon koi swimming through clouds" -o /home/agent/workspace/koi.mp4
```

- `-o path` saves there; without it the file lands in `/home/agent/workspace`
  as `gen-video-<timestamp>.mp4`.
- `--seconds N` sets the clip length; 1-15 on xAI, 4/8/12 on OpenAI; other
  providers ignore it.
- `--model name` overrides the configured model for this one run — use it to
  test another model without editing `video.json` or waiting for the config
  page.
- Generation takes a while (about 1-6 minutes depending on the provider and
  model); the command polls and prints `saved <path>` when done.
- On success embed that path in the final message:
  `![short description](/home/agent/workspace/koi.mp4)` — the chat embeds the
  video player.
- On failure it prints the provider's error on stderr — surface it verbatim.
- If it prints "no video provider configured", tell the user to set one up on
  the config page.

## Listing and testing models

```sh
gen-video models
gen-video models --probe
```

`models` prints the provider's known video models and flags the configured
one; it also warns when the configured model is an image model (video
generation then refuses to start). `--probe` sends a real minimal generation
request per model and prints per-model verdicts (`available`,
`unavailable (404)`, auth or network errors). A model that passes the probe
starts a real clip. When `gen-video` fails with a 404 and a `hint:` line, run
`gen-video models --probe`, pick a model that reports available, and retry
with `--model <name>`; when one works, persist it with
`ob-config set-model video <model>` so the choice survives a desktop restart.
If every documented model reports unavailable, say so — that is a provider
gap, not a local bug.

The configured model is validated before any request: an image model (for
example `grok-imagine-image-2.0`) is rejected with a clear message, and a
model that does not match the provider's video naming prints a warning.

## Providers and model formats

| Provider      | Model format             | Examples                                        |
|---------------|--------------------------|-------------------------------------------------|
| `xai`         | Grok Imagine video model | `grok-imagine-video-1.5`, `grok-imagine-video`, `grok-imagine-video-1.5-lite` |
| `xai-gateway` | xAI model via Cloudflare gateway `home-ai` | `grok-imagine-video-1.5` |
| `openai`      | Sora 2 model             | `sora-2`, `sora-2-pro`                          |
| `google`      | Veo model                | `veo-3.0-generate-001`, `veo-3.0-fast-generate-001`, `veo-2.0-generate-001` |
| `replicate`   | `owner/name`             | `google/veo-3-fast`, `minimax/video-01`, `wan-video/wan-2.2-t2v-fast` |
| `fal`         | `fal-ai/...` queue model | `fal-ai/veo3`, `fal-ai/kling-video/v2/master/text-to-video` |

The active provider and model come from the config page; do not invent model
IDs for a different provider than the one configured.

## Provider quirks

- `grok-imagine-video-*` runs 1-15 seconds, has audio by default, and
  `--seconds` maps to the API duration; text-to-video on `1.5` renders an
  intermediate first frame itself.
- `xai-gateway` routes the same xAI calls through the Cloudflare gateway
  (`OPEN_BOT_VIDEO_GATEWAY` overrides `home-ai`); the account slot holds the
  Cloudflare account ID.
- `sora-2` accepts `--seconds` (4, 8, or 12); vertical/horizontal size is
  chosen by the API default — do not send size flags.
- Veo models on Google take 1-6 minutes; `gen-video` polls the long-running
  operation automatically.
- `replicate` models vary widely in speed; `gen-video` waits up to ~10 minutes.
- `fal` runs through the queue API; `gen-video` polls the status url.

## Security

- Never print, copy, or edit `~/.config/open-bot/video-auth.json`.
- Credentials are installed by the control plane; there is no login command.
- If generation fails with an auth error, tell the user to update the key on
  the config page.
