# Stock Dashboard (example plugin)

Reference implementation of a **plugin dashboard page**: the workspace drawer's
Dashboards view lists this plugin's tabs and the user interacts with live data.

- `dashboard.pages.entry` → `server/server.js`, a Bun HTTP server the control
  plane starts on the desktop (env `OPEN_BOT_PAGE_PORT`, `OPEN_BOT_PAGE_TOKEN`,
  `OPEN_BOT_PLUGIN_ID`; config via `~/.config/open-bot/plugin-<id>.json`).
- `stock` tab (`kind: "app"`) — the server's own UI, proxied same-origin under
  `/api/pages/stock-dashboard/`; uses fetch + Server-Sent Events.
- `summary` tab (`kind: "page"` + `dataUrl` + `pollSeconds`) — declarative
  cards fed by `GET /api/summary` JSON, no plugin HTML involved.

## Try it

```sh
ob-plugin validate examples/stock-dashboard
ob-plugin install --path examples/stock-dashboard
```

Then open the workspace drawer → Dashboards. Add/remove items in the Stock tab
and watch the Summary tab update on its poll.
