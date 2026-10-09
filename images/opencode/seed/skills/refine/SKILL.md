---
name: refine
description: Save a finished procedure when the user corrects a deliverable, or when a missing finish step would cost another round. Use when the user follows up to fix, clean, restyle, or complete work you just delivered, and before repeating a job that previously took extra rounds.
---

# Refine

A refine skill is the whole finished job, including the correction the user should not have to send again. It is not a schedule. Do not use cron. Do not write the host OpenViking. Do not print the API key. The name `refine` is reserved.

## When

Load this skill when either is true:

- The user corrects a deliverable you just made (cleanup, format, edge, background, crop, wording, a missing step).
- You can see a finish step they would have to ask for next. Do that finish now. Do not deliver the obvious miss and wait.

A logo, icon, sticker, or "remove the background" is not done until the file is a PNG with a transparent background and no light halo. Use `gen-image --cutout`, or `defringe` on a file you already have, in this same turn. White inside the mark stays. Only the background connected to the edge comes off.

This is not a product report. Do not file it with `ob-improve`. A faster desktop or shell path still uses the `shortcut` skill.

## Save

Do the correction first. Then search this desktop before writing:

- `openviking_search` and `openviking_find` for the job
- `openviking_read` a close skill at `viking://user/skills/<name>/SKILL.md`

If one is close, replace it so the correction is in the steps. Otherwise create one. Do not stop to ask. One sentence in the final reply is enough. The user can edit or delete it on the Config page under Custom skills.

Name: kebab-case, at most 64 characters. Not `refine`, and not a built-in name (`desktop`, `cron`, `cf-ai`, `shortcut`, `persona`). The description is one line: when to load it, including the words the user would say.

Read `X-API-Key` from `~/.openviking/ovcli.conf`. Do not print it. Do not pass `wait`.

Create:

```sh
curl -sS -X POST http://viking:1933/api/v1/skills \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"data":{"name":"logo-cutout","description":"when to use it, one line","content":"# Logo cutout\n\nfinished steps, including the correction"}}'
```

Replace with PUT `http://viking:1933/api/v1/skills/<name>` and the same body.

Confirm with `openviking_read` on `viking://user/skills/<name>/SKILL.md`. If the request times out, the skill was usually written: read it before retrying, or you will create a duplicate.

Also `openviking_remember` one line: the name, the trigger, and that the steps live in that skill.

## Next time

Before the same kind of job, search skills and follow the match. Do not rediscover the correction.

## Do not

- Do not write a local SKILL.md.
- Do not use `openviking_write` on the skills tree.
- Do not store secrets.
- Do not save a one-off, a destructive step, or something that will not recur.
