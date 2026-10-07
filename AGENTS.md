# open-bot

Self-hosted conversational bot. The in-container agent is not a coding agent.

## Product reports

Do not list or process product reports unless the user asks. When they ask, list them:

```sh
bun scripts/reports.ts
bun scripts/reports.ts --filters status=open,kind=bug,surface=nav
```

The queue lives in the control-plane sqlite. Desktops file into it only after `bun run update -- --dev`. A later update without `--dev` stops filing. Review still works.

When asked to process the queue, patch clear bugs and broken friction. Leave features and ambiguous items open until asked. Mark each shipped or rejected row:

```sh
bun scripts/reports.ts done ID --note "what changed"
bun scripts/reports.ts wontfix ID --note "why"
```
