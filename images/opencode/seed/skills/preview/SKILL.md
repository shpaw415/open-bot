---
name: preview
description: Serve a page from this desktop and embed it in the thread. Use when the user wants to see a website design, a mock, a small web app, or any page you are building. Hot-reloads between edits.
---

# Preview

Show a page in the thread. Do not paste the HTML as the only deliverable. Do not use the desktop browser for a page you are building.

SESSION is the screen id in this thread's system instructions.

Put the files under `/home/agent/workspace`. Use relative URLs (`style.css`, `./app.js`), not root-absolute `/style.css`.

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

## Reply

End the final message with the embed line the command prints:

```markdown
![short title](open-bot://preview)
```

A subpath is `![pricing](open-bot://preview/pricing)`. Do not print the port. Do not stop the server while the user is still looking. `ob-preview down --session SESSION` only when they are done or you are replacing the directory.
