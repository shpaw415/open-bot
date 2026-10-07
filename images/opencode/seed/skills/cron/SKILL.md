---
name: cron
description: Schedule recurring or one-time tasks with ob-cron. Use when the user asks for reminders, periodic work, or scheduled jobs.
---

# Cron jobs

Use the `ob-cron` CLI to manage scheduled jobs. Jobs live in the control plane: they survive desktop restarts and wake the desktop when they fire. A prompt job runs in a temporary session. The result is stored in the Cron tab as a notification, then that temporary session is deleted; no job thread is created. A script job runs a shell command and stores its output the same way. A job with both runs the script first and adds that output to the prompt.

List jobs:

```sh
ob-cron list
```

Add a job (exactly one of `--every`, `--cron`, `--at`, and at least one of `--message` or `--script`):

```sh
ob-cron add --name "daily-report" --message "Write today's report from the workspace notes" --cron "0 13 * * *"
ob-cron add --name "hourly-check" --message "Check the log and summarize changes" --every 3600 --model grok/grok-4.5 --persona designer
ob-cron add --name "disk" --script "df -h" --every 3600
ob-cron add --name "digest" --script "git -C /home/agent/workspace log -1 --oneline" --message "Summarize this and say if anything needs attention" --cron "0 13 * * *"
ob-cron add --name "one-shot" --message "Review the PR and leave notes" --at 2026-12-01T15:00:00Z
```

How a job runs:

- `--message` alone is a prompt. The agent runs it in a temporary session.
- `--script` alone runs that shell command as you in `/home/agent/workspace`. Stdout and stderr are stored as the job's result. No agent runs.
- Both flags run the script first, add its output and exit code to the prompt, then the agent runs. Only the agent's result is stored.
- A script can be a command or a file path, such as `bash /home/agent/workspace/check.sh`.

Optional run choice:

- `--model PROVIDER/MODEL` selects the model for the temporary session. Omit it to use the desktop default. List connected models with `ob-cron models`. Ignored for script-only jobs.
- `--persona ID` selects the personality that runs the job. Omit it, or pass `assistant`, for Assistant. List ids with `ob-persona list`. Ignored for script-only jobs.

Change a job later. `--script` does not change the mode by itself; pass `--run`.

```sh
ob-cron set JOB_ID --model grok/grok-4.5 --persona designer
ob-cron set JOB_ID --run script --script "df -h"
ob-cron set JOB_ID --run both --script "df -h" --message "Say if the disk is nearly full"
ob-cron set JOB_ID --clear-model --clear-persona
ob-cron set JOB_ID --clear-script --run prompt
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
- The script runs on the desktop, not on the host. Keep it under a couple of minutes. Output stored as the result is capped.
- The chosen model and personality apply only to the temporary run.
- When a message starts with `[cron: name]`, do the work in that temporary session and end with what you did and found. Do not create another thread. The result is stored in the Cron tab, you are not asked to post it, and the temporary session is deleted. The user is notified when the result lands, and the notice clears once they view the result.
- Do not use system crontab, `at`, or background loops for scheduling — only `ob-cron`.
