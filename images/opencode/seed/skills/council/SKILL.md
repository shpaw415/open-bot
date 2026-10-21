---
name: council
description: Form an agent team (council) the user can watch live in the dashboard, with ob-thread --council. Use it when a job benefits from several members working in parallel — research plus review, a second opinion, divide-and-summarize — or when the user asks for a team, a council, or a panel. Members are hidden threads; the last one to finish wakes this thread automatically so you can read the results and report.
---

# Councils

A council is a named team of hidden threads. The user watches every member
live in a split pane beside the chat — member list, running dots, and each
member's transcript. `ob-thread` starts the members; the council marker in
your final reply opens the viewer.

Start a council (run one command per member, same name every time; pass
`--from` with your own session id — the screen id in your system line — so
the control plane knows to wake this thread):

```sh
ob-thread start --council auth-review --from ses_YOURID --role Researcher --title "OAuth paths" --message "Map every OAuth path in ~/project/api and write findings to workspace/auth-paths.md"
ob-thread start --council auth-review --from ses_YOURID --role Reviewer --title "Token storage" --message "Review how tokens are stored in ~/project/api and write findings to workspace/token-storage.md"
```

Then end your final reply with the marker (the slug must match):

```
![council: auth-review](open-bot://council/auth-review)
```

Rules:

- Members are always hidden `worker:` threads. Never combine `--council`
  with `--display` or `--dir` — the council viewer is their only dashboard
  surface.
- Use a short lowercase-kebab council name (`auth-review`); spaces and
  capitals are normalized away. Reusing a name adds the member to the same
  council.
- `--role TEXT` labels the member's job in the viewer ("Researcher",
  "Reviewer"). Keep it to a word or two.
- Give each member a self-contained `--message`: they cannot see this chat.
  Include the paths they need and where to write results.
- Two to five members is a good council; more rarely helps.
- Personas work on members too (`--persona "Software manager"`) when a job
  needs a specific voice.
- Subagents you spawn inside a member with the built-in task tool show up
  under "Subagents" in the viewer automatically, transcripts included.
  Plain `ob-thread start --hidden` helpers do not — use `--council` when
  the user should watch them.
- You do not need to poll. When the last member finishes, this thread is
  woken automatically with a `[council: name]` message — the start output
  shows `wake` ("armed"); passing `--from <your session id>` (the screen id
  in your system line) makes it reliable. A wake-up is not a user reply:
  read what the members produced — `ob-thread council status NAME` prints
  each member's state and last reply, `ob-thread read ID` a transcript, and
  files you asked them to write are on disk — decide, and answer the user
  here. The council is their workspace, not the conversation.
- To block until a single member finishes instead, use `ob-thread wait <id>`
  (ids from `ob-thread list`) — it is recognized by the stuck-command
  watchdog with a long budget (cap your `--timeout` at 110 minutes). Never
  hold a raw `sleep` loop or any other command in one bash call past ~15
  minutes: the watchdog kills it and wraps your turn up. For longer waits,
  end the turn — an idle session is never killed, and the wake-up brings you
  back when the team finishes.
- Close the team when the work is done: `ob-thread council close auth-review`
  deletes every member thread and the council. Do it in the same session
  that concludes the work, or a later one — `ob-thread councils` lists what
  is still open.

Example reply that opens the viewer:

> I started a three-member review council. They are working now — watch them
> in the pane, or ask me for a summary any time.
>
> ![council: auth-review](open-bot://council/auth-review)
