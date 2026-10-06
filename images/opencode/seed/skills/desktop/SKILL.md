---
name: desktop
description: Drive this Linux desktop with the VNC CLI. Use before any click, type, key, scroll, or screenshot.
---

# Desktop

Use only `vncdo` against `$OPEN_BOT_VNC`. Do not pass another host. Do not print secrets.

Capture, then read the PNG with the read tool:

```sh
vncdo -s "$OPEN_BOT_VNC" capture /tmp/open-bot-screen.png
```

Click:

```sh
vncdo -s "$OPEN_BOT_VNC" move X Y click 1
```

Type and keys:

```sh
vncdo -s "$OPEN_BOT_VNC" type "text"
vncdo -s "$OPEN_BOT_VNC" key ctrl-l
```

Scroll with `key` and the wheel keys `up` and `down` after moving to the target. Coordinates are pixels in the latest screenshot. Capture again after every action. If the connection is refused, stop.
