---
name: desktop
description: Drive this Linux desktop. Use before browser navigation or any click, type, key, scroll, or screenshot. Screenshots accept a resolution: capture FILE 2 for a sharper browser shot, or capture FILE 2560x1600. The screen is restored. Clicks stay in live-screen pixels.
---

# Desktop

Page goals go only to `ob-nav`. Put the page URL in the goal when you know it. SESSION is the screen id in this thread's system instructions. Do not pass a host, a port, or a key. Do not print `system1-auth.json`. Do not open DevTools, CDP, port 9222-9231, `vncdo`, or a second browser.

```sh
ob-nav --session SESSION --goal "what to do on the page"
```

Read the one JSON line it prints. Do not narrate steps. The JSON may include `requested_url` (the url the goal named) and `motive: "redirect"` — the site redirected the browser itself. Trust the final `url` and `title`; a redirect is not a failure. If the run strays from the goal url, ob-nav navigates back and retries once on its own before giving up.

Trust the JSON `url` and `title`. A dark screenshot is not a failed navigation. The screen relaunches Chromium on this thread's last page on its own. A blank or black page only means Chromium was closed or is loading: navigate with `ob-nav`. Do not call the screen dark.

- `done`: tell the user the result.
- `needs_user`: stop input and end with `![screen](open-bot://screen)`. Do not click or type.
- `held`: the user has the screen. Stop. Do not click, type, or end with another screen link.
- `need_text`: run again with `--value "text"` only when that text came from the user. Otherwise ask them.
- `blocked` with `no url`: run `ob-nav` again with the page URL in the goal. Do not open the browser yourself.
- `fallback` is `vnc`, or the status is `unconfigured`, `blocked`, `low_confidence`, or `error`: use `ob-vnc` below. A blank shared screen is not a reason to stop. Do not write a browser script.

Use `ob-page --session SESSION` when ob-nav cannot finish: it controls the browser DOM directly, no screenshots or OCR needed.

```sh
ob-page --session SESSION read
ob-page --session SESSION scroll down 3
ob-page --session SESSION click 7
ob-page --session SESSION type 3 "some text"
```

`read` prints one JSON line: url, title, viewport, scroll position, and visible controls with stable ids. Use those ids for `click` and `type`. `read` again after the page moves; ids die with a navigation. Clicks are occlusion-checked; a covered target says `target covered`.

Use only `ob-vnc --session SESSION` for pixels when the DOM path fails. Do not call `vncdo`. Do not pass `-s`, a host, or a port. Do not use `$OPEN_BOT_VNC`. Do not print secrets. Twenty fallback actions per task is the budget. Only after that, stop input and end with `![screen](open-bot://screen)`.

`vncdo` reads `host:5902` as display 5902, not port 5902. Port 5900 is not this thread. `ob-vnc` already has the address.

## Screenshot resolution

Capture to the path named in the system line, then read that PNG as-is. Do not resize, threshold, or upscale it.

The last argument sets the resolution for that shot only. The live screen is restored.

Every capture prints one line: `capture WxH live WxH factor N offset X,Y`. The browser window sits at an offset inside the desktop, so scaled and viewport shots are NOT aligned with the live screen: image coordinates must be divided by the factor AND shifted by the offset before a click. Do not do that math by hand — convert with `map`, and verify with `hit-image`:

```sh
ob-vnc --session SESSION map IMAGE_X IMAGE_Y
ob-vnc --session SESSION hit-image IMAGE_X IMAGE_Y
```

`map` prints `live X Y` — click with those. `hit-image` prints the same line plus the JSON element under it, so you can confirm the target before clicking. Full-desktop captures (no resolution argument) print `factor 1 offset 0,0`; their image coordinates are already live coordinates and `map` is unnecessary.

- omit the resolution: lossless 1920x1200 grab of the desktop
- `2` or `3`: browser at that pixel density
- `2560x1600`: browser viewport for that shot. Clicks still use live-screen pixels

```sh
ob-vnc --session SESSION capture /tmp/open-bot-screen.png
ob-vnc --session SESSION capture /tmp/open-bot-screen.png 2
ob-vnc --session SESSION map 1545 622
```

Click (live coordinates, straight from `map`):

```sh
ob-vnc --session SESSION move X Y click 1
```

To confirm what a click hit, check the point in the same call:

```sh
ob-vnc --session SESSION move X Y click 1 && ob-vnc --session SESSION hit X Y
```

`hit X Y` takes live-screen pixels and prints one JSON line with the element under that point (tag, id, label, text). `hit-image` is its scaled-capture twin and takes image coordinates straight from the last scaled capture. Use them after a click on a small target and before typing; if they report the wrong element, recompute the coordinates (`map` again on a fresh capture) and click again.

Type, paste, and keys:

```sh
ob-vnc --session SESSION type "text"
ob-vnc --session SESSION paste "https://example.com"
ob-vnc --session SESSION key ctrl-l
```

`key` accepts common names like `Return`, `Escape`, `Backspace`, `PageDown` — they are normalized for you.

Paste exits. Do not run `xclip` or `xsel`. They stay running and the thread stops answering.

Replace SESSION with the screen id from the system line. Do not replace it with a port. Scroll with `key` and the wheel keys `up` and `down` after moving to the target. Coordinates for `move`, `click`, and `hit` are live-screen pixels; scaled-capture coordinates must go through `map` first. A `2` capture is for reading. Chain `ob-vnc` commands with `&&` in one bash call; each bash call is one step, and long jobs die at the step limit if every click costs two calls. Capture before a click or type sequence and again after it; a fresh capture between commands inside the same call is wasted. Capture again after every action that could move the page. If clicks or keys stop changing the page, run `ob-vnc --session SESSION recover` once (it releases stuck modifiers), then retry the action once; if the page still does not change, stop input and end with `![screen](open-bot://screen)` instead of hammering a dead screen. If `ob-vnc` says there is no screen, stop. Do not try another port. Do not start Xvfb, x11vnc, websockify, or another browser.

When the user must act on this screen, stop input and end the reply with:

```
![screen](open-bot://screen)
```

That embeds the live screen in the chat. Wait until they say they are done on the screen.
