#!/bin/bash
# Benchmark the per-thread browser CLIs on a live desktop.
#
# usage: bun run bench:browser [RUNS] [URL]
#
# Creates a throwaway screen (display 2-9), runs each suite RUNS times inside
# the desktop container, prints min/median/max in ms, removes the screen.
# Every suite carries the same docker exec + shell overhead, so differences
# between suites are the signal; the "shell-baseline" suite is the floor.
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"

runs=${1:-7}
url=${2:-https://example.com/}
case "$runs" in '' | *[!0-9]* | 0) echo "RUNS must be a positive number" >&2; exit 1 ;; esac

oc=""
session="bench-$(date +%s)"
for cand in $(docker ps --format '{{.Names}}' | grep '^ob-oc-' | sort); do
  display=""
  for d in 2 3 4 5 6 7 8 9; do
    if ! docker exec "$cand" /opt/open-bot/screen-list.sh | awk '{print $2}' | grep -qx "$d"; then
      display=$d
      break
    fi
  done
  [ -n "$display" ] || continue
  ok=""
  if docker exec "$cand" sudo /opt/open-bot/screen-up.sh "$session" "$display" >/dev/null 2>&1; then
    # chromium takes a few seconds to open its CDP port after screen-up
    for _ in 1 2 3 4 5 6 7 8; do
      if docker exec "$cand" ob-chrome --session "$session" url >/dev/null 2>&1; then
        ok=1
        break
      fi
      sleep 2
    done
  fi
  if [ -n "$ok" ]; then
    oc=$cand
    break
  fi
  docker exec "$cand" /opt/open-bot/screen-down.sh "$session" >/dev/null 2>&1 || true
done
[ -n "$oc" ] || { echo "no desktop container with a working browser found" >&2; exit 1; }

cleanup() {
  docker exec "$oc" /opt/open-bot/screen-down.sh "$session" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "desktop $oc, screen $session on display $display, $runs runs per suite"
echo "warming up (first navigation compiles bun caches)..."
docker exec "$oc" ob-chrome --session "$session" navigate "$url" >/dev/null

docker exec "$oc" sh -c '
session=$1; display=$2; runs=$3; url=$4
port=$(cat "/home/agent/.open-bot/cdp/$session")
run_suite() {
  label=$1; count=$2; shift 2
  i=0
  while [ "$i" -lt "$count" ]; do
    t0=$(date +%s%N)
    "$@" >/dev/null 2>&1
    t1=$(date +%s%N)
    echo "$label $(( (t1 - t0) / 1000000 ))"
    i=$((i + 1))
  done
}
run_suite shell-baseline "$runs" sh -c "true"
run_suite bun-start "$runs" bun -e "0"
run_suite heal-healthy "$runs" /opt/open-bot/screen-heal.sh "$session"
run_suite chrome-url-wrapper "$runs" ob-chrome --session "$session" url
run_suite chrome-url-direct "$runs" bun /opt/open-bot/nav/chrome.ts "$port" url
run_suite chrome-navigate "$runs" ob-chrome --session "$session" navigate "$url"
run_suite page-read "$runs" ob-page --session "$session" read
' _ "$session" "$display" "$runs" "$url" | awk -v runs="$runs" '
  { times[$1] = times[$1] " " $2; labels[$1] = 1; order[++n] = $1 }
  END {
    printf "%-20s %8s %8s %8s\n", "suite", "min", "median", "max"
    for (k = 1; k <= n; k++) {
      label = order[k]
      if (seen[label]++) continue
      count = split(times[label], a, " ")
      for (i = 1; i <= count; i++) for (j = i + 1; j <= count; j++)
        if (a[j] + 0 < a[i] + 0) { tmp = a[i]; a[i] = a[j]; a[j] = tmp }
      min = a[1]; max = a[count]; med = a[int((count + 1) / 2)]
      printf "%-20s %6dms %8dms %6dms\n", label, min, med, max
    }
  }'

echo "done; bench screen removed"
