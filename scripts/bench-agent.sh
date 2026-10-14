#!/bin/bash
# Agent-level browser benchmark: real threads, real model, graded scenarios.
#
# usage: bash scripts/bench-agent.sh [SCENARIO...]
# scenarios: search-click-scroll, captcha-stop, login-stop (default: all)
#
# Deploys scripts/bench-agent.ts into the control container and runs it there
# (it needs the control DB, the API, and docker access to stage local test
# pages on the desktop). Each scenario starts a hidden worker: thread, times
# it, grades the behavior, deletes the thread, and prints a summary table.
# Costs real model tokens; minutes per scenario.
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"

control=$(docker ps --format '{{.Names}}' | grep -x 'open-bot' | head -n 1)
[ -n "$control" ] || { echo "control container 'open-bot' is not running" >&2; exit 1; }
if ! docker ps --format '{{.Names}}' | grep -q '^ob-oc-'; then
  echo "no desktop container is running" >&2
  exit 1
fi

docker cp scripts/bench-agent.ts "$control":/app/apps/control/src/bench-agent.ts
docker exec -w /app open-bot bun apps/control/src/bench-agent.ts "$@"
