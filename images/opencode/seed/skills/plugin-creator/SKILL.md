---
name: plugin-creator
description: Lean build playbook for creating an open-bot plugin — smallest shape first, token-cheap by construction, tested before it ships. Use when building, extending, or publishing a plugin from a local checkout. For marketplace maintenance, installs, and the guard cron, use the plugin skill.
---

# Plugin creator

You build plugins the token-cheap way: reuse first, pick the smallest shape, write once, test cheapest first. This skill is the index — the conventions live in one card per surface, in this skill's folder. Read only the cards for the shape you picked; never load the full manifest schema or the `plugin` skill's reference sections "just in case".

| Step | Card |
| --- | --- |
| 1. Search the marketplace; if nothing fits, choose the smallest shape | `shape.md` |
| 2. Scaffold and fill the manifest | `manifest.md` |
| Building tools, cron, hooks, MCP, vault/config | `tools-cron.md` |
| Building a dashboard page or cards | `pages-theme.md` |
| 3. Test (mandatory before publish) | `testing.md` |
| 4. Install locally, then publish | `publish.md` |

Card paths are relative to this file: `~/.config/opencode/skills/plugin-creator/<card>`. Read the card with the read tool when you reach its step.

## The loop

1. **Search first.** `ob-plugin search <keywords>` (+ `ob-plugin info <id>` on candidates). A maintained plugin that fits beats anything you build. Install it and stop.
2. **Pick the shape** (`shape.md`): skill-only → tools → cron script/auto → declarative cards → app page → MCP. Each step right costs more tokens to build, test, and run. State the shape and why in one line before writing code.
3. **Scaffold.** `ob-plugin new <slug>` creates `~/plugins-create/<slug>/` app-shaped (skill + page server + `smoke.test.ts` + README + CONFIG.md) and registers the project. **Strip what your shape does not use** — delete `server/`, the `files[]` entries, and the `dashboard` section when you are not building a page. Then edit the scaffold in place; never rewrite its boilerplate from memory.
4. **Implement** following the one card for your surface. TypeScript for Bun only, no dependencies unless you can name what breaks without one.
5. **Test cheapest first** (`testing.md`): `bun test` → run tools / curl APIs → `ob-plugin validate` → install locally → stress-test the installed payload via the `stress-test` skill. Browser only for UI. Do not tell the user it works before this passes.
6. **Publish** (`publish.md`): dev tag while iterating (`ob-plugin publish DIR --dev`), semver when the stress test passes. The guard cron it creates is your maintenance duty.

## Token rules (always apply)

- **Read narrowly.** For an unsure manifest field, extract just that field from the schema:
  `jq '.properties.dashboard' ~/.config/opencode/skills/plugin/open-bot.plugin.schema.json` — never print the whole 26 KB file. The scaffold README's quick reference covers most fields; check it before the schema.
- **Write once.** Never re-read a file you just wrote or edited to "check" it. Batch independent file writes in one block. Fix validate errors in one pass by reading the full error list, not one error per run.
- **Do deterministic work in code, not prompts.** Whatever a script can compute, the script computes — the agent never re-derives it at runtime (see runtime token rules in `shape.md`).
- **Keep the repo small.** One file per concern; split only past ~300 lines. Every line ships in the review payload.
- **Replies are terse:** what changed, what passed, what is next. No narrating each file.

## Hard rules

- Plugin projects live in `~/plugins-create/<slug>/`. Never scatter files elsewhere, never edit installed payloads (`/usr/local/bin/ob-plugin-*`, `~/.config/open-bot/plugin-<id>.json`, installed skills/cron) by hand — edit the checkout and reinstall.
- Never put secrets or the user's personal information in any plugin file — the folder becomes public and the marketplace privacy review rejects leaks. Placeholders only; load the `plugin-privacy` skill before publishing. Settings and vault keys personalize at runtime.
- Never restart the OpenCode daemon to activate anything (it kills your own session) — installs hot-connect MCP and restart page servers for you.
- Helper sessions your plugin spawns are titled `worker:` so they stay out of the dashboard thread list.

The `plugin` skill remains the full reference (every manifest section, the dev loop, marketplace ops, the guard-cron maintenance pass). Fall back to it when a card does not cover your case — grep it for the section instead of loading it whole.
