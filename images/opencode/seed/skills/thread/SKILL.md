---
name: thread
description: Start a new thread with ob-thread. Use it when the user asks for a background job thread, a helper thread, or a new visible thread on the dashboard.
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

List the hidden threads created through this tool:

```sh
ob-thread list
```

Tell the user the thread title you started and, for visible threads, that it
is now on the dashboard.
