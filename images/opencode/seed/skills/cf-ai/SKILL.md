---
name: cf-ai
description: Drive the cf-ai CLI to run one-shot AI prompts and image generation through Cloudflare AI Gateway or Workers AI. Use when the user asks to query an AI model from the terminal, generate an image with Workers AI, set up or debug cf-ai login/auth, manage named agent profiles, or pipe prompts (e.g. summarize a file, write a commit message, generate a PNG). Triggers - cf-ai, cloudflare ai, ai gateway, workers ai, one-shot prompt, flux image.
---

# cf-ai — Cloudflare AI CLI

`cf-ai` is a Bun CLI that sends **one-shot** prompts to **Cloudflare AI Gateway** or
**Workers AI** using named agent profiles. No daemon, no chat loop: run, print, exit 0
(non-zero on errors).

## Setup (once)

```sh
bun install && bun link     # installs the global `cf-ai` command
cf-ai login                 # browser OAuth — no token copy-paste
```

Auth is stored in `~/.config/cf-ai/auth.json` (chmod 600); the access token
auto-refreshes. For headless machines use `cf-ai login --device` (prints a URL +
code to approve from any browser). For CI paste a token: `cf-ai login --token ...`,
or skip storage entirely with `--env` plus `CF_AI_ACCOUNT_ID` / `CF_AI_TOKEN`.

## The two backends and model IDs

| Backend | Model ID format | Examples |
|---|---|---|
| `gateway` (default) | `{provider}/{model}` | `grok/grok-4.5`, `anthropic/claude-sonnet-4-5`, `workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| `workers-ai` | plain Workers AI name | `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `@cf/black-forest-labs/flux-2-klein-9b` |

**Never use `xai/...` as a provider prefix on AI Gateway — it returns Bad Gateway;
the correct prefix is `grok/`.**

Default gateway ID is `home-ai`; override at login with `--gateway <id>`.

## Core commands

```sh
cf-ai whoami                                   # show stored login (token masked)
cf-ai logout                                   # delete credentials (revokes OAuth token)

cf-ai agent add <name> --model <model> [--kind chat|image] [--backend gateway|workers-ai]
                   [--system <text>] [--temperature <0-2>] [--max-tokens <n>]
cf-ai agent list | get <name> | remove <name>

cf-ai ask <agent> "<prompt>" [--model <m>] [--system <s>] [--temperature <n>]
                 [--max-tokens <n>] [--json]      # chat; --json prints raw API response
cf-ai image "<prompt>" --model <model> [-o out.png] [--base64] [--json]
```

Image output modes (also on `ask` for `--kind image` agents): `-o file.png` saves the
PNG (default name `cf-ai-<timestamp>.png`), `--base64` prints raw base64 to stdout
(pipeable), `--json` dumps the API response.

## Agent workflows

Profiles make repeat calls terse. Create them before asking:

```sh
cf-ai agent add coder --model grok/grok-4.5 --system "Answer tersely with code." --temperature 0.2
cf-ai ask coder "explain this regex: ^(?=.*\d)(?=.*[a-z])" 
```

Useful one-shot patterns:

```sh
cf-ai ask coder "write a conventional commit message for: $(git diff --staged)"
cf-ai ask coder "summarize this log and list root causes" < deploy.log
cf-ai agent add art --kind image --model @cf/black-forest-labs/flux-2-klein-9b
cf-ai ask art "a neon koi swimming through clouds" -o koi.png
cf-ai image "wireframe of a server rack" --model @cf/black-forest-labs/flux-2-klein-9b --base64 | base64 -d > rack.png
```

Flags override profile settings per call (`--model`, `--system`, `--temperature`,
`--max-tokens`), so one agent can serve many models.

## Notes for agents

- Exit codes: 0 success, 1 on any error; provider errors are printed as
  `error: API error <status>: <message>` — surface them verbatim when reporting failures.
- `--json` gives the full OpenAI-shaped response (usage tokens live in `raw.usage`).
- Pipe stdin into the prompt with `< file` or `"$(cat file)"`; the prompt is plain text.
- Config lives in `~/.config/cf-ai/`: `auth.json` (credentials) and `agents.json`
  (profiles) — read `agents.json` to discover existing agents before creating new ones.
