# Manifest: fill only what your shape uses

The scaffold writes `open-bot.plugin.json` for you; edit it in place. Unknown fields are rejected, so when a field is unsure, check in this order — each step is cheaper than the next:

1. The **scaffold README** in your plugin root has a one-line reference for every section. Read that section's line first.
2. Extract just the field from the schema:
   `jq '.properties.<section>' ~/.config/opencode/skills/plugin/open-bot.plugin.schema.json`
   Field `description`s in the schema carry the real contract (prefix stripping, caps, formats).
3. Only then grep the `plugin` skill for the section.

## Field discipline

- **`id` / `name` / `description`**: `id` is the permanent slug (matches the folder and repo name). The description is written for the person picking the plugin in search results — what it does, one sentence.
- **`version`**: semver (`1.0.0`) for stable, a short tag (`beta-1`) while iterating on the dev channel. The git release tag is `v<version>` and must match at publish time.
- **`skills[]`**: `{name, description, body, group?}`. `description` is the load trigger — write *when to load this*, because the agent picks skills by it. Keep `body` a lean procedure (see `shape.md`).
- **`tools[]`** vs **`files[]`**: small scripts inline in `tools[]` `{name, content, exec}` install straight into `/usr/local/bin`. Anything larger, or any file the page server needs, goes in `files[]` `{name, source, exec}` as a real repo file. Every file your server or frontend references must be declared — an undeclared file simply does not ship.
- **`configs[]`**: give every setting a `type` (`string` default, `bool`, `number`, `enum` + `options[]`, `secret`) so the dashboard renders a proper input and validates. A setting the plugin can default sensibly *must* have a default — the missing-config path is a test case, not an error state.
- **`permissions`**: request the minimum. `vaultCreate` for slugs the plugin owns (fill with `ob-plugin vault <id> SLUG=value`), `vaultRead` for the user's existing keys (only the user fills those). `notifications: true` only if something must reach the dashboard unprompted. Every permission shows in the install consent — each extra one costs trust and review scrutiny.
- **`personas[]`**: `{name, instruction, skills?, mcp?}`. Scope the persona to what it should use (`skills`/`mcp` allowlists) — a scoped persona is cheaper per thread than an unrestricted one. Keep the instruction one or two sentences; the persona's *procedure* belongs in a skill.
- **`textbox` / `opencode.agents` / `agentTools`**: reach for these only when the ask names them. New agent names cannot reuse built-ins. `agentsMd` is standing prompt text paid by every thread — see `shape.md`.
- **`dashboard`**: see `pages-theme.md`. If there is no dashboard, the whole section stays out.

## CONFIG.md

Whenever you declare `configs[]` or vault keys, replace the scaffold's placeholder CONFIG.md with the real walkthrough: what the plugin needs, each setting and what to ask the user, each vault slug and where the user gets the key, the ask → fill → verify order, and how to prove it works. `ob-plugin doctor` warns while the placeholder text is still there. Never write a real secret value or real personal data into it — it ships publicly and the security reviewer reads it.

## Validate early, once

Run `ob-plugin validate ~/plugins-create/<slug>` right after the manifest edit, before writing payloads (adjust `files[]` as files land). When it lists several issues, fix all of them in one edit pass, then re-run — never fix one, re-run, fix one.
