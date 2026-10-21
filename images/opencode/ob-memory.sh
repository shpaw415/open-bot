#!/bin/sh
# ob-memory — this desktop's real memory budget, from its cgroup.
# `free -h` shows the HOST's RAM (e.g. 62 GiB) and is useless here: the
# container is capped by its cgroup, and Chromium renderers start dying
# ("Aw Snap") as memory.current closes on memory.max with no other signal.
set -eu
cg=/sys/fs/cgroup

read_kib() {
  # values are bytes or the literal "max"
  v=$(cat "$cg/$1" 2>/dev/null || echo "")
  [ -n "$v" ] || { echo "ob-memory: cannot read $cg/$1 (not a v2 cgroup?)" >&2; exit 1; }
  printf '%s' "$v"
}

gib() {
  awk -v b="$1" 'BEGIN { printf "%.2f GiB", b / 1073741824 }'
}

mem_max=$(read_kib memory.max)
mem_cur=$(read_kib memory.current)
swap_max=$(cat "$cg/memory.swap.max" 2>/dev/null || echo max)
swap_cur=$(cat "$cg/memory.swap.current" 2>/dev/null || echo 0)

if [ "$mem_max" = "max" ]; then
  echo "ram $(gib "$mem_cur") / unlimited"
else
  pct=$((mem_cur * 100 / mem_max))
  echo "ram $(gib "$mem_cur") / $(gib "$mem_max") (${pct}%)"
fi
if [ "$swap_max" = "max" ] || [ "$swap_max" = "0" ]; then
  echo "swap $(gib "$swap_cur") / ${swap_max}"
else
  spct=$((swap_cur * 100 / swap_max))
  echo "swap $(gib "$swap_cur") / $(gib "$swap_max") (${spct}%)"
fi

# Top RSS consumers (KiB) — the usual culprits are opencode and Chromium.
ps -eo rss=,comm= --sort=-rss 2>/dev/null | head -5 | awk '
  { printf "  %4d MB  %s\n", $1 / 1024, $2 }'
