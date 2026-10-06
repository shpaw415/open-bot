#!/bin/sh
set -eu
exec bun /opt/open-bot/nav/ob-nav.ts "$@"
