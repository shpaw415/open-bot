---
name: skill
description: Create, update, rename, or delete the user's custom skills with ob-skill, and file them into dashboard skill groups. Use when the user asks to save, create, or organize a skill ("make a skill", "put it in a group"), or to list what exists. The refine skill remains the path for saving job corrections.
---

# Custom skills

Custom skills live in this desktop's OpenViking and show on the dashboard
Config page under Skills. `ob-skill` talks to the control plane and handles
everything — never curl OpenViking by hand for this, and never print the
token. Groups are the Skills-tab sections (`ob-group` edits the same store).

List what exists (custom skills, plus read-only `[seed]`/`[plugin:…]` rows):

```sh
ob-skill list
```

Read one skill (description + body):

```sh
ob-skill get logo-cutout
```

Create or replace a skill — same name means replace. The body comes from a
file (`-` reads stdin) or `--body`:

```sh
ob-skill save logo-cutout \
  --description "Cut a logo out of its background when the user asks" \
  --file skill.md
```

Create the skill AND its group in one call — `--group` creates the group
when missing and files the skill into it:

```sh
ob-skill save logo-cutout --description "…" --file skill.md --group "Image work"
```

Rename (group membership follows), delete (membership is dropped), and move
between groups:

```sh
ob-skill rename logo-cutout logo-cutout-v2
ob-skill delete logo-cutout
ob-skill group logo-cutout --label "Image work"
ob-skill group logo-cutout --none
```

Notes:
- Names are kebab-case slugs, 1-64 chars, never a built-in name
  (`desktop`, `cron`, `cf-ai`, `shortcut`, `refine`, `skill`).
- The description is one line: when to load the skill, including the words
  the user would say.
- `save` replaces by design — read the current body with `get` first when
  editing by hand.
- Saving a job correction after the user fixes a deliverable is the
  `refine` skill's workflow; it uses `ob-skill save` too.
- Never store secrets in a skill body. Do not write a local SKILL.md —
  custom skills live in OpenViking, not on disk.
