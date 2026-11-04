# Dashboard pages and theme

Read this before writing any `dashboard` section. If the user only needs to *see* data, stop at cards — an app page is the most expensive shape to build and test.

## Pick the tab kind

- `kind: "page"` + `dataUrl` + `pollSeconds` — the dashboard polls your JSON route and renders declarative `cards` (stat / table / list / markdown, `$.path` bindings). No HTML at all. Consecutive stats lay out in responsive columns; `span: 1-4` widens a card; `emptyText` shows (muted) when data resolves empty. **This is the default.**
- `kind: "app"` — your own UI in a sandboxed iframe; optional `path` is the route on *your* server to open (default `/`). Only for acting: forms, editing, live updates.
- `kind: "iframe"` + `url` (https) — embeds an external site; your server is not involved.

## Page server rules

`dashboard.pages: {entry, ui}` — `entry` is a `files[]` name (a Bun TypeScript server), `ui` the `files[]` **source** of the frontend entry (`server/index.html`). The scaffold's `server.ts` already does the required plumbing; keep it and add routes:

- Listen on `OPEN_BOT_PAGE_PORT`, bind all interfaces — **never set `hostname`** in `Bun.serve`. A loopback pin leaves the process alive while every control-plane health probe fails and the dashboard reports it dead.
- Implement `GET /healthz` (any response counts as healthy) and require `x-open-bot-page-token` on everything else — the scaffold's `authorized()` is the sanctioned pattern (open only when the env token is unset or `dev-preview`; never accept a fixed literal as a credential while a real token is set). Owner-only routes additionally require `x-open-bot-owner-token` (`ownerAuthorized()`): only dashboard requests carry it — the public `/hooks` surface never does, though it does get the page token. With `dashboard.pages.public`, list the public paths in `dashboard.pages.publicRoutes` (exact paths or trailing-`/*` prefixes) so the proxy refuses everything else publicly.
- Serve the UI through the scaffold's branch: frozen installs read `OPEN_BOT_PAGE_UI` (the control plane bundles `index.html` + `app.ts` + `styles.css` into one file at install, 8 MB cap); local checkouts import `./index.html` live. The branch must be decided before `Bun.serve` — the HTML import only works as a static `routes` value.
- The server starts lazily on first request and stops after ~5 quiet minutes: keep startup fast, hold no essential in-memory state. Persist under `/home/agent/.open-bot/pages-data/<pluginId>/`.
- Settings/vault arrive in `~/.config/open-bot/plugin-<id>.json` — read it fresh; persist changes via `ob-plugin vault`, never by editing the file.

## Path contract (get this wrong and everything 404s)

- The dashboard proxies `/api/pages/<pluginId><path>` and **strips the prefix**: your server sees bare `<path>`. Write plain routes (`/`, `/api/summary`) and never repeat `/api/pages/...` in manifest paths, server routes, or redirects. `tabs[].path`/`dataUrl` are routes on your server.
- **Fetch with relative paths only** (`fetch("api/items")`). A leading `/` escapes the proxy. JavaScript is never rewritten; only HTML/CSS asset URLs get the prefix injected.
- `cookie`, `authorization`, and `host` headers are stripped before your server sees a request; `x-open-bot-page-token` is injected. The page token is the only credential.

## Theme (the convention)

Pages follow the dashboard, which follows the OS. No theme toggle, no persisted theme choice, no single hardcoded palette. Start from these variables and extend only what you use:

```css
/* Light is the default; dark is an override. Every color goes through a
   variable — a raw hex outside :root is a bug. */
:root {
  --bg: #eef0f4;
  --surface: #ffffff;
  --text: #171a20;
  --muted: #5b6472;
  --border: #d8dde6;
  --accent: #2563eb;
  --accent-text: #ffffff;
  --danger: #b42318;
  --radius: 8px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e1014;
    --surface: #171b21;
    --text: #f3f4f6;
    --muted: #9aa4b2;
    --border: #2a2f38;
    --accent: #4a6cf7;
    --danger: #f97066;
  }
}
body {
  font-family: system-ui, sans-serif;
  margin: 0;
  padding: 24px;
  background: var(--bg);
  color: var(--text);
}
```

`system-ui` only (no webfonts — they bloat the 8 MB bundle and break offline), muted text via `--muted`, one accent per view, controls `border: 1px solid var(--border)` on `var(--surface)`. Verify **both** schemes before shipping: `ob-chrome` click-testing under each `prefers-color-scheme` (see `testing.md`).

## Frame rules (the sandbox decides these, not you)

- The frame is an opaque origin: `localStorage`/`sessionStorage` throw on touch — guard every read in try/catch and never rely on storage persisting. An unguarded top-level read kills the whole script, every `fetch` with it.
- `window.confirm`/`prompt`/`alert` return `false`/`null` **silently** — a confirm-gated delete just does nothing. Build in-page dialogs (inline form or small overlay).
- Microphone/camera/screen (`navigator.mediaDevices`), `geolocation`, MIDI, and `clipboard.writeText` go through the dashboard consent bridge: call the standard APIs, feature-check first, and always render a fallback notice on rejection. `enumerateDevices` returns `[]` and clipboard *reads* are unavailable in same-host frames — never assume them.
- **Language follows the dashboard** — never ship your own selector. Read it three ways: `language` in `plugin-<id>.json`, `x-open-bot-language` on every proxied request (live switch, no restart), `?lang=` in `location.search` client-side.
- Frame tokens slide and are reminted by the dashboard on 401 — never hardcode, persist, or share a frame URL.

## Public endpoints and @mentions (only when asked)

- `dashboard.pages.public: true` exposes `/hooks/<userId>/<pluginId>/<path>` to the internet: any method, streaming, WebSockets. Treat every request as unauthenticated hostile input — validate payloads, trust no headers, keep mutations behind the page token or the optional install secret (`X-Open-Bot-Webhook-Secret`). `?ob_async=1` accepts 202 for senders with strict timeouts.
- `dashboard.mentions` (max 4, needs a page server) adds `@section/name` composer entries. `section` cannot shadow built-ins (`personas`, `cron`, `skills`, `projects`, `reports`, `plugins`, or singulars). Answer `GET <path>` with `{items: [{name, description?, aliases?, hint?}]}` (≤100 items, name ≤80, description/hint ≤200) and keep it fast — a down server degrades the mention to "list is unavailable".
