#!/bin/sh
set -eu
if [ "${1:-}" != "--session" ] || [ -z "${2:-}" ]; then
  echo "usage: ob-chrome --session SESSION navigate URL | url | back | forward | reload" >&2
  echo "SESSION is the screen id in the system instructions." >&2
  exit 1
fi
session=$2
shift 2
if [ "${#session}" -gt 128 ]; then
  echo "bad session" >&2
  exit 1
fi
case "$session" in
  *[!A-Za-z0-9_-]* | "")
    echo "bad session" >&2
    exit 1
    ;;
esac
file=/home/agent/.open-bot/vnc/$session
portfile=/home/agent/.open-bot/cdp/$session
# The vnc file disappears when a screen is stopped, but the cdp port file
# survives — that combination is a healable dead screen, not "no screen".
if [ ! -s "$file" ] && [ ! -s "$portfile" ]; then
  echo "no screen for $session. Do not guess ports or hosts." >&2
  exit 1
fi
if [ -f "${file}.hold" ]; then
  echo "The user has this screen. Stop input until they say they are done on the screen." >&2
  exit 1
fi
# No pre-flight heal here: chrome.ts heals and retries on its own when the
# screen or browser is actually unreachable, so healthy calls stay lean.
portfile=/home/agent/.open-bot/cdp/$session
port=$(cat "$portfile" 2>/dev/null || echo 0)
case "$port" in
  922[4-9] | 923[01]) ;;
  *)
    echo "no screen for $session" >&2
    exit 1
    ;;
esac
exec bun /opt/open-bot/nav/chrome.ts "$port" "$session" "$@"
