#!/bin/bash
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"

if [[ -f /.dockerenv || "${OPEN_BOT_IN_DOCKER:-}" == "1" ]]; then
  echo "run update on the host, not inside the open-bot container" >&2
  exit 1
fi

pull_viking=0
for arg in "$@"; do
  case "$arg" in
    --pull-viking) pull_viking=1 ;;
    -h | --help)
      echo "usage: bun run update [-- --pull-viking]"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if ! docker info >/dev/null 2>&1; then
  echo "docker daemon is not running" >&2
  exit 1
fi

echo "building desktop images"
bash "$root/scripts/build-images.sh"

if [[ "$pull_viking" == "1" ]]; then
  echo "pulling ghcr.io/volcengine/openviking:latest"
  docker pull ghcr.io/volcengine/openviking:latest
fi

compose=(docker compose -f deploy/compose.yml)
if [[ -f deploy/.env ]]; then
  compose=(docker compose --env-file deploy/.env -f deploy/compose.yml)
fi

echo "recreating control plane"
"${compose[@]}" up --build -d

host=100.96.0.3
port=8787
if [[ -f deploy/.env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    case "$line" in
      PUBLISH_HOST=*) host=${line#PUBLISH_HOST=} ;;
      PUBLISH_PORT=*) port=${line#PUBLISH_PORT=} ;;
    esac
  done <deploy/.env
fi

url="http://${host}:${port}/api/health"
echo "waiting for $url"
ready=0
for _ in $(seq 1 90); do
  if bun -e 'const r = await fetch(process.argv[1]); process.exit(r.ok ? 0 : 1)' "$url"; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != "1" ]]; then
  echo "control plane did not become ready" >&2
  exit 1
fi

echo "restarting running desktops"
docker exec open-bot bun apps/control/src/recycle.ts
echo "updated http://${host}:${port}"
