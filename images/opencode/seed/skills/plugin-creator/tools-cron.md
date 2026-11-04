# Tools, cron, hooks, MCP, vault

## Tools

- TypeScript with a `#!/usr/bin/env bun` shebang; Bun runs `.ts` natively on the desktop. Plain JS or shell only when a non-Bun runtime forces it.
- One verb per invocation (`<tool> list`, `<tool> add ...`) with `--help` printing usage in one screen — the help text *is* the agent-facing doc, so the skill body does not repeat it.
- Output: exactly one compact JSON line on stdout (`{ok: true, ...}` on success, `{error: "what and why"}` on failure, exit 1). Diagnostics and progress go to stderr. The agent parses stdout; prose there costs re-asks.
- **The tool owns its loops.** Paging, retries with backoff, multi-page extraction, click-next navigation, poll-until-ready: all of it runs inside the tool, bounded (page caps, deadlines), and the agent gets the final result in one call. Never ship a tool that only fetches "one page/item" and expects the agent to call it N times — that spends N agent steps on a `for` loop. If the full result can be large, the tool writes it to a file and prints `{ok: true, file, count}`.
- Validate inputs up front and fail loudly with the fix in the error string ("unknown id X — run `<tool> list`"). Never silently coerce.
- Read settings and vault values fresh from `~/.config/open-bot/plugin-<id>.json` on each run (`vault.<slug>` = `{apiKey, accountId, baseUrl}`) — the control plane regenerates it (key rotations arrive on their own), so never edit it and never cache secrets across runs.
- **Companion plugins are optional.** Calling another plugin's CLI (`ob-plugin-<other>-*`) must degrade: check availability first (`command -v` / `Bun.which`) and skip or fall back. `Bun.spawnSync` **throws ENOENT** on a missing binary instead of returning an exit code — an unguarded call crashes your tool. Test with the companion absent.
- Prefer the desktop's built-in `ob-*` CLIs (`ob-media`, `ob-report`, `ob-system1`, `ob-api-key`) over bundling equivalent code or keys; handle their error JSON gracefully and never print tokens.

## Cron: script over prompt, always

A prompt job pays a full agent turn on every fire — tokens *and* steps, including every "nothing happened" run. The script does the checking, looping, and extracting (curl/jq/CLIs); the agent is woken only for judgment. Declare `{name, message, everySeconds}` or `{name, message, cronExpr}` (5-field, **UTC**). Job names are stable identifiers — keep them short and prefixed by purpose.

- Pick the cheapest `run` mode, in this preference order:
  - `run: "script"` — the script (max 16k chars) runs and its output posts to the job thread; the agent never wakes. Default for collectors, extractors, and checks with a mechanical outcome.
  - `run: "auto"` — like script, but a line starting with `[cron-agent]` wakes the agent with the output. Default for guards: the script filters and dedupes, the agent only sees the interesting case.
  - `run: "both"` — script output + `message`, agent always wakes. Only when interpretation is genuinely needed every fire (e.g. summarizing fresh content the script gathered).
  - `run: "prompt"` (no script) — the message *is* the job. Last resort: use it only when no part of the job can be decided mechanically. Before choosing it, name what the script could not check — if you cannot, write the script. The message is paid per fire, so keep it tight.
- **The silent-guard pattern** (this is how the marketplace `plugin:<id>:guard` job itself works — copy it): the script fetches the current items, diffs them against a seen-state file under `~/.open-bot/` (one line per item, including an `updatedAt`/head-sha so *changed* items re-fire), and:
  - prints **nothing at all** when there is nothing new or changed — `auto` then never wakes the agent and nothing posts to the thread;
  - prints `[cron-agent]` plus only the new/changed items otherwise;
  - updates the seen file only after every fetch succeeded — a failed check exits non-zero *before* the state advances, so items are not swallowed by an outage (the failure itself surfaces as the job's error notice, never as an agent wake).
- Scripts must be idempotent and safe to re-run back-to-back; a double fire must not corrupt state. A cron script runs as plain bash in `~/workspace` with no thread screen — keep it to HTTP/API/CLI/file work; page navigation loops belong in tools (above), and an `auto` wake hands the agent a screen when it truly needs one.

## Hooks

`hooks[]` (max 8; 20 runs/day/plugin) run a short prompt in a hidden `worker:` thread on `session.idle` or `thread.created`. For reactive automation only — worker threads never re-trigger hooks, so loops are impossible by design. The `message` is a full cold instruction; keep it short.

## MCP

`opencode.mcp` maps server names to `{type: "local", command: [...]}` or `{type: "remote", url}` (optional `environment`/`headers`/`enabled`). Install merges the config **and hot-connects** into the running daemon — `connected` in the install output means the `<server>_*` tools work in new threads immediately. Local servers inherit the agent PATH unless the entry sets `environment.PATH`. Never restart OpenCode to activate MCP.

Only ship MCP when a real server is being wrapped — for your own logic, a CLI tool is cheaper (see `shape.md`). Block MCP per persona with the persona's `mcp` allowlist when a plugin's persona should not see every server.

## Vault and settings lifecycle

- Fill `vaultCreate` slugs yourself with `ob-plugin vault <id> SLUG=value` (write-only, survives disable/reinstall). `vaultRead` slugs belong to the user: shared provider slugs live on the Config Keys tab, plugin slugs under Plugins → Settings → Vault keys. Point the user there; never ask for a key value in chat.
- The behavior with a key *unset* is a designed state: the tool prints one error line naming the slug and where to set it, and the skill tells the agent to offer the CONFIG.md walkthrough. Test this path (see `testing.md`).
