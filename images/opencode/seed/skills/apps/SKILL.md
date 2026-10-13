---
name: apps
description: Open native desktop apps (Discord, a file manager, a standalone Chrome window) on this thread's screen. Use when the person asks to open, launch, or use an installed application, or says an app by name.
---

# Apps

Launch native apps with `ob-app`. SESSION is the screen id in this thread's system instructions. Do not pass a host, a port, or a key.

```sh
ob-app --session SESSION launch APP
ob-app --session SESSION launch chrome https://example.com
ob-app --session SESSION list
ob-app --session SESSION focus "Window Title"
ob-app --session SESSION close APP
```

Apps open maximized on this screen. Verify with `ob-vnc --session SESSION capture /tmp/open-bot-screen.png` before reporting done.

- Not installed? `sudo apt-get install -y PACKAGE` (extra packages come back after a desktop update), then launch again. Apps missing from Debian repos: download the vendor .deb and install it (`Discord`: https://discord.com/api/download?platform=linux&format=deb, then `sudo apt install ./discord.deb`).
- If the app exits immediately, `ob-app` prints the log tail. Install the missing dependency and launch again. Do not retry blindly.
- A standalone Chrome window is an app: `ob-app --session SESSION launch chrome [URL]` (add `--profile NAME` for a second identity). Thread pages still go through `ob-chrome navigate`. Never launch `chromium` or `google-chrome` directly; it is denied.
- The screen has no audio: apps are silent. Say so when it matters (video, calls, music).
- When the person must act in the app (a login, a code, a choice only they can make), stop input and end with `![screen](open-bot://screen)`.
