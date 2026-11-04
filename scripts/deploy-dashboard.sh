#!/bin/bash
# Build and deploy ONLY the dashboard (apps/web) to the running control
# container. Unlike scripts/update.sh this does not rebuild any Docker
# image, recreate the control plane, or restart any desktop: the control
# plane streams apps/web/dist from disk per request (index.html is
# no-cache, chunks are content-hashed), so overlaying the new build is
# enough for every new page load to get the new UI. Old hashed chunks are
# kept, so tabs that are already open keep working.
#
# Caveat: the shell build id (/api/build, x-open-bot-build) is cached in
# the control process, so without --restart already-open dashboard tabs
# keep their old shell until reloaded. --restart restarts ONLY the
# control container (desktops keep running) so the build id refreshes
# and open shells auto-reload onto the new build.
#
# usage: bun run deploy:dashboard [-- --restart]
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"

if [[ -f /.dockerenv || "${OPEN_BOT_IN_DOCKER:-}" == "1" ]]; then
  echo "run deploy-dashboard on the host, not inside the open-bot container" >&2
  exit 1
fi

restart=0
for arg in "$@"; do
  case "$arg" in
    --restart) restart=1 ;;
    -h | --help)
      echo "usage: bun run deploy:dashboard [-- --restart]"
      echo "  builds apps/web and overlays dist/ into the running control container"
      echo "  --restart  also restart the control container so open tabs auto-reload"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

container="${OPEN_BOT_CONTAINER:-open-bot}"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is not on PATH" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "docker daemon is not running" >&2
  exit 1
fi
if [[ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null)" != "true" ]]; then
  echo "container $container is not running — use bun run update for a cold start" >&2
  exit 1
fi

# Where the control process serves the dashboard from (WEB_DIST override wins).
target=$(docker exec "$container" printenv WEB_DIST 2>/dev/null || true)
target="${target:-/app/apps/web/dist}"
staging="${target}-next"

build_id() { # same identity as control's uiBuildId(): sha256(index.html)[:16]
  sha256sum "$1" | cut -c1-16
}

old_id=$(docker exec "$container" sha256sum "$target/index.html" 2>/dev/null | cut -c1-16 || true)
old_id="${old_id:-none}"

if [[ ! -d node_modules ]]; then
  echo "installing dependencies"
  bun install
fi

echo "building dashboard"
bun run --cwd apps/web build

dist="$root/apps/web/dist"
if [[ ! -f "$dist/index.html" ]]; then
  echo "build produced no $dist/index.html" >&2
  exit 1
fi
new_id=$(build_id "$dist/index.html")

# Stage inside the container, then overlay with index.html copied last, so
# the live index never points at chunks that are not there yet.
echo "deploying to $container:$target (build $old_id -> $new_id)"
docker exec "$container" sh -c 'rm -rf "$1" && mkdir -p "$1"' _ "$staging"
docker cp "$dist/." "$container:$staging/"
docker exec "$container" sh -c \
  'mkdir -p "$2" && cp -a "$1/." "$2/" && cp "$1/index.html" "$2/index.html" && rm -rf "$1"' \
  _ "$staging" "$target"

live_id=$(docker exec "$container" sha256sum "$target/index.html" | cut -c1-16)
if [[ "$live_id" != "$new_id" ]]; then
  echo "deployed index.html hash $live_id does not match build $new_id" >&2
  exit 1
fi

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
base="http://${host}:${port}"

wait_health() {
  for _ in $(seq 1 60); do
    if bun -e 'const r = await fetch(process.argv[1]); process.exit(r.ok ? 0 : 1)' "$base/api/health" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "control plane did not become ready at $base/api/health" >&2
  return 1
}

if [[ "$restart" == "1" ]]; then
  echo "restarting $container (desktops keep running)"
  docker restart "$container" >/dev/null
  wait_health
  served_id=$(bun -e 'const r = await fetch(process.argv[1]); const j = await r.json(); console.log(j.build ?? "")' "$base/api/build" 2>/dev/null || true)
  if [[ "$served_id" != "$new_id" ]]; then
    echo "warning: /api/build reports ${served_id:-nothing}, expected $new_id" >&2
  fi
  echo "dashboard deployed: build $new_id at $base (open tabs will auto-reload)"
else
  wait_health
  echo "dashboard deployed: build $new_id at $base"
  echo "note: tabs that are already open keep the old shell until reloaded;"
  echo "      re-run with --restart to have them auto-reload onto this build."
fi
