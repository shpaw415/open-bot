#!/bin/sh
set -eu
prev=""
session=""
for arg in "$@"; do
  if [ "$prev" = "--session" ]; then
    session=$arg
  fi
  prev=$arg
done
if [ -n "$session" ]; then
  /opt/open-bot/screen-heal.sh "$session" >&2 || true
fi
exec bun /opt/open-bot/nav/ob-nav.ts "$@"
