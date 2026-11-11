#!/bin/sh
# Escape battery for sandbox threads (docs/sandbox-threads-spec.md §11).
# Self-contained: runs a throwaway control plane with a scripted
# adversarial model; never touches the live instance.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
if ! docker image inspect open-bot-sandbox:local >/dev/null 2>&1; then
  echo "bench-sandbox: building open-bot-sandbox:local first"
  docker build -t open-bot-sandbox:local -f "$root/images/sandbox/Dockerfile" "$root"
fi
exec bun "$root/scripts/bench-sandbox.ts"
