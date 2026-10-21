#!/bin/sh
# ob-thread — start a new thread from inside the desktop container.
# Talks to the open-bot control plane; never prints the auth token.
# Without --display the thread is hidden (worker: title prefix): it stays off
# the dashboard and the media vault, for background jobs.
set -eu

BASE="${OPEN_BOT_CONTROL_URL:-http://open-bot:8787}"
TOKEN="${OPEN_BOT_LLM_TOKEN:?OPEN_BOT_LLM_TOKEN is not set}"

usage() {
  cat >&2 <<'EOF'
Usage:
  ob-thread start [--title TEXT] [--persona NAME] [--display] [--hidden] [--dir NAME] [--council NAME] [--role TEXT] [--from SESSION_ID] [--message TEXT]
  ob-thread list
  ob-thread read ID [N]
  ob-thread wait ID [--timeout MIN]
  ob-thread dirs
  ob-thread councils
  ob-thread council status NAME
  ob-thread council close NAME
  ob-thread delete ID [ID...] | --all
  ob-thread stop ID
  ob-thread post ID TEXT

start creates a thread. Without --display the thread is hidden for background
jobs: it does not appear on the dashboard and the media vault skips it.
--display makes it a normal visible thread. --message TEXT posts an initial
prompt into the thread right after creating it.

--dir NAME (or --topic NAME) files the new visible thread into a dashboard
folder, creating the folder if it does not exist. Folders only exist on the
dashboard, so --dir implies a visible thread and cannot be combined with
--hidden. Run `ob-thread dirs` first to reuse an existing folder name.

--persona NAME hands the thread to a personality: the thread answers as that
persona (team delegation). Typos in the name are tolerated and the output
tells you which persona matched. Persona threads are visible by default;
add --hidden for a background teammate. Check `ob-persona list` for names.

--council NAME adds the thread to a council (an agent team). Council members
are always hidden worker: threads; the user watches them in the dashboard
council viewer, so never combine --council with --display or --dir. Use a
short lowercase-kebab name (auth-review). --role TEXT labels the member's
job in the viewer rail ("Reviewer"). After starting the members, end your
reply with ![council: NAME](open-bot://council/NAME) so the viewer opens.

--from SESSION_ID (on councils and persona teammates) records which thread
the control plane should wake when the work finishes: pass your own session
id — the screen id in your system line. Without it the control plane guesses
the one busy chat; the start output tells you whether the wake is armed
("wake"). When the team finishes you get a [council: NAME] or [teammate]
message here — read the results and report; it is not a user reply.

list shows the hidden threads created through this tool.

read ID [N] prints the last N messages (default 6) of a thread you manage
(same scope as stop): role and text per message. Use it to read what a
council member or teammate wrote — one cheap call instead of the council
pane.

wait blocks until a thread you manage (same scope as stop) finishes its
current turn, polling every few seconds — the supported way to wait on a
teammate or council member from inside your own turn. --timeout MIN caps
the block (default 60, maximum 110 minutes, which stays under the
stuck-command watchdog budget this command is recognized by). It prints one
JSON line with the final state and exits 0 whether the thread went idle or
the timeout hit ("timeout": true tells them apart); transient control-plane
hiccups are tolerated. Prefer this over raw sleep loops — a plain command
held past ~15 minutes gets killed as stuck.

dirs lists the dashboard thread folders.

councils lists the councils and their member counts.

council status NAME prints each member's live idle/busy state and the tail
of its last reply — one call to read what the team produced after a wake-up.

council close NAME deletes every member thread of the council and removes
it. Run it when the team's work is done.

delete removes hidden threads by id (as shown by list). --all removes every
hidden agent thread. The server refuses anything that is not a hidden agent
thread — visible dashboard threads and cron jobs come back as skipped with
a reason.

stop aborts the current run of a thread you manage: your hidden worker:
threads and persona teammates. Use it to pull the brake on a delegation that
went sideways — the thread stays, only the running turn ends. The server
refuses plain user chats and cron jobs.

post sends a follow-up message into a thread you manage (same scope as
stop) — a correction, extra context, or a wrap-up instruction. The teammate
sees it as a new prompt.

Examples:
  ob-thread start --title "Nightly sync" --display
  ob-thread start --title "Scrape prices" --message "Scrape prices and save to /home/agent/workspace/prices.json"
  ob-thread start --persona "Software manager" --title "Add export" --message "Implement CSV export in ~/project/report-app"
  ob-thread start --title "Invoice follow-up" --dir "Billing" --display
  ob-thread start --council auth-review --from ses_YOURID --role Researcher --title "OAuth paths" --message "Map every OAuth path in ~/project/api"
  ob-thread start --council auth-review --from ses_YOURID --role Reviewer --title "Token storage" --message "Review token storage in ~/project/api"
  ob-thread councils
  ob-thread council status auth-review
  ob-thread read ses_member123 4
  ob-thread council close auth-review
  ob-thread dirs
  ob-thread list
  ob-thread wait ses_abc123 --timeout 30
  ob-thread delete ses_abc123
  ob-thread delete --all
  ob-thread stop ses_abc123
  ob-thread post ses_abc123 "Stop editing; report what you changed so far"
EOF
}

request() {
  method="$1"
  path="$2"
  body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" \
      -H "content-type: application/json" -d "$body" "$BASE$path"
  else
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" "$BASE$path"
  fi
}

urlencode() {
  printf '%s' "$1" | jq -sRr @uri
}

fail_on_error() {
  msg=$(printf '%s' "$1" | jq -r '.error // empty' 2>/dev/null) || msg=""
  if [ -n "$msg" ]; then
    echo "ob-thread: $msg" >&2
    sugg=$(printf '%s' "$1" | jq -r 'if (.suggestions // []) | length > 0 then (.suggestions | "ob-thread: did you mean: " + join(", ")) else empty end' 2>/dev/null) || sugg=""
    if [ -n "$sugg" ]; then
      echo "$sugg" >&2
    fi
    exit 1
  fi
}

[ $# -ge 1 ] || { usage; exit 2; }
cmd="$1"
shift

case "$cmd" in
  start)
    title=""
    message=""
    persona=""
    dir=""
    council=""
    role=""
    from=""
    display=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --title)
          [ $# -ge 2 ] || { usage; exit 2; }
          title="$2"; shift 2 ;;
        --message)
          [ $# -ge 2 ] || { usage; exit 2; }
          message="$2"; shift 2 ;;
        --persona)
          [ $# -ge 2 ] || { usage; exit 2; }
          persona="$2"; shift 2 ;;
        --dir|--topic)
          [ $# -ge 2 ] || { usage; exit 2; }
          dir="$2"; shift 2 ;;
        --council)
          [ $# -ge 2 ] || { usage; exit 2; }
          council="$2"; shift 2 ;;
        --role)
          [ $# -ge 2 ] || { usage; exit 2; }
          role="$2"; shift 2 ;;
        --from)
          [ $# -ge 2 ] || { usage; exit 2; }
          from="$2"; shift 2 ;;
        --display)
          display=1; shift ;;
        --hidden)
          display=0; shift ;;
        *)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    if [ -n "$dir" ] && [ "$display" = "0" ]; then
      echo "ob-thread: --dir applies to visible threads and cannot be combined with --hidden" >&2
      exit 2
    fi
    if [ -n "$council" ] && [ -n "$dir" ]; then
      echo "ob-thread: --council members are hidden and cannot be combined with --dir" >&2
      exit 2
    fi
    if [ -n "$council" ] && [ "$display" = "1" ]; then
      echo "ob-thread: --council members are hidden and cannot be combined with --display" >&2
      exit 2
    fi
    body="{}"
    if [ -n "$title" ]; then
      body=$(printf '%s' "$body" | jq --arg title "$title" '. + {title: $title}')
    fi
    visible="$display"
    if [ -z "$visible" ]; then
      if [ -n "$council" ]; then
        visible=0
      elif [ -n "$persona" ] || [ -n "$dir" ]; then visible=1; else visible=0; fi
    fi
    if [ "$visible" -eq 1 ]; then
      body=$(printf '%s' "$body" | jq '. + {display: true}')
    fi
    if [ -n "$persona" ]; then
      body=$(printf '%s' "$body" | jq --arg persona "$persona" '. + {persona: $persona}')
    fi
    if [ -n "$dir" ]; then
      body=$(printf '%s' "$body" | jq --arg dir "$dir" '. + {dir: $dir}')
    fi
    if [ -n "$council" ]; then
      body=$(printf '%s' "$body" | jq --arg council "$council" '. + {council: $council}')
    fi
    if [ -n "$role" ]; then
      body=$(printf '%s' "$body" | jq --arg role "$role" '. + {role: $role}')
    fi
    if [ -n "$message" ]; then
      body=$(printf '%s' "$body" | jq --arg message "$message" '. + {message: $message}')
    fi
    if [ -n "$from" ]; then
      body=$(printf '%s' "$body" | jq --arg from "$from" '. + {from: $from}')
    fi
    out=$(request POST /api/threads "$body")
    fail_on_error "$out"
    warning=$(printf '%s' "$out" | jq -r '.warning // empty' 2>/dev/null) || warning=""
    if [ -n "$warning" ]; then
      echo "ob-thread: $warning" >&2
    fi
    printf '%s' "$out" | jq '{id, title, display} + (if .persona then {persona: .persona} else {} end) + (if .dir then {dir: .dir} else {} end) + (if .council then {council: .council} else {} end) + (if .wake then {wake: .wake} else {} end)'
    ;;
  read)
    [ $# -ge 1 ] || { usage; exit 2; }
    id="$1"
    shift
    count="${1:-6}"
    case "$count" in
      ''|*[!0-9]*)
        echo "ob-thread: message count must be a whole number" >&2
        exit 2 ;;
    esac
    out=$(request GET "/api/opencode/session/$(urlencode "$id")/message")
    fail_on_error "$out"
    printf '%s' "$out" | jq -r --argjson n "$count" '
      if type != "array" then "(no messages)"
      else
        (.[-$n:] | map(
          . as $m |
          ([ $m.parts[]? | select(.type == "text") | .text ] | join("\n")) |
          if length == 0 then empty else "[\($m.info.role)] \(.)" end
        ) | join("\n\n"))
      end'
    ;;
  councils)
    out=$(request GET /api/councils)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r 'if (.councils | length) == 0 then "(no councils yet)" else .councils[] | "- \(.name) — \(.members) member(s)" end'
    ;;
  council)
    [ $# -ge 2 ] || { usage; exit 2; }
    sub="$1"
    shift
    case "$sub" in
      status)
        [ $# -ge 1 ] || { usage; exit 2; }
        name="$1"
        out=$(request GET "/api/councils/$(urlencode "$name")/status")
        fail_on_error "$out"
        printf '%s' "$out" | jq -r '
          if (.members | length) == 0 then "(no members)"
          else
            .members[] |
            "- [\(.sessionId)] \(if .role != "" then .role + " " else "" end)(\(.status)\(if .title != "" then " — " + .title else "" end))" +
            (if .lastReply != "" then "\n    " + (.lastReply | gsub("\n"; "\n    ") | .[0:280]) else "" end)
          end'
        ;;
      close)
        [ $# -ge 1 ] || { usage; exit 2; }
        name="$1"
        out=$(request DELETE "/api/councils/$name")
        fail_on_error "$out"
        deleted=$(printf '%s' "$out" | jq -r '.deleted | length')
        if [ "$deleted" -gt 0 ]; then
          printf '%s' "$out" | jq -r '"deleted: " + (.deleted | join(", "))'
        fi
        printf '%s' "$out" | jq -r '.skipped[] | "skipped [\(.sessionId)]: \(.reason)"'
        if [ "$deleted" -eq 0 ]; then
          echo "ob-thread: nothing deleted; the council is kept for a retry" >&2
          exit 1
        fi
        if [ "$(printf '%s' "$out" | jq -r '.skipped | length')" -eq 0 ]; then
          echo "council $name closed"
        else
          echo "council $name partially closed; remaining members are still tracked"
        fi
        ;;
      *)
        echo "unknown council command: $sub" >&2; usage; exit 2 ;;
    esac
    ;;
  dirs)
    out=$(request GET /api/thread-dirs)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r 'if (.dirs | length) == 0 then "(no folders yet)" else .dirs[] | "- [\(.id)] \(.name)" end'
    ;;
  list)
    out=$(request GET /api/threads)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '.threads[] | "- [\(.id)] \(.title)"'
    ;;
  wait)
    [ $# -ge 1 ] || { usage; exit 2; }
    id="$1"
    shift
    timeout_min=60
    while [ $# -gt 0 ]; do
      case "$1" in
        --timeout)
          [ $# -ge 2 ] || { usage; exit 2; }
          timeout_min="$2"; shift 2 ;;
        -h|--help)
          usage; exit 0 ;;
        *)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    case "$timeout_min" in
      ''|*[!0-9]*)
        echo "ob-thread: --timeout must be a whole number of minutes" >&2
        exit 2 ;;
    esac
    if [ "$timeout_min" -lt 1 ] || [ "$timeout_min" -gt 110 ]; then
      echo "ob-thread: --timeout is limited to 1-110 minutes" >&2
      exit 2
    fi
    started=$(date +%s)
    deadline=$(( started + timeout_min * 60 ))
    errors=0
    while :; do
      out=$(request GET "/api/threads/$(urlencode "$id")/status" 2>/dev/null) || out=""
      state=""
      if [ -n "$out" ]; then
        state=$(printf '%s' "$out" | jq -r '.state // empty' 2>/dev/null) || state=""
        if [ -z "$state" ]; then
          # A booting desktop transiently answers "desktop is not running";
          # the next poll succeeds, so ride the same retry budget as hiccups.
          errmsg=$(printf '%s' "$out" | jq -r '.error // empty' 2>/dev/null) || errmsg=""
          case "$errmsg" in
            "desktop is not running"|"desktop is not reachable") ;;
            *) fail_on_error "$out" ;;
          esac
        fi
      fi
      if [ -n "$state" ]; then
        errors=0
        now=$(date +%s)
        if [ "$state" != "busy" ] && [ "$state" != "starting" ]; then
          printf '%s' "$out" | jq --argjson waited "$((now - started))" \
            '. + {waitedSeconds: $waited, timeout: false}'
          exit 0
        fi
        if [ "$now" -ge "$deadline" ]; then
          printf '%s' "$out" | jq --argjson waited "$((now - started))" \
            '. + {waitedSeconds: $waited, timeout: true}'
          exit 0
        fi
      else
        errors=$(( errors + 1 ))
        if [ "$errors" -ge 12 ]; then
          echo "ob-thread: status check keeps failing" >&2
          exit 1
        fi
      fi
      sleep 5
    done
    ;;
  delete)
    ids=""
    all=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --all)
          all=1; shift ;;
        -h|--help)
          usage; exit 0 ;;
        --*)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
        *)
          if [ -z "$ids" ]; then ids="$1"; else ids="$ids
$1"; fi
          shift ;;
      esac
    done
    if [ -n "$all" ]; then
      out=$(request GET /api/threads)
      fail_on_error "$out"
      ids=$(printf '%s' "$out" | jq -r '.threads[].id // empty' 2>/dev/null) || ids=""
      if [ -z "$ids" ]; then
        echo "ob-thread: nothing to delete" >&2
        exit 1
      fi
    elif [ -z "$ids" ]; then
      usage
      exit 2
    fi
    body=$(printf '%s' "$ids" | jq -R . | jq -s '{ids: .}')
    out=$(request DELETE /api/threads "$body")
    fail_on_error "$out"
    deleted=$(printf '%s' "$out" | jq -r '.deleted | length')
    if [ "$deleted" -gt 0 ]; then
      printf '%s' "$out" | jq -r '"deleted: " + (.deleted | join(", "))'
    fi
    printf '%s' "$out" | jq -r '.skipped[] | "skipped [\(.id)]: \(.reason)"'
    if [ "$deleted" -eq 0 ]; then
      exit 1
    fi
    ;;
  stop)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request POST "/api/threads/$(urlencode "$1")/stop")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{id, stopped}'
    ;;
  post)
    [ $# -ge 2 ] || { usage; exit 2; }
    id="$1"
    shift
    text="$*"
    body=$(jq -n --arg message "$text" '{message: $message}')
    out=$(request POST "/api/threads/$(urlencode "$id")/post" "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{id, posted}'
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2; usage; exit 2
    ;;
esac
