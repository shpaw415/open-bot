#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
docker build -t open-bot-opencode:local -f "$root/images/opencode/Dockerfile" "$root"
docker build -t open-bot-computer:local -f "$root/images/computer/Dockerfile" "$root"
echo "built open-bot-opencode:local and open-bot-computer:local"
