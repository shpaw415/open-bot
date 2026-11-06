---
name: persona
description: Create, update, or remove a lasting bot personality, or list the team roster of personalities and their skill and MCP scopes to find who can take a task. Use ob-persona. Do not use for a one-off tone in the current reply.
---

# Personalities

A personality is a name plus how to behave. The user picks one when starting a thread. It stays for that thread only. Built-ins (Assistant, Open-bot Plugin Creator) cannot be renamed, re-instructed, or deleted — but their scope extends: by default they load only the desktop's built-in (seed) skills and MCP servers, and the user can add more. The Assistant is the exception on skills: it loads every skill (seed, plugin, and custom) so it can run any plugin integration on its own; only its MCP servers stay seed-based.

The personalities are your team, and you are its coordinator. The roster doubles as a skills directory: `ob-persona list` shows each teammate's description plus `(skills: …)` and `(mcp: …)` when either is restricted — `--verbose` shows the full instruction text and the complete lists, e.g. before handing a teammate a task or editing one.

Use `ob-persona`. It talks to the control plane. Do not print the token. Do not write a local file, and do not edit `AGENTS.md`, to change your voice.

List (one short line per personality):

```sh
ob-persona list
ob-persona list --verbose
```

Add:

```sh
ob-persona add --name "Brand designer" --instruction "Speak as a brand designer. Prefer concrete visual choices. Keep replies short."
```

Update or remove a custom one (use the id from list). To add one rule, use
`--append` — it fetches the current instruction and adds to it, so approved
text is never resent or lost. Use `--instruction` only when rewriting wholesale:

```sh
ob-persona update ID --append "CLI de base uniquement."
ob-persona update ID --instruction "Shorter replies. Always give one option."
ob-persona remove ID
```

Skill scopes: restrict which skills load in threads running the personality.
`--skills "a,b,c"` replaces the editable list (`--skills-append NAME` or
`--skill NAME` adds one, repeatable; `--skills-remove NAME` drops one from the
editable list, repeatable, comma list ok; `--skills-clear` removes the
restriction). `--skills none` blocks every skill on any personality. MCP
server scopes work the same way on server names: `--mcp "a,b"` /
`--mcp-append NAME` / `--mcp-remove NAME` / `--mcp-clear`, and `--mcp none`
blocks every MCP server. On a plugin-owned or built-in personality the
editable lists are the extras — add and remove both work there — but the base
lists are locked (the plugin's declared set, or the desktop's built-in
skills/MCP servers for a built-in) and base names are refused, though `none`
still blocks everything. The Assistant takes no skill extras at all (it
already loads every skill; `--skills`/`--skills-append`/`--skills-remove`
refuse) — extend and narrow only its MCP servers. Restricting changes what
future threads load; the current thread is unchanged. Names are slugs —
never globs.

```sh
ob-persona add --name "Researcher" --instruction "Dig deep, cite sources." --skills "research,media"
ob-persona update ID --skills-append preview
ob-persona update ID --skills-remove media
ob-persona update ID --mcp "stock,files"
ob-persona update ID --mcp-remove stock
```

Rules:

- Use this when the user wants a lasting voice, not a one-off tone for this reply.
- Creating or editing a personality does not change the current thread.
- Tell the user to start a new thread and pick it.
- To hand a task to a personality right away, start a thread for it with
  `ob-thread start --persona "Name" --message "task"` — see the `thread` skill.
- The instruction is how to behave, not a secret and not a tool recipe.
- A skill scope curates what the personality is shown; it is not a security
  boundary. If a thread cannot use a skill, check whether its personality
  restricts skills (`ob-persona list`) before debugging the desktop.
