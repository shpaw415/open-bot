---
name: shortcut
description: Save or reuse a faster path for a job, or a fragment of a job, that will happen again. Use before repeating a slow desktop or shell path, or right after finding a shorter one.
---

# Shortcuts

A shortcut is a named faster path in this desktop's OpenViking. It is not a schedule. Do not use cron for this. Do not write the host OpenViking. Do not print the API key.

## Before a slow path

Search this desktop before repeating a multi-step desktop or shell path:

- `openviking_find` first with a small limit (5) and no inline content; `openviking_grep` when you know an exact identifier. A high semantic score with none of your exact task identifiers in it is not a match — only follow hits whose name or text contains them, and treat "no exact match" as a valid answer
- `openviking_read` any skill whose name starts with `shortcut-` (`viking://~/skills/<name>/SKILL.md`)

If one matches, follow it.

## When to save

Save only when all of these are true:

- The fast path is clearly shorter than rediscovering the steps.
- The whole job will happen again, or a fragment applies to other jobs.
- It is not a one-off, not a secret, and not destructive.
- No existing shortcut already covers it. If one is close, replace that skill.

Do not stop the task to ask. Save alongside the work. In the final reply, one sentence that it was saved is enough. The user can edit or delete it on the Config page under Custom skills.

## How to save

Name: `shortcut-<verb>`, at most 64 characters. Do not use the name `shortcut`.

Save with `ob-skill` — never curl OpenViking by hand, and never read or
print the API key. Create or replace (same name means replace):

```sh
ob-skill save shortcut-open-mail \
  --description "when to use it, one line" \
  --body "# Open mail

fast path

Replaces: the slow path"
```

When replacing, read the current body with `ob-skill get <name>` first and
preserve everything still true. Confirm with `ob-skill get <name>` after
saving. If `save` reports the write is durable but still indexing, do not
retry the save — a get may briefly miss while indexing settles. If a save
times out, read back with `ob-skill get` before any retry, or you may
duplicate or clobber a write that already landed.

The description is the trigger: when to load it. The content is the fast path and what it replaces. No secrets.

Also `openviking_remember` one line: the name, the trigger, and that the steps live in that skill.

## Do not

- Do not write a local SKILL.md.
- Do not use `openviking_write` on the skills tree.
- Do not use crontab, shell aliases, or the host.
