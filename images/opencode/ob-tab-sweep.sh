#!/bin/sh
# ob-tab-sweep — close crashed/frozen Chromium tabs so the CDP ladder stops
# timing out on them. With --session SESSION only that screen is swept;
# without arguments every screen is swept, skipping user-held ones.
# Memory pressure (control-plane sampler) runs the no-argument form.
set -eu

port_ok() {
  case "$1" in
    922[4-9] | 923[01]) return 0 ;;
    *) return 1 ;;
  esac
}

sweep_port() {
  bun /opt/open-bot/nav/tab-sweep.ts "$1" || true
}

if [ "${1:-}" = "--session" ] || [ "${1:-}" = "-s" ]; then
  [ $# -eq 2 ] || { echo "usage: ob-tab-sweep [--session SESSION]" >&2; exit 2; }
  session=$2
  case "$session" in
    *[!A-Za-z0-9_-]* | "") echo "bad session" >&2; exit 1 ;;
  esac
  if [ -f "/home/agent/.open-bot/vnc/$session.hold" ]; then
    echo '{"swept":0,"closed":[],"kept":0,"note":"screen is user-held"}'
    exit 0
  fi
  port=$(cat "/home/agent/.open-bot/cdp/$session" 2>/dev/null || echo 0)
  if ! port_ok "$port"; then
    echo "no screen for $session" >&2
    exit 1
  fi
  sweep_port "$port"
  exit 0
fi

[ $# -eq 0 ] || { echo "usage: ob-tab-sweep [--session SESSION]" >&2; exit 2; }

for portfile in /home/agent/.open-bot/cdp/*; do
  [ -f "$portfile" ] || continue
  session=${portfile##*/}
  [ -f "/home/agent/.open-bot/vnc/$session.hold" ] && continue
  port=$(cat "$portfile" 2>/dev/null || echo 0)
  port_ok "$port" || continue
  sweep_port "$port"
done
