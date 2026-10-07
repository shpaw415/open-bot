---
name: improve
description: File a product bug, repeated friction, or missing capability in open-bot when you observe it during real work. Use ob-improve. Do not use for user mistakes, secrets, one-offs, or a faster path a shortcut can cover.
---

# Product reports

This skill exists only on development desktop images. If `ob-improve` is missing, stop. Do not invent a curl call.

File when all of these are true:

- You observed a product defect, repeated friction, or a missing capability while doing real work.
- It is about this bot product (chat, desktop, nav, cron, persona, config), not the user's task content.
- A shortcut cannot cover it.
- It is not a secret, not a user mistake, and not a one-off.

Do not ask first. File, then one sentence in the final reply that it was filed.

```sh
ob-improve add --kind bug --surface nav --title "ob-nav exits blocked with no url" --detail "What happened. What you expected. How to repeat it." --session SCREEN_ID
```

- `--kind` is `bug`, `friction`, or `feature`.
- `--surface` is `chat`, `desktop`, `nav`, `cron`, `persona`, `config`, or `other`.
- `--session` is optional. Use this thread's screen id from the system line when you have one.
- Do not put tokens, passwords, or API keys in the title or detail.
