---
name: report
description: File bug, friction, or enhancement findings about a plugin you are building, stress-testing, or using from a local checkout, with ob-report. The reports live on this desktop so any thread here can pick them up and the dashboard can track the fix. Use ob-improve for open-bot product defects instead, and ob-plugin issue for public GitHub issues.
---

# Plugin reports

`ob-report` files findings about one plugin into a local queue on this desktop
(`~/.open-bot/reports/`). Every other session thread here can read them, and
the user sees them in the dashboard Reports view and can reference them from
any thread with `@reports/<plugin>`.

File when all of these are true:

- You found a bug, repeated friction, or a missing capability in a plugin you
  are developing, stress-testing, or exercising from a local checkout
  (`~/plugins-create/<slug>` or a local install).
- The finding needs work after this thread ends — a fix, a follow-up run, or a
  decision. Anything you would want "picked up later" belongs here.
- It is not a one-off you already resolved in this thread.

Do not use `ob-report` for defects in open-bot itself (`ob-improve` covers
those) or for issues users of the published plugin should see (`ob-plugin
issue` files those on GitHub — file both when a defect is public-worthy and
needs a fix here).

## Commands

```sh
ob-report add --plugin SLUG --kind bug|friction|feature --title "Short defect" --detail "Expected. Actual. How to repeat."
ob-report list [--plugin SLUG] [--status open|done|wontfix|all] [--kind KIND]
ob-report show ID
ob-report done ID [--note "what closed it"]
ob-report wontfix ID [--note "why"]
ob-report open ID [--note "reopened because"]
```

- `--plugin` is the plugin slug (the directory name under `~/plugins-create/`
  or the installed plugin id). One report per distinct defect; a matching open
  report gets a hit instead of a duplicate row.
- `--kind` matches `ob-improve`: `bug` (broken), `friction` (works but wastes
  steps every time), `feature` (missing capability).
- Keep titles short and stable — they drive dedupe.
- Never put tokens, passwords, or API keys in a report.

## Working the queue

- Before fixing or re-testing a plugin, check its open reports:
  `ob-report list --plugin SLUG --status open`.
- When a fix ships, close the reports you resolved with `ob-report done ID
  --note "..."` so the dashboard reflects reality.
- A report closed as `done` reopens as a new report if the same defect is
  observed again — that is the signal it was not actually fixed.
