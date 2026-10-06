---
name: cron
description: Schedule recurring or one-time tasks with ob-cron. Use when the user asks for reminders, periodic work, or scheduled jobs.
---

# Cron jobs

Use the `ob-cron` CLI to manage scheduled jobs. Jobs live in the control plane: they survive desktop restarts and wake the desktop when they fire. Each firing runs in a temporary session. The result is copied into the job's thread, then that temporary session is deleted. The job thread is reused until the user deletes it; the next run creates another and posts there.

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
- When a message starts with `[cron: name]`, do the work in that temporary session and end with what you did and found. Do not create another thread. The result is copied to the job thread, you are not asked to post it, and the temporary session is deleted. The user is notified when the result lands, and the notice clears once they open the thread.
- Do not use system crontab, `at`, or background loops for scheduling — only `ob-cron`.
