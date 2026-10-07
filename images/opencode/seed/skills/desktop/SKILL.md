---
name: desktop
description: Drive this Linux desktop. Use before browser navigation or any click, type, key, scroll, or screenshot. Screenshots accept a resolution: capture FILE 2 for a sharper browser shot, or capture FILE 2560x1600. The screen is restored. Clicks stay in live-screen pixels.
---

# Desktop

Page goals go only to `ob-nav`. Put the page URL in the goal when you know it. SESSION is the screen id in this thread's system instructions. Do not pass a host, a port, or a key. Do not print `system1-auth.json`. Do not open DevTools, CDP, port 9222-9231, `vncdo`, or a second browser.

```sh
ob-nav --session SESSION --goal "what to do on the page"
```

Read the one JSON line it prints. Do not narrate steps.

Trust the JSON `url` and `title`. A dark screenshot is not a failed navigation. The screen relaunches Chromium on this thread's last page on its own. A blank or black page only means Chromium was closed or is loading: navigate with `ob-nav`. Do not call the screen dark.

- `done`: tell the user the result.
- `needs_user`: stop input and end with `![screen](open-bot://screen)`. Do not click or type.
- `held`: the user has the screen. Stop. Do not click, type, or end with another screen link.
- `need_text`: run again with `--value "text"` only when that text came from the user. Otherwise ask them.
- `blocked` with `no url`: run `ob-nav` again with the page URL in the goal. Do not open the browser yourself.
- `fallback` is `vnc`, or the status is `unconfigured`, `blocked`, `low_confidence`, or `error`: use `ob-vnc` below. A blank shared screen is not a reason to stop. Do not write a browser script.

Use only `ob-vnc --session SESSION` for screenshots and for those fallbacks. Do not call `vncdo`. Do not pass `-s`, a host, or a port. Do not use `$OPEN_BOT_VNC`. Do not print secrets. When ob-nav cannot finish, keep driving with `ob-vnc` and complete the task yourself. Twenty `ob-vnc` actions per task is the budget. Only after that, stop input and end with `![screen](open-bot://screen)`.

`vncdo` reads `host:5902` as display 5902, not port 5902. Port 5900 is not this thread. `ob-vnc` already has the address.

## Screenshot resolution

Capture to the path named in the system line, then read that PNG as-is. Do not resize, threshold, or upscale it.

The last argument sets the resolution for that shot only. The live screen is restored.

- omit it: lossless 1920x1200 grab of the desktop
- `2` or `3`: browser at that pixel density. Divide image x and y by that number before a click
- `2560x1600`: browser viewport for that shot. Clicks still use live-screen pixels

```sh
ob-vnc --session SESSION capture /tmp/open-bot-screen.png
ob-vnc --session SESSION capture /tmp/open-bot-screen.png 2
```

Click:

```sh
ob-vnc --session SESSION move X Y click 1
```

Type, paste, and keys:

```sh
ob-vnc --session SESSION type "text"
ob-vnc --session SESSION paste "https://example.com"
ob-vnc --session SESSION key ctrl-l
```

Paste exits. Do not run `xclip` or `xsel`. They stay running and the thread stops answering.

Replace SESSION with the screen id from the system line. Do not replace it with a port. Scroll with `key` and the wheel keys `up` and `down` after moving to the target. Coordinates are live-screen pixels. A `2` capture is for reading. Divide those image coordinates by 2 before a click. Chain `ob-vnc` commands with `&&` in one bash call; each bash call is one step, and long jobs die at the step limit if every click costs two calls. Capture before a click or type sequence and again after it; a fresh capture between commands inside the same call is wasted. Capture again after every action that could move the page. If `ob-vnc` says there is no screen, stop. Do not try another port. Do not start Xvfb, x11vnc, websockify, or another browser.

When the user must act on this screen, stop input and end the reply with:

```
![screen](open-bot://screen)
```

That embeds the live screen in the chat. Wait until they say they are done on the screen.
