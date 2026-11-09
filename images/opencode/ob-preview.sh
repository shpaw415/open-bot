#!/bin/sh
set -eu

REGDIR=/home/agent/.open-bot/preview
PORT_MIN=4700
PORT_MAX=4719
SPAWN=/opt/open-bot/preview-spawn.ts

usage() {
  echo "usage: ob-preview up --session SESSION DIR" >&2
  echo "       ob-preview up --session SESSION --entry FILE" >&2
  echo "       ob-preview restart --session SESSION" >&2
  echo "       ob-preview down --session SESSION" >&2
  echo "       ob-preview status --session SESSION" >&2
  exit 2
}

valid_session() {
  printf '%s' "$1" | grep -Eq '^[A-Za-z0-9_-]{1,128}$'
}

allowed_path() {
  case "$1" in
    /home/agent/workspace | /home/agent/workspace/*) return 0 ;;
    /home/agent/plugins-create | /home/agent/plugins-create/*) return 0 ;;
    *) return 1 ;;
  esac
}

port_free() {
  bun -e '
    const port = Number(process.argv[1])
    try {
      const server = Bun.listen({ hostname: "0.0.0.0", port, socket: { data() {} } })
      server.stop(true)
      process.exit(0)
    } catch {
      process.exit(1)
    }
  ' "$1"
}

alive() {
  [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null
}

stop_pid() {
  pid=$1
  if alive "$pid"; then
    kill "$pid" 2>/dev/null || true
    i=0
    while [ "$i" -lt 20 ] && alive "$pid"; do
      i=$((i + 1))
      sleep 0.1
    done
    if alive "$pid"; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
}

read_reg() {
  file=$1
  reg_port=$(sed -n '1p' "$file" 2>/dev/null || true)
  reg_root=$(sed -n '2p' "$file" 2>/dev/null || true)
  reg_pid=$(sed -n '3p' "$file" 2>/dev/null || true)
  reg_kind=$(sed -n '4p' "$file" 2>/dev/null || true)
  reg_entry=$(sed -n '5p' "$file" 2>/dev/null || true)
}

write_reg() {
  tmp="$1.tmp"
  printf '%s\n%s\n%s\n%s\n%s\n' "$2" "$3" "$4" "$5" "${6:-}" >"$tmp"
  mv "$tmp" "$1"
}

# Preview servers also register in the shared ob-process registry (#13) so
# `ob-process list` and the dashboard Processes view show every persistent
# server, not only ob-process-started ones. Best-effort: registration must
# never fail a preview start. One preview per session -> a deterministic
# p-<8 hex> id derived from the session id.
PROC_REG="${HOME:-/home/agent}/.open-bot/processes"
process_row_id() {
  printf 'p-%s' "$(printf '%s' "preview:$1" | sha256sum 2>/dev/null | cut -c1-8)"
}
register_process() {
  # $1 session, $2 pid, $3 cmd label, $4 cwd, $5 log
  proc_id=$(process_row_id "$1") || return 0
  [ -n "$proc_id" ] && [ "$proc_id" != "p-" ] || return 0
  proc_stats=$(sed -e 's/.*) //' "/proc/$2/stat" 2>/dev/null | awk '{print $3, $20}') || proc_stats=""
  proc_pgrp=$(printf '%s\n' "$proc_stats" | awk '{print $1}')
  proc_ticks=$(printf '%s\n' "$proc_stats" | awk '{print $2}')
  case "$proc_pgrp" in '' | *[!0-9]*) proc_pgrp=$2 ;; esac
  case "$proc_ticks" in '' | *[!0-9]*) proc_ticks=0 ;; esac
  mkdir -p "$PROC_REG/logs" 2>/dev/null || return 0
  REG="$PROC_REG" OB_ID="$proc_id" OB_NAME="preview" OB_SESSION="$1" \
    OB_PID="$2" OB_PGRP="$proc_pgrp" OB_STARTTICKS="$proc_ticks" OB_CMD="$3" \
    OB_LOG="$5" OB_CWD="$4" python3 - <<'PYEOF' 2>/dev/null || true
import json, os, time
row = {
    "id": os.environ["OB_ID"],
    "name": os.environ["OB_NAME"],
    "session": os.environ["OB_SESSION"],
    "pid": int(os.environ["OB_PID"]),
    "pgid": int(os.environ["OB_PGRP"]),
    "startTime": int(os.environ["OB_STARTTICKS"]),
    "cmd": os.environ["OB_CMD"][:256],
    "startedAt": int(time.time() * 1000),
    "cwd": os.environ["OB_CWD"],
    "log": os.environ["OB_LOG"],
}
reg = os.environ["REG"]
tmp = os.path.join(reg, f".{row['id']}.tmp")
with open(tmp, "w") as fh:
    json.dump(row, fh)
os.replace(tmp, os.path.join(reg, f"{row['id']}.json"))
PYEOF
}
deregister_process() {
  proc_id=$(process_row_id "$1") || return 0
  [ -n "$proc_id" ] && [ "$proc_id" != "p-" ] || return 0
  rm -f "$PROC_REG/$proc_id.json" 2>/dev/null || true
}

wait_ready() {
  port=$1
  pid=$2
  i=0
  while [ "$i" -lt 40 ]; do
    if bun -e 'fetch(`http://127.0.0.1:${process.argv[1]}/`,{signal:AbortSignal.timeout(400)}).then(()=>process.exit(0)).catch(()=>process.exit(1))' "$port"; then
      return 0
    fi
    if ! alive "$pid"; then
      return 1
    fi
    i=$((i + 1))
    sleep 0.25
  done
  return 1
}

pick_port() {
  prefer=${1:-}
  if [ -n "$prefer" ] && port_free "$prefer"; then
    echo "$prefer"
    return 0
  fi
  p=$PORT_MIN
  while [ "$p" -le "$PORT_MAX" ]; do
    if port_free "$p"; then
      echo "$p"
      return 0
    fi
    p=$((p + 1))
  done
  return 1
}

evict_oldest() {
  oldest=""
  oldest_mtime=999999999999
  for f in "$REGDIR"/*; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    case "$name" in
      *.log | *.tmp | "$session") continue ;;
    esac
    mtime=$(stat -c %Y "$f" 2>/dev/null || echo 0)
    if [ "$mtime" -lt "$oldest_mtime" ]; then
      oldest_mtime=$mtime
      oldest=$f
    fi
  done
  [ -n "$oldest" ] || return 1
  read_reg "$oldest"
  stop_pid "$reg_pid"
  rm -f "$oldest"
  printf '%s' "$reg_port"
}

cmd=${1:-}
[ -n "$cmd" ] || usage
shift

session=""
entry=""
dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --session)
      session=${2:-}
      shift 2
      ;;
    --entry)
      entry=${2:-}
      shift 2
      ;;
    --)
      shift
      ;;
    -*)
      usage
      ;;
    *)
      dir=$1
      shift
      ;;
  esac
done

valid_session "$session" || usage
reg="$REGDIR/$session"
log="$REGDIR/$session.log"
mkdir -p "$REGDIR"

case "$cmd" in
  down)
    if [ -f "$reg" ]; then
      read_reg "$reg"
      stop_pid "$reg_pid"
      rm -f "$reg"
    fi
    deregister_process "$session"
    echo "preview down"
    exit 0
    ;;
  restart)
    # Reload rebuilt code in place (#42): --hot can retain stale generated
    # imports, and plain `up` on a live preview is a no-op. Restart re-runs
    # the stored root/entry through the normal up path below.
    [ -z "$entry" ] && [ -z "$dir" ] || usage
    [ -f "$reg" ] || { echo "no preview to restart for $session" >&2; exit 1; }
    read_reg "$reg"
    if [ "$reg_kind" = "entry" ] && [ -n "$reg_entry" ]; then
      entry=$reg_entry
    else
      dir=$reg_root
    fi
    stop_pid "$reg_pid"
    rm -f "$reg"
    deregister_process "$session"
    ;;
  status)
    if [ ! -f "$reg" ]; then
      echo "down"
      exit 0
    fi
    read_reg "$reg"
    if alive "$reg_pid"; then
      echo "up $reg_port $reg_root"
    else
      echo "down"
    fi
    exit 0
    ;;
  up) ;;
  *) usage ;;
esac

if [ -n "$entry" ]; then
  [ -f "$entry" ] || {
    echo "entry not found" >&2
    exit 1
  }
  entry=$(realpath "$entry")
  allowed_path "$entry" || {
    echo "entry must be under /home/agent/workspace or /home/agent/plugins-create" >&2
    exit 1
  }
  root=$(dirname "$entry")
  kind=entry
else
  [ -n "$dir" ] || usage
  [ -d "$dir" ] || {
    echo "directory not found" >&2
    exit 1
  }
  root=$(realpath "$dir")
  allowed_path "$root" || {
    echo "directory must be under /home/agent/workspace or /home/agent/plugins-create" >&2
    exit 1
  }
  [ -d "$root" ] || {
    echo "directory not found" >&2
    exit 1
  }
  kind=dir
  entry=""
fi

if [ -f "$reg" ]; then
  read_reg "$reg"
  if alive "$reg_pid" && [ "$reg_root" = "$root" ]; then
    echo "![preview](open-bot://preview)"
    exit 0
  fi
  stop_pid "$reg_pid"
  prefer=$reg_port
else
  prefer=""
fi

if ! port=$(pick_port "$prefer"); then
  freed=$(evict_oldest) || {
    echo "no preview port free" >&2
    exit 1
  }
  if port_free "$freed"; then
    port=$freed
  elif ! port=$(pick_port ""); then
    echo "no preview port free" >&2
    exit 1
  fi
fi

: >"$log"
if [ "$kind" = "entry" ]; then
  pid=$(HOST=0.0.0.0 PORT="$port" bun "$SPAWN" "$log" "$entry" "$root")
else
  pid=$(HOST=0.0.0.0 PORT="$port" PREVIEW_DIR="$root" bun "$SPAWN" "$log" "" "$root")
fi

if ! wait_ready "$port" "$pid"; then
  stop_pid "$pid"
  echo "preview did not start" >&2
  tail -n 40 "$log" >&2 || true
  exit 1
fi

write_reg "$reg" "$port" "$root" "$pid" "$kind" "$entry"
register_process "$session" "$pid" "ob-preview $kind $root" "$root" "$log" || true
echo "![preview](open-bot://preview)"
