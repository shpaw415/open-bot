---
name: catalog
description: Organize the dashboard's skills and MCP servers into labeled directories (groups) with ob-group. Use when the user asks to group, file, or categorize skills/MCP servers by topic or type, or asks what directories exist.
---

# Skills/MCP directories

Directories are labeled groups for the dashboard's Skills tab and MCP tab.
They render as collapsible sections and let the user batch-allow a whole
directory in a persona allowlist. They are organization only: membership
never changes which skills or MCP servers actually load — a persona
allowlist still names plain skills/servers, and the picker just expands a
directory into names when the user picks it.

Use `ob-group`. It talks to the control plane. Do not print the token.

List what exists:

```sh
ob-group list --kind skill
ob-group list --kind mcp
```

Create, rename, delete:

```sh
ob-group add --kind skill --label Research
ob-group rename --kind skill ID --label "Deep research"
ob-group delete --kind skill ID
```

`delete` never removes the skills/servers themselves — members fall back to
Ungrouped. `delete` needs no `--kind` (the id is unique).

File items into a directory (batch works, names must be real skill names or
MCP server names — the same slug/name rules the persona allowlists use):

```sh
ob-group assign --kind skill ID research media
ob-group unassign --kind skill research
```

Notes:
- Plugin-contributed skills and MCP servers show under their own
  "From <plugin>" sections and cannot be user-filed. A plugin manifest can
  refine the label with `skills[].group`.
- An item lives in at most one directory per kind; assigning again moves it.
- Deleting a skill or MCP server drops its membership automatically, so
  directories never hold dangling names.
- Skill names must match `[a-z0-9][a-z0-9_-]*`; MCP server names allow
  letters, digits, dots, hyphens, underscores.
