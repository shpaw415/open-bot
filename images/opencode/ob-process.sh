#!/bin/sh
# ob-process — start and manage background processes on this desktop.
# Every job started here is registered under ~/.open-bot/processes so the
# dashboard Processus view (and any thread) can watch it and stop it.
# Processes started any other way are not tracked; raw pids are never accepted.
set -eu

usage() {
  echo "usage: ob-process start [--name NAME] [--session SESSION] -- CMD [ARG...]" >&2
  echo "       ob-process list [--json]" >&2
  echo "       ob-process log ID [--tail N]" >&2
  echo "       ob-process kill ID" >&2
  exit 1
}

REG="${HOME:-/home/agent}/.open-bot/processes"

# Screen and agent-runtime infrastructure is never a managed process.
REFUSED="opencode Xvfb x11vnc websockify ttyd vncdo screen-heal ob-tab-sweep"

refused() {
  check=$1
  for bad in $REFUSED; do
    if [ "$check" = "$bad" ]; then
      return 0
    fi
  done
  return 1
}

validate_name() {
  case "$1" in
    "" | *[!A-Za-z0-9._-]*) return 1 ;;
  esac
  [ "${#1}" -le 64 ] || return 1
}

validate_session() {
  case "$1" in
    "" | *[!A-Za-z0-9_-]*) return 1 ;;
  esac
  [ "${#1}" -le 128 ] || return 1
}

validate_id() {
  case "$1" in
    p-*[!0-9a-f]* | "") usage ;;
  esac
  [ "${#1}" -eq 10 ] || usage
}

if [ "${1:-}" = "start" ]; then
  shift
  name=""
  session=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --name)
        [ "$#" -ge 2 ] || usage
        name=$2
        shift 2
        ;;
      --name=*)
        name=${1#--name=}
        shift
        ;;
      --session)
        [ "$#" -ge 2 ] || usage
        session=$2
        shift 2
        ;;
      --session=*)
        session=${1#--session=}
        shift
        ;;
      --)
        shift
        break
        ;;
      *)
        usage
        ;;
    esac
  done
  [ "$#" -ge 1 ] || usage
  # A relative path binary resolves against this cwd, which the detached
  # process inherits. Fail fast with the cwd named instead of an instant
  # background death that only shows up as "module not found" in the log.
  case "$1" in
    /*) ;;
    */*)
      if [ ! -e "$1" ]; then
        echo "not found: $1 (started from cwd $(pwd -P)) — pass an absolute path" >&2
        exit 1
      fi
      ;;
  esac
  case "$1" in
    */*) base=${1##*/} ;;
    *) base=$1 ;;
  esac
  if refused "$base"; then
    echo "refusing to track $base — screen and agent infrastructure is not a managed process" >&2
    exit 1
  fi
  if [ -z "$name" ]; then
    name=$base
  fi
  if ! validate_name "$name"; then
    echo "bad name: letters, digits, dot, dash, underscore; at most 64 chars" >&2
    exit 1
  fi
  if [ -z "$session" ]; then
    session="unknown"
  fi
  if ! validate_session "$session"; then
    echo "bad session id" >&2
    exit 1
  fi

  mkdir -p "$REG/logs"
  id="p-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
  log="$REG/logs/$id.log"
  if ! : >"$log" 2>/dev/null; then
    echo "cannot write $log" >&2
    exit 1
  fi

  setsid "$@" >>"$log" 2>&1 </dev/null &
  pid=$!
  sleep 0.5
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "the process exited immediately (cwd $(pwd -P)). Last log lines:" >&2
    tail -n 5 "$log" >&2 || true
    rm -f "$log"
    exit 1
  fi
  # pgrp (field 5) and starttime (field 22) come from /proc; the stored
  # starttime detects pid reuse later. Strip through the last ")" (comm) the
  # same way the python side does; remaining tokens start at field 3.
  proc_stats=$(sed -e 's/.*) //' "/proc/$pid/stat" 2>/dev/null | awk '{print $3, $20}') || proc_stats=""
  pgrp=$(printf '%s\n' "$proc_stats" | awk '{print $1}')
  start_ticks=$(printf '%s\n' "$proc_stats" | awk '{print $2}')
  case "$pgrp" in '' | *[!0-9]*) pgrp=$pid ;; esac
  case "$start_ticks" in '' | *[!0-9]*) start_ticks=0 ;; esac

  REG="$REG" OB_ID="$id" OB_NAME="$name" OB_SESSION="$session" \
    OB_PID="$pid" OB_PGRP="$pgrp" OB_STARTTICKS="$start_ticks" OB_CMD="$*" \
    OB_LOG="$log" OB_CWD="$(pwd -P)" python3 - <<'PY'
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
PY
  printf '{"ok":true,"id":"%s","name":"%s","pid":%s,"log":"%s"}\n' \
    "$id" "$name" "$pid" "$log"
  exit 0
fi

if [ "${1:-}" = "list" ]; then
  shift
  [ "$#" -le 1 ] || usage
  case "${1:-}" in
    "" | --json) ;;
    *) usage ;;
  esac
  REG="$REG" OB_JSON="${1:-}" python3 - <<'PY'
import glob, json, os, sys, time

reg = os.environ["REG"]
as_json = os.environ.get("OB_JSON") == "--json"
clk = os.sysconf("SC_CLK_TCK")


def sample(pid, want_start):
    try:
        with open(f"/proc/{pid}/stat", "rb") as fh:
            data = fh.read().decode("utf-8", "replace")
        tail = data[data.rfind(")") + 1 :].split()
        start = int(tail[19])
        if want_start is not None and start != want_start:
            return None
        cpu = (int(tail[11]) + int(tail[12])) / clk
    except (OSError, IndexError, ValueError):
        return None
    rss = None
    try:
        with open(f"/proc/{pid}/status") as fh:
            for line in fh:
                if line.startswith("VmRSS:"):
                    rss = int(line.split()[1]) * 1024
                    break
    except (OSError, ValueError, IndexError):
        pass
    return {"cpu": cpu, "rss": rss}


def uptime_text(seconds):
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m{seconds % 60:02d}s"
    if seconds < 86400:
        return f"{seconds // 3600}h{(seconds % 3600) // 60:02d}m"
    return f"{seconds // 86400}d{(seconds % 86400) // 3600:02d}h"


live = []
for path in sorted(glob.glob(os.path.join(reg, "*.json"))):
    try:
        with open(path) as fh:
            row = json.load(fh)
        pid = int(row["pid"])
        want = int(row["startTime"])
    except Exception:
        try:
            os.unlink(path)
        except OSError:
            pass
        continue
    first = sample(pid, want)
    if first is None:
        # Dead: drop the registry row; the captured log survives so the
        # reason a job died stays readable with `ob-process log`.
        try:
            os.unlink(path)
        except OSError:
            pass
        continue
    live.append((row, first))

# One shared window for the CPU delta, whatever the process count.
time.sleep(0.3)
still = []
for row, first in live:
    second = sample(int(row["pid"]), int(row["startTime"]))
    if second is None:
        try:
            os.unlink(
                os.path.join(reg, f"{row.get('id', '')}.json")
            )
        except OSError:
            pass
        continue
    still.append((row, first, second))

out = []
for row, first, second in still:
    cpu_pct = 0.0
    if second["cpu"] > first["cpu"]:
        cpu_pct = round((second["cpu"] - first["cpu"]) / 0.3 * 100, 1)
    started_at = row.get("startedAt", 0)
    out.append(
        {
            "id": row.get("id", ""),
            "name": row.get("name", "?"),
            "session": row.get("session", "unknown"),
            "pid": row.get("pid", 0),
            "cmd": row.get("cmd", ""),
            "startedAt": started_at,
            "uptimeSeconds": max(
                0, round(time.time() - (started_at or time.time() * 1000) / 1000)
            ),
            "cpuPercent": cpu_pct,
            "rssBytes": second["rss"],
            "cwd": row.get("cwd", ""),
        }
    )

if as_json:
    print(json.dumps(out))
else:
    print(
        f"{'ID':<12} {'NAME':<18} {'PID':>7} {'CPU%':>6} {'MEM':>9} "
        f"{'UP':>8}  CMD"
    )
    for row in out:
        mem = (
            "-"
            if row["rssBytes"] is None
            else f"{row['rssBytes'] / 1048576:.1f} MB"
        )
        cpu = "-" if row["cpuPercent"] is None else f"{row['cpuPercent']:.1f}"
        print(
            f"{row['id']:<12} {row['name'][:18]:<18} {row['pid']:>7} "
            f"{cpu:>6} {mem:>9} {uptime_text(row['uptimeSeconds']):>8}  "
            f"{row['cmd'][:60]}"
        )
PY
  exit 0
fi

if [ "${1:-}" = "log" ]; then
  shift
  id=${1:-}
  validate_id "$id"
  shift
  tail_n=50
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --tail)
        [ "$#" -ge 2 ] || usage
        tail_n=$2
        shift 2
        ;;
      --tail=*)
        tail_n=${1#--tail=}
        shift
        ;;
      *)
        usage
        ;;
    esac
  done
  case "$tail_n" in
    '' | *[!0-9]*) usage ;;
  esac
  [ "$tail_n" -ge 1 ] && [ "$tail_n" -le 500 ] || usage
  log="$REG/logs/$id.log"
  if [ ! -f "$log" ]; then
    echo "no log for $id (never started here, or the log was cleaned)" >&2
    exit 1
  fi
  tail -n "$tail_n" "$log"
  exit 0
fi

if [ "${1:-}" = "kill" ]; then
  [ "$#" -eq 2 ] || usage
  id=$2
  validate_id "$id"
  REG="$REG" OB_ID="$id" python3 - <<'PY'
import json, os, signal, sys, time

reg = os.environ["REG"]
row_path = os.path.join(reg, f"{os.environ['OB_ID']}.json")
try:
    with open(row_path) as fh:
        row = json.load(fh)
except Exception:
    # No registry row: either a bad id or a job that already exited (list
    # prunes dead rows but keeps their logs). Tell the two apart so the
    # caller can still read why the job died.
    log_path = os.path.join(reg, "logs", f"{os.environ['OB_ID']}.log")
    if os.path.exists(log_path):
        print(
            json.dumps(
                {
                    "ok": True,
                    "id": os.environ["OB_ID"],
                    "killed": False,
                    "exited": True,
                    "log": log_path,
                }
            )
        )
        print(
            f"job {os.environ['OB_ID']} already exited — "
            f"read its output with: ob-process log {os.environ['OB_ID']}",
            file=sys.stderr,
        )
    else:
        print(f"no managed process {os.environ['OB_ID']}", file=sys.stderr)
        raise SystemExit(1)
    raise SystemExit(0)

pid = int(row["pid"])
pgid = int(row.get("pgid", pid))
want = row.get("startTime")


def still_ours():
    try:
        with open(f"/proc/{pid}/stat", "rb") as fh:
            data = fh.read().decode("utf-8", "replace")
        tail = data[data.rfind(")") + 1 :].split()
        return int(tail[19]) == int(want) and int(tail[2]) == pgid
    except Exception:
        return False


killed = False
live = still_ours()
# Both outcomes retire the registry row: live means killed, dead means the
# job already exited (list would prune it on its next run anyway).
try:
    os.unlink(row_path)
except OSError:
    pass
if live:
    try:
        os.killpg(pgid, signal.SIGTERM)
    except OSError:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
    for _ in range(50):
        if not still_ours():
            killed = True
            break
        time.sleep(0.1)
    if still_ours():
        try:
            os.killpg(pgid, signal.SIGKILL)
        except OSError:
            pass
        for _ in range(20):
            if not still_ours():
                killed = True
                break
            time.sleep(0.1)
        killed = killed or not still_ours()
else:
    # The row survived but the job is gone: same answer as the pruned-row
    # path — the log tells the story.
    log_path = row.get("log") or os.path.join(
        reg, "logs", f"{os.environ['OB_ID']}.log"
    )
    where = row.get("cwd")
    print(
        json.dumps(
            {
                "ok": True,
                "id": os.environ["OB_ID"],
                "killed": False,
                "exited": True,
                "log": log_path,
            }
        )
    )
    print(
        f"job {os.environ['OB_ID']} already exited"
        + (f" (was started in {where})" if where else "")
        + f" — read its output with: ob-process log {os.environ['OB_ID']}",
        file=sys.stderr,
    )
    raise SystemExit(0)

print(json.dumps({"ok": True, "id": os.environ["OB_ID"], "killed": killed}))
PY
  exit 0
fi

usage
