---
name: processes
description: Start, watch, and stop background processes with ob-process so the dashboard can monitor and stop them. Use for servers, watchers, tunnels, long builds, or any job meant to outlive one bash call; plain foreground commands stay in bash. Triggers - background process, keep it running, dev server, daemon, long job, "ob-process".
---

`ob-process` starts background jobs on this desktop and registers them so the
dashboard Processus view (and any thread here) can watch them — CPU, RAM,
uptime — and stop them.

## Commands

```sh
ob-process start --name webapp -- npm run dev
ob-process start --name watch --session SESSION -- make watch
ob-process list
ob-process list --json
ob-process log p-1a2b3c4d --tail 100
ob-process kill p-1a2b3c4d
```

## Rules

- Anything meant to outlive the current bash call (dev servers, watchers,
  crawlers, converters, tunnels) goes through `ob-process start` — never
  `cmd &` or `nohup`. A job started outside ob-process is invisible to the
  user and to every other thread on this desktop.
- `--name` is a short slug (letters, digits, dot, dash, underscore; defaults
  to the command name). `--session` (the screen id in your system line) is
  optional attribution shown on the dashboard.
- The command's output is captured to a log. Read it with
  `ob-process log ID --tail N` while the job runs and after it dies — the
  log survives the process.
- `ob-process list` drops jobs that already exited and prints the live ones
  with CPU, memory, and uptime (`--json` for a machine-readable line).
- `kill` stops the whole process group (TERM first, KILL after 5 s). Only
  ids from `ob-process list` are accepted — never guess or kill pids you did
  not start.
- Screen and agent infrastructure (opencode, Xvfb, x11vnc, websockify, ttyd)
  is refused — those are not managed processes.
- Foreground commands that finish inside one bash call stay plain bash; do
  not wrap them.
