---
name: preview
description: Serve a page from this desktop and embed it in the thread. Use when the user wants to see a website design, a mock, a small web app, or any page you are building. Hot-reloads between edits.
---

# Preview

Show a page in the thread. Do not paste the HTML as the only deliverable. Do not use the desktop browser for a page you are building.

SESSION is the screen id in this thread's system instructions.

Put the files under `/home/agent/workspace`. Use relative URLs (`style.css`, `./app.js`), not root-absolute `/style.css`. Plugin dashboard pages can also preview straight from their checkout: `--entry ~/plugins-create/<slug>/server/server.ts` runs the plugin's own `server.ts` unchanged (the preview port arrives as `OPEN_BOT_PAGE_PORT`, dev token `dev-preview`) — see the `plugin` skill for the full page dev loop.

## Site or design

One command starts the dev server. It watches the directory and reloads the page when files change. If it is already serving that directory, it stays up. Do not start it again on every edit.

```sh
ob-preview up --session SESSION /home/agent/workspace/site
```

Edit the files. The embedded page hot-reloads. Run `ob-preview status --session SESSION` if you are unsure it is still up.

## Your own Bun server

Use this when the page is an app, not a static directory. Read `PORT` and `HOST`. Bind `0.0.0.0`, not `127.0.0.1`. Export the server so `bun --hot` can reload it.

```ts
const port = Number(process.env.PORT)
export default {
  port,
  hostname: process.env.HOST || "0.0.0.0",
  fetch() {
    return new Response("<h1>Hi</h1>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  },
}
```

```sh
ob-preview up --session SESSION --entry /home/agent/workspace/app/server.ts
```

`bun --hot` reloads that file between edits. Keep asset URLs relative.

## How the chat embed proxies your server

The embed is a control-plane iframe that forwards every request to your port
(4700-4719). The proxy is verbatim: same method, path, query string, headers
(minus cookies/auth) and body, response streamed back untouched — no caching,
no rate limit, no MIME rewriting, and WebSockets upgrade through. What is
different from the direct `127.0.0.1:<port>` URL:

- The frame is an opaque origin: storage and `getUserMedia` go through the
  injected shim (see the `plugin` skill's device-access section), and the
  capability token in the path expires after ~10 idle minutes — a stale
  embed reloads.
- Every asset request is one control-plane → desktop round trip over the
  tunnel. Per-frame `img.src` churn or per-keystroke fetches amplify badly;
  batch or swap sources in-page instead.
- Cache-busting query imports (`import('./mod?cb=…')`) reach your server
  verbatim — if they fail in the embed, suspect your server's module
  resolution (or the opaque-origin shim), not the proxy.

Smoke test before shipping: exercise the app on the direct port first
(`curl 127.0.0.1:<port>/…` for status, the managed browser for interaction);
whatever works there works verbatim through the embed unless it touches
storage, media devices, or relative-path rewriting of HTML bodies.

## Reply

End the final message with the embed line the command prints:

```markdown
![short title](open-bot://preview)
```

A subpath is `![pricing](open-bot://preview/pricing)`. Do not print the port. Do not stop the server while the user is still looking. `ob-preview down --session SESSION` only when they are done or you are replacing the directory.
