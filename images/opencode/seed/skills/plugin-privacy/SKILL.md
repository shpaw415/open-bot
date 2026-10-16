---
name: plugin-privacy
description: Keep personal information out of plugin source when creating or updating an open-bot plugin. Use before writing any manifest field, skill body, persona, cron text, tool, README, or CONFIG.md for a plugin — and again before publishing. Not for runtime storage of user data, which is by design.
---

# Plugin privacy: no personal information in plugin source

Publishing a plugin makes every file public: the GitHub repository, the release tarball, and the marketplace listing are world-readable forever. Anything about the current user that you hard-code into plugin files becomes public data tied to them. The marketplace runs an AI privacy review on every publish and rejects (concern) any version that ships real personal information — a rejection costs you a version bump, a republish, and the user's time, so get it right before the first publish.

## Never hard-code these in any plugin file

Manifest fields (description, skills[].body, personas[].instruction, cron message/script, tools[].content, files[] payloads, configs), README, CONFIG.md, examples, help text, and test fixtures must not contain the real user's:

- name — not their first name, not their full name ("confirm with Justin", "the desktop of Justin" are leaks),
- contacts — email, phone, chat handles,
- address — civic numbers, streets, postal codes,
- government identifiers — SIN/NAS, RAMQ, driver's licence, passport,
- business identity — their company name, NEQ, GST/QST numbers, presented as "the user's business",
- payment cards, bank details, or credentials,
- private-life facts — birth dates, their real calendar entries, family details, home routines.

The same rule applies to data you pulled from memory, other plugins (e.g. a profile plugin), or earlier conversation: never paste it into plugin source.

## What to do instead

- Placeholders in examples: `Alex`, `Jane Doe`, `Acme Corp`, `user@example.com`, `<city>`, `<your-business>`. Help text and docs read the same with generic examples.
- Personalize through configuration: a `configs[]` setting, a vault slug (`permissions.vaultCreate`), or a runtime file under `~/.open-bot/pages-data/<plugin-id>/` the user fills on their own desktop. The plugin reads the value at runtime; nothing real ships in source.
- Compose with other plugins at runtime: if the desktop has a profile plugin, read its tool output when the feature runs — do not copy its values into your files.
- Test fixtures: seed data uses `example.com`, fictional companies, and invented people. Never a copy of real data "just to test".

## Plugins that exist to store PII

A plugin whose purpose is holding the user's personal information (profile vaults, tax preparers, document wallets) is desktop-local by nature: install it with `ob-plugin install --path ~/plugins-create/<slug>`. Do not publish it while any real value or real identity is present in its source — and treat publishing one as a last resort the user must explicitly ask for, since even a clean source ships the user's data model publicly.

## Before you publish

1. Re-read your diff for the list above — skills, cron text, personas, help text, and CONFIG.md are where leaks hide (they are written last, in the user's voice).
2. Run `ob-plugin doctor ~/plugins-create/<slug>` and fix every privacy warning.
3. If the plugin passed, say what you checked; if you are unsure whether something is personal information, replace it with a placeholder — no real value ever needs to ship.
