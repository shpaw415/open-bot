---
name: thread
description: Start a new thread with ob-thread, hand a task to another personality as a teammate (team delegation), or delete hidden background threads when they are no longer needed. Use it when the user asks for a background job thread, a helper thread, a new visible thread on the dashboard, to give work to a persona like "the software manager", or to clean up old hidden threads.
---

# Threads

`ob-thread` starts a new conversation thread from inside this desktop. It talks
to the control plane. Do not print the token. Do not edit the database.

Start a thread:

```sh
ob-thread start --title "Nightly sync" --display
ob-thread start --title "Scrape prices" --message "Fetch prices from the site and save them to /home/agent/workspace/prices.json"
ob-thread start
```

Rules:

- Without `--display` the thread is hidden. It does not appear on the dashboard
  and the media vault skips it. Use hidden threads for background jobs and
  helpers that the user does not need to watch.
- `--display` makes the thread a normal visible thread on the dashboard.
- `--message TEXT` posts an initial prompt into the thread right after
  creating it, so the job starts immediately. Without it the thread is empty
  and idle until something posts to it.
- The command prints the new thread `id` — keep it when you plan to post
  follow-up messages to that thread later.
- Titles cannot start with `worker:` or `cron-run:`; those prefixes are
  reserved.

## Folders (topics)

The dashboard groups visible threads into folders. `--dir NAME` (or
`--topic NAME`) files the new thread into a folder, creating it when the name
is new. Run `ob-thread dirs` to list existing folder names and reuse one
instead of creating near-duplicates:

```sh
ob-thread dirs
ob-thread start --title "Invoice follow-up" --dir "Billing" --display
```

- Folders exist only on the dashboard, so `--dir` implies a visible thread and
  cannot be combined with `--hidden` (that is a usage error). Use `--topic` as
  an alias when it reads more naturally.
- When the user asks to separate or group threads by topic, ask for or infer a
  short folder label and pass it here — do not fake grouping with title
  prefixes.

## Team delegation

The personalities are a team, and delegation is not only for when the user names one. When a task falls outside your own skills, checking the roster is your first move: `ob-persona list` shows each teammate's description and skill scopes — delegate to the one that fits. When nobody fits, tell the user and offer the options: create the missing personality with `ob-persona add`, install a plugin (the `plugin` skill), or find another way together. When the user asks to give a task to a named personality ("have the software manager implement X in my project"), start a thread for it instead of doing the work yourself:

```sh
ob-thread start --persona "Software manager" --title "Add CSV export" --message "Implement CSV export in ~/project/report-app. Report back with the file paths."
```

- `--persona NAME` makes the new thread answer and work as that personality.
  The agents are a team; you are the coordinator.
- A persona with a skill scope limits which skills load in its thread —
  `ob-persona list` shows `(skills: …)` on restricted ones. If a delegated
  teammate says it cannot use a skill, that is the persona's scope, not a
  broken desktop. Note that subagents the teammate spawns inherit only the
  deny rules, so allowed skills are hidden inside their subagents.
- Persona threads are visible on the dashboard by default, so the user can
  follow along. Add `--hidden` for a background teammate nobody needs to watch.
- If you are not sure of the exact name, run `ob-persona list` first. The API
  tolerates typos: the output tells you which personality actually got the
  thread (`persona.matched: fuzzy`) — tell the user which one you picked.
- If the name does not match anything, the command fails with
  `did you mean` suggestions. Ask the user which one they meant, or offer to
  create it with `ob-persona add`. Do not silently pick a different
  personality or silently skip the delegation.
- Write `--message` as a complete standalone brief. The teammate does not see
  this conversation.

List the hidden threads created through this tool:

```sh
ob-thread list
```

Delete hidden threads that are no longer needed (by id from `list`, or all of
them at once):

```sh
ob-thread delete ses_abc123
ob-thread delete ses_abc123 ses_def456
ob-thread delete --all
```

- Delete only clears up your own hidden background threads. The server refuses
  anything else — visible dashboard threads and cron jobs come back as
  `skipped` with a reason. Never delete a hidden thread that may still be
  wanted: check with the user before bulk cleanup, and prefer `--all` only
  when they asked for exactly that.
- Deleting a thread removes its messages, persona binding, media, and screen.

Tell the user the thread title you started and, for visible threads, that it
is now on the dashboard.
