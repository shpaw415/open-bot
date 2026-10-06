---
name: desktop
description: Drive this Linux desktop. Use before browser navigation or any click, type, key, scroll, or screenshot.
---

# Desktop

Page goals go to `ob-nav` first. SESSION is the screen id in this thread's system instructions. Do not pass a host, a port, or a key. Do not print `system1-auth.json`.

```sh
ob-nav --session SESSION --goal "what to do on the page"
```

Read the one JSON line it prints. Do not narrate steps.

- `done`: tell the user the result.
- `needs_user`: stop input and end with `![screen](open-bot://screen)`.
- `need_text`: run again with `--value "text"` only when that text came from the user. Otherwise ask them.
- `unconfigured`, `blocked`, `low_confidence`, or `error`: use `ob-vnc` below.

Use only `ob-vnc --session SESSION` for screenshots and for those fallbacks. Do not call `vncdo`. Do not pass `-s`, a host, or a port. Do not use `$OPEN_BOT_VNC`. Do not print secrets.

`vncdo` reads `host:5902` as display 5902, not port 5902. Port 5900 is not this thread. `ob-vnc` already has the address.

Capture to the path named in the system line, then read the PNG with the read tool:

```sh
ob-vnc --session SESSION capture /tmp/open-bot-screen.png
```

Click:

```sh
ob-vnc --session SESSION move X Y click 1
```

Type and keys:

```sh
ob-vnc --session SESSION type "text"
ob-vnc --session SESSION key ctrl-l
```

Replace SESSION with the screen id from the system line. Do not replace it with a port. Scroll with `key` and the wheel keys `up` and `down` after moving to the target. Coordinates are pixels in the latest screenshot. Capture again after every action. If `ob-vnc` says there is no screen, stop. Do not try another port. Do not start Xvfb, x11vnc, websockify, or another browser.

When the user must act on this screen, stop input and end the reply with:

```
![screen](open-bot://screen)
```

That embeds the live screen in the chat. Wait until they say they are done on the screen.
