---
name: shortcut
description: Save or reuse a faster path for a job, or a fragment of a job, that will happen again. Use before repeating a slow desktop or shell path, or right after finding a shorter one.
---

# Shortcuts

A shortcut is a named faster path in this desktop's OpenViking. It is not a schedule. Do not use cron for this. Do not write the host OpenViking. Do not print the API key.

## Before a slow path

Search this desktop before repeating a multi-step desktop or shell path:

- `openviking_search` and `openviking_find` for the task
- `openviking_read` any skill whose name starts with `shortcut-` (`viking://user/skills/<name>/SKILL.md`)

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

Read `X-API-Key` from `~/.openviking/ovcli.conf`. Do not print it.

Create:

```sh
curl -sS -X POST http://viking:1933/api/v1/skills \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"data":{"name":"shortcut-open-mail","description":"when to use it, one line","content":"# Open mail\n\nfast path\n\nReplaces: the slow path"}}'
```

Do not pass `wait`. The call returns fast with a `uri`, and the content is already written. Confirm with `openviking_read`. If the request times out, read the skill before retrying, or you will create a duplicate.

Replace an existing one with PUT `http://viking:1933/api/v1/skills/<name>` and the same body.

The description is the trigger: when to load it. The content is the fast path and what it replaces. No secrets.

Also `openviking_remember` one line: the name, the trigger, and that the steps live in that skill.

## Do not

- Do not write a local SKILL.md.
- Do not use `openviking_write` on the skills tree.
- Do not use crontab, shell aliases, or the host.
