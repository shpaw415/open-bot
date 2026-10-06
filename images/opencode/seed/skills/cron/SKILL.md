---
name: cron
description: Schedule recurring or one-time tasks with ob-cron. Use when the user asks for reminders, periodic work, or scheduled jobs.
---

# Cron jobs

Use the `ob-cron` CLI to manage scheduled jobs. Jobs live in the control plane: they survive desktop restarts and wake the desktop when they fire. Each firing sends the job's message to you in a dedicated thread.

List jobs:

```sh
ob-cron list
```

Add a job (exactly one of `--every`, `--cron`, `--at`):

```sh
ob-cron add --name "daily-report" --message "Write today's report from the workspace notes" --cron "0 13 * * *"
ob-cron add --name "hourly-check" --message "Check the log and summarize changes" --every 3600
ob-cron add --name "one-shot" --message "Review the PR and leave notes" --at 2026-12-01T15:00:00Z
```

Remove or fire now:

```sh
ob-cron remove JOB_ID
ob-cron run JOB_ID
```

Rules:

- Cron expressions are 5-field UTC (`minute hour day-of-month month day-of-week`), so `0 13 * * 1-5` is weekdays at 13:00 UTC.
- `--every` is seconds, minimum 60.
- The message is the full prompt delivered at fire time; make it self-contained.
- Do not use system crontab, `at`, or background loops for scheduling — only `ob-cron`.
