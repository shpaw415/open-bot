---
name: improve
description: File a product bug, repeated friction, or missing capability in open-bot when you observe it during real work. Use ob-improve. Do not use for user mistakes, secrets, one-offs, a faster path a shortcut can cover, or a finish the refine skill should save.
---

# Product reports

This skill exists only on development desktop images. If `ob-improve` is missing, stop. Do not invent a curl call.

File the whole improvement report — not only defects. Features and frictions are first-class kinds, not chat leftovers: anything you would write down as "this product should ..." at the end of a task belongs here.

What each `--kind` means:

- `bug` — broken behavior. Something failed, crashed, silently did nothing, or returned a wrong result.
  `ob-improve add --kind bug --surface desktop --title "ob-vnc key Return crashes" --detail "Expected: key sent. Actual: ord() crash. Repeat: ob-vnc --session S key Return."`
- `friction` — repeated waste or a missing path. It works, but costs steps every time, or there is no documented way to do a recurring thing.
  `ob-improve add --kind friction --surface other --title "No fallback chain for price research" --detail "Every price check burns steps guessing sources. Expected: a documented source ladder and per-status fetch guidance."`
- `feature` — a new capability the product should have.
  `ob-improve add --kind feature --surface nav --title "ob-nav should retry the goal url itself" --detail "Blocked runs make the agent call ob-nav a second time with the url. Expected: one invocation retries automatically."`

File when all of these are true:

- You observed a product defect, repeated friction, or a missing capability while doing real work.
- It is about this bot product (chat, desktop, nav, cron, persona, config), not the user's task content.
- A shortcut cannot cover it, and the refine skill cannot save it.
- It is not a secret, not a user mistake, and not a one-off.

Do not ask first. File, then one sentence in the final reply that it was filed. Before the final reply of a multi-step task, check the improvement proposals you described in chat: they must be filed here, not just described.

```sh
ob-improve add --kind bug --surface nav --title "ob-nav exits blocked with no url" --detail "What happened. What you expected. How to repeat it." --session SCREEN_ID
```

- `--kind` is `bug`, `friction`, or `feature` (all first-class).
- `--surface` is `chat`, `desktop`, `nav`, `cron`, `persona`, `config`, or `other`.
- `--session` is optional. Use this thread's screen id from the system line when you have one.
- Do not put tokens, passwords, or API keys in the title or detail.
