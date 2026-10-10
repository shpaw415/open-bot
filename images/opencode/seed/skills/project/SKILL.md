---
name: project
description: Add, list, or remove a folder in the dashboard Projects list. Use ob-project when the user wants a desktop directory to show up as a project or be mentionable with @projects.
---

# Projects

A project is a folder on this desktop that shows in the dashboard Projects list and can be mentioned with `@projects/name`.

Use `ob-project`. It talks to the control plane. Do not print the token. Do not edit the database.

List:

```sh
ob-project list
```

Add an existing folder. `~` is this desktop's home (`/home/agent`):

```sh
ob-project add --path ~/project/user-project
ob-project add --path ~/plugins-create/my-plugin --name "My plugin"
```

Remove the list entry (files stay on disk). Use the id from list:

```sh
ob-project remove ID
```

Rules:

- The folder must already exist. This command does not create it.
- The path must be under `/home/agent`. Anywhere else is rejected.
- Tell the user it is in Projects and can be mentioned with `@projects/` plus the project name.
- Removing a project does not delete its files.
