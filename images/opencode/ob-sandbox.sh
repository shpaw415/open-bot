#!/bin/sh
# ob-sandbox — run one command offline, with the source tree read-only.
#
# The supported way to execute untrusted or hostile-review code on this
# desktop (#12/#56). Bubblewrap cannot pivot_root in this container, so this
# builds the box from util-linux namespaces instead (the desktop carries
# SYS_ADMIN, which `unshare` needs and bwrap cannot use here):
#   - fresh network namespace: no interfaces up, so no DNS and no TCP egress
#   - fresh mount + IPC + PID namespaces, children killed with the parent
#   - the working directory bind-mounted read-only at $BASE/src
#   - a size-capped tmpfs at $BASE/work as the only writable tree (also HOME)
#   - wall-clock timeout plus process/file-size ulimits
# `check` proves the box on this machine before anything trusts it: egress
# and DNS must fail, a source write must fail, a work write must succeed.
set -eu

usage() {
  echo "usage: ob-sandbox check" >&2
  echo "       ob-sandbox run [--timeout SECONDS] [--mem MB] [--copy] -- CMD [ARG...]" >&2
  echo "Runs CMD offline in a scratch dir (\$OB_SANDBOX_WORK; sources read-only at \$OB_SANDBOX_SRC); --copy seeds work with a writable copy of the cwd." >&2
  exit 2
}

verb="${1:-}"
case "$verb" in
  check | run) ;;
  *) usage ;;
esac
shift

timeout_s=120
mem_mb=1024
copy=0
if [ "$verb" = "run" ]; then
  while [ $# -gt 0 ]; do
    case "$1" in
      --) shift; break ;;
      --timeout)
        [ $# -ge 2 ] || usage
        timeout_s="$2"; shift 2 ;;
      --mem)
        [ $# -ge 2 ] || usage
        mem_mb="$2"; shift 2 ;;
      --copy) copy=1; shift ;;
      *) break ;;
    esac
  done
  [ $# -ge 1 ] || usage
fi
case "$timeout_s" in '' | *[!0-9]*) usage ;; esac
case "$mem_mb" in '' | *[!0-9]*) usage ;; esac
[ "$timeout_s" -ge 1 ] && [ "$timeout_s" -le 1800 ] || usage
[ "$mem_mb" -ge 64 ] && [ "$mem_mb" -le 8192 ] || usage

command -v unshare >/dev/null 2>&1 || { echo "ob-sandbox: unshare is not available on this desktop" >&2; exit 1; }
command -v timeout >/dev/null 2>&1 || { echo "ob-sandbox: timeout is not available on this desktop" >&2; exit 1; }

src=$(pwd -P)
base=$(mktemp -d /tmp/.ob-sandbox.XXXXXX)
trap 'rm -rf "$base"' EXIT HUP INT TERM
mkdir -p "$base/src" "$base/work"

if [ "$verb" = "check" ]; then
  set -- python3 -c '
import socket, sys
src_file, work_file = sys.argv[1], sys.argv[2]
try:
    open(src_file, "w").close()
    print("FAIL: source tree is writable"); sys.exit(1)
except OSError:
    pass
try:
    with open(work_file, "w") as fh: fh.write("ok")
except OSError as e:
    print(f"FAIL: scratch dir not writable: {e}"); sys.exit(1)
try:
    socket.create_connection(("1.1.1.1", 53), timeout=3)
    print("FAIL: TCP egress succeeded"); sys.exit(1)
except OSError:
    pass
try:
    socket.getaddrinfo("example.com", 443)
    print("FAIL: DNS resolution succeeded"); sys.exit(1)
except OSError:
    pass
print("sandbox-ok")
' "$base/src/.sandbox-probe" "$base/work/.sandbox-probe"
fi

# The inner setup runs inside the new namespaces. Everything user-supplied
# arrives as positional parameters, never interpolated into this script.
inner='
set -eu
base=$1; src=$2; mem_mb=$3; copy=$4
shift 4
mount --make-rprivate /
mount --bind "$src" "$base/src"
mount -o remount,ro,bind "$base/src"
mount -t tmpfs -o "size=${mem_mb}m" tmpfs "$base/work"
if [ "$copy" = "1" ]; then cp -a "$base/src/." "$base/work/"; fi
export HOME="$base/work" TMPDIR="$base/work" OB_SANDBOX_SRC="$base/src" OB_SANDBOX_WORK="$base/work"
cd "$base/work"
ulimit -u 512 2>/dev/null || true
ulimit -f 1048576 2>/dev/null || true
exec "$@"
'

if [ "${OB_SANDBOX_DRYRUN:-}" = "1" ]; then
  printf 'timeout %s unshare --net --ipc --mount --pid --fork --kill-child sh -c <inner> sandbox %s %s %s %s --' \
    "$timeout_s" "$base" "$src" "$mem_mb" "$copy"
  for arg in "$@"; do printf ' %s' "$arg"; done
  printf '\n'
  exit 0
fi

status=0
timeout --foreground "$timeout_s" \
  unshare --net --ipc --mount --pid --fork --kill-child \
  sh -c "$inner" sandbox "$base" "$src" "$mem_mb" "$copy" "$@" || status=$?
if [ "$status" -eq 124 ]; then
  echo "ob-sandbox: command timed out after ${timeout_s}s and was killed" >&2
fi
exit "$status"
