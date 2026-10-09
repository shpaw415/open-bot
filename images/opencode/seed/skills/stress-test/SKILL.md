---
name: stress-test
description: Stress test a plugin you just built before calling it done. Use after ob-plugin install of your own new or updated plugin — run complex use cases from the user's seat, file defects, and iterate versions until every case passes. Not for plugins you only installed to use.
---

# Stress test your plugin

Publishing is a maintenance commitment: what you ship must work from the user's seat, not just in your head. This pass runs right after the build flow in the `plugin` skill: the plugin is validated, published, and installed, and you are still in the same thread.

## 1. Plan the cases first

Before touching anything, write 3-5 complex use cases a real user could ask for, and say them in one message so they can see the plan. Cover at least:

- the happy path end to end,
- a case with missing or default config (`ob-plugin settings <slug>` never called),
- hostile input: empty, very long, unicode, or nonsense arguments,
- a failure path: what the user sees when a dependency is down,
- a repeat run: doing it twice in a row must not corrupt state.

## 2. Test each surface from the user's seat

Test the installed payload, never your draft. For skills, read the installed copy and follow it literally:

```sh
openviking_read viking://user/skills/<skill-name>/SKILL.md
```

- Skills: follow the installed copy in this thread on each planned case, as if a fresh thread had asked.
- Cron: `ob-cron list` shows the jobs. Exercise a real fresh-thread run: `ob-cron add --name stress-<slug> --at "$(date -u -d '+2 minutes' +%Y-%m-%dT%H:%M:%SZ)" --message "<one case>"`, then `ob-cron run <id>`, read the result that lands in the job thread, and `ob-cron remove <id>` afterwards.
- Personas: this thread cannot switch. Run a one-shot cron job with `--persona <id>` and check the voice holds on a hard case.
- Tools: run the `ob-plugin-<id>-*` binaries yourself with real and edge-case arguments.
- Dashboard tabs and composer features: load the `desktop` skill and click through with `ob-nav`/`ob-page` like a user.
- Configs: set values with `ob-plugin settings <slug> key=value`, then verify behavior again with the value missing.

Anything broken — an error, a wrong result, confusing output, a step you had to fake — is a finding. Never paper over it by editing installed payloads by hand; that is forbidden and it hides the bug.

## 3. File what you find

- Defect in your plugin: file it on the plugin repo so users see it being handled, then fix it now. `ob-plugin issue <slug> "Title" "Expected: ... Actual: ... Repeat: ..."` — close it in the release notes of the version that fixes it.
- Friction or bug in open-bot itself that this test surfaced (install flow, `ob-plugin`/`ob-improve`/`ob-cron`, the apply engine): `ob-improve add --kind bug|friction|feature --surface other --title "..." --detail "..."`. This skill exists only on development desktop images; if `ob-improve` is missing, stop — do not invent a curl call.
- Never put tokens, passwords, or API keys in an issue or report.

## 4. Iterate until satisfactory

For each round, fix the code in `~/plugins-create/<slug>` and ship the new version:

```sh
cd ~/plugins-create/NAME
ob-plugin validate ~/plugins-create/NAME
git add -A && git commit -m "fix: what broke" && git push
gh release create v1.0.1 -R OWNER/NAME --notes "Fixes #1"
ob-plugin publish ~/plugins-create/NAME
ob-plugin install NAME
```

Then re-run the case that failed **and** the whole plan again (regression). Satisfactory means: every planned case passes end to end from the user's seat and nothing was worked around. Cap at 3 rounds; if cases still fail, stop and tell the user exactly what fails and what you suspect.

## 5. Report

One final message: cases passed and failed, issues filed and closed, versions published, improve reports filed. Remove any stress cron jobs you created. Leave the `plugin:<slug>:guard` cron alone.
