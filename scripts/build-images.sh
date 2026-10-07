#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
dev=0
for arg in "$@"; do
  case "$arg" in
    --dev) dev=1 ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done
docker build --build-arg OPEN_BOT_DEV="$dev" -t open-bot-opencode:local -f "$root/images/opencode/Dockerfile" "$root"
docker build -t open-bot-computer:local -f "$root/images/computer/Dockerfile" "$root"
echo "built open-bot-opencode:local and open-bot-computer:local"
