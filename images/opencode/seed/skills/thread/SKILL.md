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
- `--steps unlimited` removes the agent step cap for this thread. Every turn
  stops after 256 steps and a cut turn cannot resume itself — use it for
  jobs you expect to run long (big builds, deep research, multi-phase work)
  and decide before starting, not after the cap hit.

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
ob-thread start --persona "Software manager" --from ses_YOURID --title "Add CSV export" --message "Implement CSV export in ~/project/report-app. Report back with the file paths."
```

- `--persona NAME` makes the new thread answer and work as that personality.
  The agents are a team; you are the coordinator.
- `--from SESSION_ID` (your own session id — the screen id in your system
  line) arms an automatic wake-up: when the teammate finishes its current
  work, this thread is re-prompted with a `[teammate]` message. It is not a
  user reply — read the results with `ob-thread read <id>` (or the files you
  asked for) and report to the user here. Without `--from` the control plane
  guesses the one busy chat; the start output shows `wake` so you can tell
  whether it armed.
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
- `--model PROVIDER/MODEL` and `--effort LEVEL` pick this one thread's model
  and reasoning effort (teammates and council members alike — each member
  can get a different pick). `ob-thread models` lists connected models and
  their levels; omit both for the desktop default. Follow-ups with
  `ob-thread post` keep the pick — and the pick can be hot-switched later
  (see "Changing a thread's model" below); never recreate a thread just to
  change its model.

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

Manage a thread you own while it runs — your hidden `worker:` threads and
persona teammates:

```sh
ob-thread read ses_abc123 4
ob-thread wait ses_abc123 --timeout 30
ob-thread stop ses_abc123
ob-thread post ses_abc123 "Stop editing; report what you changed so far"
ob-thread parent YOUR_SESSION_ID
ob-thread notify-parent YOUR_SESSION_ID "Contract ready: POST /api/export accepts {format}"
```

When you are yourself a delegated worker and must reach your coordinator
mid-task (an integration contract, a blocker), `parent` prints the
coordinating thread recorded for yours, and `notify-parent` sends it one
interim `[teammate update]` message without ending your turn. Pass your
own session id — the screen id in your system line.

- `read` prints the last N messages (default 6) of a thread you manage — the
  cheap way to see what a teammate or council member wrote before reporting.
- `wait` blocks until the thread finishes its current turn (state goes
  idle) or the timeout hits. A `stalled` state means the prompt was
  accepted but no turn ever started — `read` what is there, then re-`post`
  or replace the thread instead of waiting longer. It is the supported
  way to wait on a teammate or
  council member from inside your own turn. Cap `--timeout` at 110 minutes;
  the command is recognized by the stuck-command watchdog with a long
  budget. Never hold a raw `sleep` loop or any other command in one bash
  call past ~15 minutes — the watchdog kills it and wraps your turn up.
  For waits longer than the budget, end the turn instead (an idle session
  is never killed) and check the results on the next prompt.
- `stop` aborts the thread's current turn only — the thread and its history
  stay. Use it to pull the brake on a delegation that went sideways (wrong
  task, runaway edits) instead of letting it finish.
- `post` sends a follow-up prompt into the thread — a correction, missing
  context, or a wrap-up instruction.
- The server refuses all three for plain user chats and cron jobs; visible
  persona threads you started are manageable, other visible threads are not.

## Changing a thread's model

The model is picked per turn, so a live thread's model can be switched at
any time — the change applies from its next turn, a turn already running
finishes on its own model, and history/context are preserved:

```sh
ob-thread model ses_abc123
ob-thread model ses_abc123 --model openai/gpt-5 --effort high
ob-thread post ses_abc123 --model grok/grok-4.5 "Continue, and double-check the totals"
ob-thread model ses_abc123 --model default --effort default
```

- `ob-thread model ID` with no flags prints the thread's effective
  model/effort; the `thread` field shows which halves are pinned to this
  thread versus inherited from the desktop default.
- `ob-thread model ID --model … [--effort …]` changes only the pick — it
  takes effect on the next message anyone posts. The flags on `post`
  (before the text) switch and send in one call; the new pick persists for
  later turns either way.
- Each flag is independent: omit one to keep that half, pass `default` to
  clear that half back to the desktop default.
- Switch when the work changes shape: a teammate on a cheap fast model
  that gets stuck or reaches the hard part goes up to a deep reasoner
  mid-task; once the remaining work is mechanical, switch it back down.
- Switching to a model that does not offer the pinned effort drops the
  effort pin (the output reports `effortDropped`). An effort you pass
  explicitly that the model does not offer is refused with the available
  levels — then nothing is posted or stored, so fix the flag and rerun.

Tell the user the thread title you started and, for visible threads, that it
is now on the dashboard.
