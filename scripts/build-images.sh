#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
bun "$root/scripts/gen-agents.ts"
docker build -t open-bot-opencode:local -f "$root/images/opencode/Dockerfile" "$root"
docker build -t open-bot-computer:local -f "$root/images/computer/Dockerfile" "$root"
docker build -t open-bot-sandbox:local -f "$root/images/sandbox/Dockerfile" "$root"
echo "built open-bot-opencode:local, open-bot-computer:local and open-bot-sandbox:local"
