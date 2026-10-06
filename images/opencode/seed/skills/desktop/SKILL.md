---
name: desktop
description: Drive this Linux desktop with the VNC CLI. Use before any click, type, key, scroll, or screenshot.
---

# Desktop

Use only `vncdo` against the host in this thread's system instructions (`computer:59xx`). Do not pass another host. Do not use `$OPEN_BOT_VNC`. Do not print secrets.

Capture to the path named in that system line, then read the PNG with the read tool:

```sh
vncdo -s computer:59xx capture /tmp/open-bot-59xx.png
```

Click:

```sh
vncdo -s computer:59xx move X Y click 1
```

Type and keys:

```sh
vncdo -s computer:59xx type "text"
vncdo -s computer:59xx key ctrl-l
```

Replace `59xx` and the capture path with the values from the system line. Scroll with `key` and the wheel keys `up` and `down` after moving to the target. Coordinates are pixels in the latest screenshot. Capture again after every action. If the connection is refused, this thread's screen is not up. Say so and stop. Do not start Xvfb, x11vnc, websockify, or another browser.

When the user must act on this screen, stop input and end the reply with:

```
![screen](open-bot://screen)
```

That embeds the live screen in the chat. Wait until they say they are done on the screen.
