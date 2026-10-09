---
name: gen-image
description: Generate images from text prompts with the gen-image CLI. It reads the provider configured on the open-bot config page and dispatches Cloudflare Workers AI, xAI (direct or Cloudflare Gateway), OpenAI, Google Gemini/Imagen, Stability AI, or Replicate. Use whenever the user asks for a picture, an image, a logo, an illustration, a cutout, or any text-to-image render. Triggers - gen-image, image, picture, generate image, draw, render, logo, cutout, transparent background, flux, grok image, gpt-image, imagen, stable diffusion.
---

# gen-image — open-bot image generation

`gen-image` reads the provider configured on the config page from
`~/.config/open-bot/image.json` (`{provider, model}`) and its credentials from
`~/.config/open-bot/image-auth.json` (mode 600). One command works for every
provider — never call provider APIs directly and never read the auth files.

## Usage

```sh
gen-image "a neon koi swimming through clouds" -o /home/agent/workspace/koi.png
```

- `-o path` saves there; without it the file lands in `/home/agent/workspace`
  as `gen-image-<timestamp>.<ext>` with the correct extension.
- On success it prints `saved <path>`. Embed that path in the final message:
  `![short description](/home/agent/workspace/koi.png)`.
- On failure it prints the provider's error on stderr — surface it verbatim.
- If it prints "no image provider configured", tell the user to set one up on
  the config page.
- `--cutout` removes the edge-connected background and the light halo after
  save. The last `saved <path>` line is the PNG to embed.

## Logos and cutouts

A logo, icon, sticker, or "remove the background" is not done when the
generator returns. Pass `--cutout` in the same command. Do not wait to be
asked to remove the background or to clean the edge.

```sh
gen-image "a flat vector logo of a red fox, centered, plain background" --cutout -o /home/agent/workspace/logo.png
```

`--cutout` runs `defringe`. The file you embed is the PNG it prints, with a
transparent background and no light halo on the silhouette. White or solid
color inside the mark stays. Only background connected to the image edge is
removed.

To fix a file you already have:

```sh
defringe /home/agent/workspace/logo.png -o /home/agent/workspace/logo.png
```

If a custom skill for this job already exists, follow that skill.

## Providers and model formats

| Provider | Model format | Examples |
|---|---|---|
| `cloudflare-workers-ai` | Workers AI name (via `cf-ai`) | `@cf/black-forest-labs/flux-2-klein-9b` |
| `xai` | xAI image model | `grok-imagine-image` |
| `xai-gateway` | xAI model via Cloudflare gateway `home-ai` | `grok-imagine-image` |
| `openai` | OpenAI image model | `gpt-image-1`, `dall-e-3` |
| `google` | `imagen-*` or Gemini image model | `imagen-4.0-generate-001`, `gemini-2.5-flash-image` |
| `stability` | `core`, `ultra`, or `sd3.5-large` | `core` |
| `replicate` | `owner/name` | `black-forest-labs/flux-schnell` |

The active provider and model come from the config page; do not invent model
IDs for a different provider than the one configured.

## Provider quirks

- `grok-imagine-image` rejects `size`, `quality`, and `style` — do not
  describe them; put everything in the prompt text. (`grok-2-image-*` is
  deprecated and 404s — if the config still names it, switch with
  `ob-config set-model image grok-imagine-image`.)
- `gpt-image-1` always returns base64; `dall-e-*` may return a URL — both are
  handled.
- `gemini-2.5-flash-image` (nano-banana) goes through `generateContent`,
  `imagen-*` through `predict` — handled automatically by model name.
- `replicate` runs asynchronously; `gen-image` waits (up to ~90s) for the
  prediction to finish.
- Cloudflare `flux-2-klein-9b` returns JPEG; the default filename is `.jpg`.

## Security

- Never print, copy, or edit `~/.config/open-bot/image-auth.json` or
  `~/.config/cf-ai/auth.json`.
- Never run `cf-ai login`; credentials are installed by the control plane.
- If generation fails with an auth error, tell the user to update the key on
  the config page.
