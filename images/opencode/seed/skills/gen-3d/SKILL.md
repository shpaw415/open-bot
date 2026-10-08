---
name: gen-3d
description: Generate 3D models from text prompts with the gen-3d CLI. It reads the provider configured on the open-bot config page and dispatches Meshy AI, Tripo AI, Replicate, or fal.ai. Use whenever the user asks for a 3D model, a mesh, a figurine, a prop, or any text-to-3D render. Triggers - gen-3d, 3d, 3d model, mesh, glb, text-to-3d, meshy, tripo, figurine, statue, prop.
---

# gen-3d — open-bot 3D model generation

`gen-3d` reads the provider configured on the config page from
`~/.config/open-bot/model3d.json` (`{provider, model}`) and its credentials
from `~/.config/open-bot/model3d-auth.json` (mode 600). One command works for
every provider — never call provider APIs directly and never read the auth
file.

## Usage

```sh
gen-3d "a stylized ceramic owl figurine, smooth glaze" -o /home/agent/workspace/owl.glb
```

- `-o path` saves there; without it the file lands in `/home/agent/workspace`
  as `gen-3d-<timestamp>.glb`.
- Generation takes 1-6 minutes depending on the provider; the command polls
  and prints `saved <path>` when done.
- The output is a mesh file (`.glb` unless `-o` says otherwise). Embed it in
  the final message as `![short description](/home/agent/workspace/owl.glb)` —
  the chat renders an interactive 3D viewer (orbit, pan, zoom). The viewer
  shows shape and color, not print-readiness; the workspace file explorer
  still serves the raw file.
- On failure it prints the provider's error on stderr — surface it verbatim.
- If it prints "no 3d model provider configured — build the part with gpio-3d
  instead", fall back to the `gpio-3d` skill: design the part as a build
  recipe and write printable `.stl` + `.glb` files procedurally.

## Fallback to gpio-3d

When no 3D provider is configured, or the provider fails with an error the
user cannot fix right away (quota, auth, job failure), use the `gpio-3d`
skill instead: it builds watertight printable parts from recipe ops (boxes,
cylinders, revolves, text engraving) without any provider. Tell the user
which path you took in one sentence.

## Providers and model formats

| Provider   | Model format             | Examples                                   |
|------------|--------------------------|--------------------------------------------|
| `meshy`    | Meshy ai_model           | `meshy-5`, `meshy-4`                       |
| `tripo`    | provider default (model is ignored) | `latest`                        |
| `replicate`| `owner/name`             | `firtoz/trellis`                           |
| `fal`      | `fal-ai/...` queue model | `fal-ai/tripo/v2.5/text-to-3d`             |

The active provider and model come from the config page; do not invent model
IDs for a different provider than the one configured.

## Provider quirks

- `meshy` runs a preview job (fast, untextured-to-basic texture); results land
  as `.glb`. `meshy-5` is the current default model.
- `tripo` runs a text_to_model task; the model field is informational — the
  provider's current engine is used.
- `replicate` models vary in what they accept; `gen-3d` sends only `prompt`,
  waits up to ~10 minutes, and downloads the single output file.
- `fal` runs through the queue API; `gen-3d` polls the status url and accepts
  `model_mesh`, `model_urls.glb`, `mesh_url`, or `model_url` outputs.

## Security

- Never print, copy, or edit `~/.config/open-bot/model3d-auth.json`.
- Credentials are installed by the control plane; there is no login command.
- If generation fails with an auth error, tell the user to update the key on
  the config page.
