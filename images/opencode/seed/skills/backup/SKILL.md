---
name: backup
description: Back up or restore this desktop, or factory-reset it, with ob-backup and ob-reset. Use when the user asks to back up, save a copy, restore, or reset the desktop, or before any risky operation that could damage desktop data.
---

# Backup and restore

Use the `ob-backup` CLI. A backup saves this desktop's volumes (home with
workspace and browser logins, extra packages, this desktop's OpenViking data)
as archives in the control plane. The admin configures where they are kept
locally and in a cloud bucket, on the dashboard's Config → Backup tab.

Back up:

```sh
ob-backup create
ob-backup create --label "before migration"
ob-backup list
ob-backup show BACKUP_ID
```

Run a backup before anything risky: bulk file changes, account migrations,
package experiments, or when the user asks for a safety copy. Say the backup
id in your final message.

Restore this desktop from a backup:

```sh
ob-backup restore BACKUP_ID
```

A restore overwrites every volume of this desktop with the backup's contents.
It only runs after the user approves it in the open-bot dashboard by entering
their account password. Always ask the user in plain language first ("approve
the restore in the dashboard"), then run the command; it waits for the
decision. Once approved the desktop restarts and this session ends — say that
before you run it.

# Factory reset

```sh
ob-reset desktop
```

A factory reset destroys every container and volume of this desktop: chat
history, installed packages, browser logins, workspace files, and this
desktop's OpenViking memory. A backup is taken first by default. Use it only
when the user clearly asks for a full reset — "start fresh", "wipe this
desktop", "factory reset" — and restate what will be lost before you run it.
The command waits for the user to approve it in the dashboard with their
password. If they deny it or it expires, stop and do not retry without a new
explicit ask.

Reset is destructive and self-ending: once approved, the desktop is destroyed
and this session ends with it. Do not schedule it with cron, do not chain it
with other commands (`ob-reset desktop && ...` never completes), and never
loop or retry it.
