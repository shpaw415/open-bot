# Shape: the smallest plugin that covers the ask

Cost rises at every step: more manifest, more code, more tests, more runtime tokens. Stop at the first shape that fully covers the ask. Say which one you picked and why in one line before scaffolding.

## The ladder

1. **Skill-only.** The agent already has the tools; it needs instructions, a procedure, or domain text. One `skills[]` entry, no code. Cheapest to build — its whole runtime cost is the skill body, so keep the body lean (see below).
2. **Tools.** Deterministic work the agent should not re-derive each time: an API call, a parse, a calculation. `tools[]` scripts (or `files[]` payloads) the agent calls; one command per verb.
3. **Cron.** The work is time-based or a standing guard. Prefer `run: "script"` (no agent wake) or `run: "auto"` (wakes only when a `[cron-agent]` line appears). `run: "prompt"` (agent every fire) is the last resort; `hooks[]` are for reacting to `session.idle`/`thread.created`, never loops.
4. **Declarative cards** (`dashboard.tabs` `kind: "page"`). The user needs to *see* data: stats, tables, lists. One JSON route + `cards` — no HTML, no frontend code.
5. **App page** (`kind: "app"`). The user needs to *act*: forms, editing, live interaction. Only now write a server UI (`index.html` + `app.ts` + `styles.css`).
6. **MCP** (`opencode.mcp`). Only when a real MCP server exists to wrap, or the capability must appear as typed tools across threads. A CLI the agent shells out to is almost always cheaper to build and test.

Mixed plugins are common (tools + a card tab; a skill + a cron guard) — compose from the cheapest rungs instead of jumping to a higher one. `@mentions` (`dashboard.mentions`) only when users will reference live items in chat; `dashboard.pages.public` only when an external system must call in.

If the shape does not need a page server, delete the scaffold's `server/` folder, its `files[]` entries, and the `dashboard` section. A shipped-but-unused server still costs review tokens and can fail health probes.

## Runtime token rules (what the plugin costs after install)

The plugin you ship is paid for on every future use. Design for that:

- **Skills are loaded whole.** Write the body like a procedure the agent executes: short steps, exact commands, no background essays. Move reference detail into a tool's `--help` or the README — the agent reads those only when needed. Target under ~120 lines; if it grows past that, the overflow is probably deterministic work that belongs in a tool.
- **Tools print one compact JSON line** (`{ok: true, ...}` / `{error: "..."}`), never prose, never pretty-printed arrays. Truncate lists with a `truncated: true` flag instead of dumping thousands of rows into context.
- **Cron scripts filter before the agent sees anything.** The script decides "nothing to do" silently; only the interesting case emits `[cron-agent]`. A guard that wakes the agent to say "all clear" burns a full turn per fire. "Nothing new" includes *already-seen* items: keep a seen-state file and emit only new or changed lines (the canonical pattern is in `tools-cron.md`).
- **Loops live in scripts, not in agent steps.** If using the plugin means repeating the same move — paging an API to the end, scraping N pages, click-next-until-done navigation, extracting a table row by row, polling until ready — that loop runs *inside* one tool or script call that returns the finished result. The agent issues one call and reads one JSON line. A skill body that instructs the agent to repeat a step per item is a design bug: each repetition costs a model step and can hit the turn's step cap mid-job. Browser loops belong in the tool (it drives `ob-chrome`/`ob-page`/CDP primitives in one invocation); keep cron scripts to HTTP/API/CLI/file work — a cron script is plain bash in `~/workspace` with no thread screen of its own.
- **`opencode.agentsMd` is paid on every prompt** of every thread while installed. Use it only for one or two durable rules (max 4000 chars — stay far under), never procedures.
- **Mention `hint` fields and persona instructions** are prompt text too: one line each, telling the agent how to use the entry — not documentation.
- **Let built-in CLIs do work instead of prompts:** `ob-system1` for quick picks/vision/scoring, `ob-api-key <slug>` for a connected provider key (never print it), `ob-media`, `ob-report`. A plugin wrapping these is smaller than one re-implementing them.

## Dependencies

Default: **zero**. Bun built-ins (`Bun.serve`, `Bun.file`, `fetch`, `bun:sqlite`) cover servers, files, HTTP, and storage. Add a dependency only when you can name the concrete failure without it; say so when you add one. `setup.commands` are reserved for apt-level needs — idempotent, minimal, paired with `setup.uninstall` when destructive.
