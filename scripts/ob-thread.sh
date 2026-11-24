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
  ob-thread start [--title TEXT] [--persona NAME] [--model PROVIDER/MODEL] [--effort LEVEL] [--display] [--hidden] [--dir NAME] [--council NAME] [--role TEXT] [--from SESSION_ID] [--steps unlimited] [--message TEXT] [--sandbox PROFILE] [--copy-in PATH]... [--standalone]
  ob-thread sandbox-profiles
  ob-thread sandbox-export SANDBOX_ID
  ob-thread models
  ob-thread list
  ob-thread read ID [N]
  ob-thread wait ID [--timeout MIN]
  ob-thread dirs
  ob-thread councils
  ob-thread council status NAME
  ob-thread council close NAME [--force]
  ob-thread delete ID [ID...] | --all
  ob-thread stop ID
  ob-thread post ID [--model PROVIDER/MODEL|default] [--effort LEVEL|default] TEXT
  ob-thread parent ID
  ob-thread notify-parent ID TEXT
  ob-thread relay HANDLE TEXT
  ob-thread model ID [--model PROVIDER/MODEL|default] [--effort LEVEL|default]

start creates a thread. Council-first rule: work you start yourself —
helpers, background jobs, persona teammates, detached long jobs — runs as
council members (--council NAME; a one-member council is fine), so the
dashboard thread list stays the user's own conversations and every team is
watchable and closable in one pane. A start with none of --council,
--sandbox, or --standalone is refused here and by the control plane.
--standalone is the user-asked bypass below. Without --display a standalone
thread is hidden for background jobs: it does not appear on the dashboard
and the media vault skips it. --display makes it a normal visible thread.
--message TEXT posts an initial prompt into the thread right after creating
it.

--sandbox PROFILE runs the thread in a disposable sandbox container for
UNTRUSTED prompts (text pasted from the web, a stranger's instructions, an
unvetted document): only the profile's skills/MCP servers/tools exist there,
it starts from an empty /workspace, and it cannot reach this desktop, its
files, keys, memory, or other threads. Built-in profiles: locked (no bash,
no network) and code (bash, no network); `ob-thread sandbox-profiles` lists
the user's custom ones. Sandbox threads are visible by default and expire
after the profile's TTL — deleting the thread destroys the container.
--copy-in PATH (repeatable) copies a desktop file/folder into the sandbox
workspace first; results come back only through `ob-thread read` or an
explicit `ob-thread sandbox-export SANDBOX_ID` (lands in
~/workspace/sandbox-<id>/). --sandbox refuses --council/--dir/--from/
--steps/--effort, and --model takes chat/small (instance models) or
PROVIDER/MODEL (openai, xai, openrouter, google — brokered with the
user's vault key, which never enters the container).
A sandbox thread gets no delegation wake: use `ob-thread wait` + `read`.

--dir NAME (or --topic NAME) files the new visible thread into a dashboard
folder, creating the folder if it does not exist. Folders only exist on the
dashboard, so --dir implies a visible thread and cannot be combined with
--hidden. Run `ob-thread dirs` first to reuse an existing folder name.

--persona NAME hands the thread to a personality: the thread answers as that
persona (team delegation). Typos in the name are tolerated and the output
tells you which persona matched. Delegation runs as a council member
(--council NAME --persona ...); only a standalone persona thread is visible
by default (add --hidden for a background teammate). Check `ob-persona list`
for names.

--standalone starts a loose thread outside any council. Use it ONLY when the
user explicitly asked for a separate or new thread (typically with
--display, optionally --dir) — never for work you delegated on your own
initiative, and never to work around a council refusal.

--council NAME adds the thread to a council (an agent team). Council members
are always hidden worker: threads; the user watches them in the dashboard
council viewer, so never combine --council with --display or --dir. Use a
short lowercase-kebab name (auth-review). --role TEXT labels the member's
job in the viewer rail ("Reviewer"). After starting the members, end your
reply with ![council: NAME](open-bot://council/NAME) so the viewer opens.
One thread can run several councils at once — start each team under its own
name (same --from) and put one marker per council in the reply; the user
also gets a floating Councils button in the thread listing every team.
Each council wakes you separately when its own members are all done.

--model PROVIDER/MODEL picks the model this thread runs on, and --effort
LEVEL its reasoning effort (the model's variant names — `ob-thread models`
lists connected models with their levels). Both are per-thread: on a
council, give each member its own pick (a cheap fast model for the
researcher, a deep reasoner at high effort for the reviewer) and combine
freely with --persona. Omit them to inherit the desktop default model and
saved effort. An unknown model or a level the model does not offer is
refused before anything is created. Follow-ups (`ob-thread post`) keep the
same pick unless the post itself carries new --model/--effort flags (see
`ob-thread model` below), and the council viewer shows each member's
persona/model/effort.

models lists the connected models and the effort levels each one offers.

--from SESSION_ID (on councils and persona teammates) records which thread
the control plane should wake when the work finishes: pass your own session
id — the screen id in your system line. Without it the control plane guesses
the one busy chat; the start output tells you whether the wake is armed
("wake"). When the team finishes you get a [council: NAME] or [teammate]
message here — read the results and report; it is not a user reply.

--steps unlimited removes the agent step cap for this thread. Every agent
run stops after 256 steps; a long job that gets cut there ends mid-task.
Pass --steps unlimited on jobs you expect to run long — big builds, deep
research, multi-phase council members. A cut turn cannot resume itself, so
decide before you start, not after.

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
it. Run it when the team's work is done. Close refuses while a member is
still running; --force closes anyway.

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
sees it as a new prompt. The model flags go before the text (use `--` when
the text itself starts with a flag).

relay delivers TEXT to the one ordinary dashboard chat named by an expiring
relay HANDLE. The user mints that handle from the target chat's dashboard
menu; it can prompt only that chat, cannot read it or reach any other chat,
and is consumed by successful delivery. Use a handle only for the exact
voice/user-authorized delivery it was handed to you for. A retry with the
same handle and same text is deduplicated.

A thread's model can be hot-switched at any time — the model is picked per
turn, so the change applies from the thread's next turn and a turn already
running finishes on its own model. History and context are preserved; never
recreate a thread just to change its model. Two ways to switch:

- `ob-thread post ID --model P/M [--effort LEVEL] TEXT` switches and sends
  the follow-up on the new model in one call.
- `ob-thread model ID --model P/M [--effort LEVEL]` only changes the pick;
  it takes effect on the next message anyone posts. With no flags,
  `ob-thread model ID` prints the current effective model/effort and which
  halves are pinned to this thread (`thread`) versus inherited.

Each flag is independent: omitting one keeps that half, `default` clears
that half back to the desktop default. Switching to a model that does not
offer the thread's pinned effort drops the effort pin (reported as
`effortDropped`); an effort you pass explicitly that the model does not
offer is refused with the available levels, and nothing is posted or
stored. Typical use: a teammate started on a cheap fast model gets stuck
or reaches the hard part — switch it to a deep reasoner mid-task, or back
down when the remaining work is mechanical.

Examples:
  ob-thread start --sandbox locked --title "Untrusted paste" --message "Summarize the pasted text that follows"
  ob-thread start --standalone --title "Nightly sync" --display
  ob-thread start --council scrape-prices --from ses_YOURID --title "Scrape prices" --message "Scrape prices and save to /home/agent/workspace/prices.json"
  ob-thread start --council add-export --from ses_YOURID --persona "Software manager" --title "Add export" --message "Implement CSV export in ~/project/report-app"
  ob-thread start --standalone --title "Invoice follow-up" --dir "Billing" --display
  ob-thread start --council auth-review --from ses_YOURID --role Researcher --model grok/grok-4.5 --title "OAuth paths" --message "Map every OAuth path in ~/project/api"
  ob-thread start --council auth-review --from ses_YOURID --role Reviewer --persona "Software manager" --model openai/gpt-5 --effort high --steps unlimited --title "Token storage" --message "Review token storage in ~/project/api"
  ob-thread models
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
  ob-thread relay obr_HANDLE "Voice transcript is ready"
  ob-thread post ses_abc123 --model openai/gpt-5 --effort high "Now the hard part: redesign the token cache"
  ob-thread model ses_abc123
  ob-thread model ses_abc123 --model default --effort default
EOF
}

request() {
  method="$1"
  path="$2"
  body="${3:-}"
  # REQ_MAX_TIME bounds the call (#141): delivery verbs set it past the
  # control plane's own 30s prompt timeout, so the caller always gets a
  # receipt — its 502, or the explicit unconfirmed error below — instead of
  # hanging until the outer tool timeout kills it with no output at all.
  req_rc=0
  if [ -n "${REQ_MAX_TIME:-}" ]; then
    set -- --connect-timeout 5 --max-time "$REQ_MAX_TIME"
  else
    set --
  fi
  if [ -n "$body" ]; then
    req_out=$(curl -sS "$@" -X "$method" -H "Authorization: Bearer $TOKEN" \
      -H "content-type: application/json" -d "$body" "$BASE$path") || req_rc=$?
  else
    req_out=$(curl -sS "$@" -X "$method" -H "Authorization: Bearer $TOKEN" "$BASE$path") || req_rc=$?
  fi
  if [ "$req_rc" -ne 0 ]; then
    printf '{"error":"request to control plane failed or timed out (curl %s) — result NOT confirmed; verify with ob-thread read/status before retrying (a retry of post/notify-parent/relay with the same text is deduplicated)"}' "$req_rc"
    return 0
  fi
  printf '%s' "$req_out"
}

# Deterministic per-delivery id (#141): the same target+text hashes to the
# same id, so a retry after an unconfirmed timeout is a no-op receipt on the
# control plane instead of a duplicated prompt. Empty when sha256sum is
# unavailable — dedupe is best effort, delivery itself never depends on it.
dedupe_id() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s\n%s' "$1" "$2" | sha256sum | cut -d' ' -f1
  fi
}

jq_dedupe() {
  if [ -n "$1" ]; then
    jq --arg dedupeId "$1" '. + {dedupeId: $dedupeId}'
  else
    cat
  fi
}

urlencode() {
  printf '%s' "$1" | jq -sRr @uri
}

# A --model flag value on post/model: provider/model, or "default" to clear
# the thread's pin back to the desktop default.
check_model_flag() {
  case "$1" in
    default|?*/?*) ;;
    *)
      echo "ob-thread: --model must be provider/model or default (run \`ob-thread models\`)" >&2
      exit 2 ;;
  esac
}

# Adds one model-update half to a JSON body on stdin: an empty value leaves
# the half out (keep), "default" sends null (clear), anything else the value.
jq_model_half() {
  field="$1"
  value="$2"
  if [ -z "$value" ]; then
    cat
  elif [ "$value" = "default" ]; then
    jq --arg field "$field" '. + {($field): null}'
  else
    jq --arg field "$field" --arg value "$value" '. + {($field): $value}'
  fi
}

# Surfaces a dropped carried-over effort pin on stderr; stdout stays JSON.
warn_effort_dropped() {
  dropped=$(printf '%s' "$1" | jq -r '.effortDropped // empty' 2>/dev/null) || dropped=""
  if [ -n "$dropped" ]; then
    echo "ob-thread: the pinned effort \"$dropped\" is not offered by the new model and was dropped (desktop default applies)" >&2
  fi
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

# A desktop mid-boot or mid-restart transiently answers "desktop is not
# running"/"not reachable" even though the caller lives on it. Retry a couple
# of times before giving up so a phase-detection race does not kill a batch
# script; any other error (or the final failure) is returned untouched.
request_retry_transient() {
  method="$1"
  path="$2"
  body="${3:-}"
  attempt=0
  while :; do
    out=$(request "$method" "$path" "$body")
    errmsg=$(printf '%s' "$out" | jq -r '.error // empty' 2>/dev/null) || errmsg=""
    case "$errmsg" in
      "desktop is not running" | "desktop is not reachable")
        attempt=$(( attempt + 1 ))
        if [ "$attempt" -ge 3 ]; then
          printf '%s' "$out"
          return
        fi
        sleep 2
        ;;
      *)
        printf '%s' "$out"
        return
        ;;
    esac
  done
}

[ $# -ge 1 ] || { usage; exit 2; }
cmd="$1"
shift

case "$cmd" in
  start)
    title=""
    message=""
    persona=""
    model=""
    effort=""
    dir=""
    council=""
    role=""
    from=""
    display=""
    steps=""
    sandbox=""
    standalone=""
    copyin=""
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
        --model)
          [ $# -ge 2 ] || { usage; exit 2; }
          model="$2"; shift 2 ;;
        --effort)
          [ $# -ge 2 ] || { usage; exit 2; }
          effort="$2"; shift 2 ;;
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
        --steps)
          [ $# -ge 2 ] || { usage; exit 2; }
          steps="$2"; shift 2 ;;
        --sandbox)
          [ $# -ge 2 ] || { usage; exit 2; }
          sandbox="$2"; shift 2 ;;
        --copy-in)
          [ $# -ge 2 ] || { usage; exit 2; }
          copyin="$copyin$2
"; shift 2 ;;
        --display)
          display=1; shift ;;
        --hidden)
          display=0; shift ;;
        --standalone)
          standalone=1; shift ;;
        *)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    if [ -n "$sandbox" ]; then
      case "$model" in
        chat|small) model="open-bot-sandbox/$model" ;;
      esac
    fi
    if [ -n "$steps" ] && [ "$steps" != "unlimited" ]; then
      echo "ob-thread: --steps only accepts unlimited" >&2
      exit 2
    fi
    if [ -n "$model" ]; then
      case "$model" in
        ?*/?*) ;;
        *)
          echo "ob-thread: --model must be provider/model (run \`ob-thread models\`)" >&2
          exit 2 ;;
      esac
    fi
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
    if [ -n "$standalone" ] && [ -n "$council" ]; then
      echo "ob-thread: --standalone cannot be combined with --council" >&2
      exit 2
    fi
    if [ -n "$standalone" ] && [ -n "$sandbox" ]; then
      echo "ob-thread: --standalone cannot be combined with --sandbox" >&2
      exit 2
    fi
    if [ -z "$council" ] && [ -z "$sandbox" ] && [ -z "$standalone" ]; then
      echo "ob-thread: agent-started work runs in a council — pass --council NAME (a one-member council is fine), --sandbox PROFILE for untrusted work, or --standalone only when the user explicitly asked for a separate thread" >&2
      exit 2
    fi
    if [ -n "$sandbox" ]; then
      if [ -n "$council" ] || [ -n "$dir" ] || [ -n "$from" ] || [ -n "$steps" ] || [ -n "$effort" ]; then
        echo "ob-thread: --sandbox cannot be combined with --council/--dir/--from/--steps/--effort" >&2
        exit 2
      fi
      # chat/small ride the instance models; a provider/model ref is
      # brokered keylessly through the user's vault (validated at launch
      # by the control plane, which names the fix when the key is gone).
      case "$model" in
        ""|chat|small|open-bot-sandbox/chat|open-bot-sandbox/small) ;;
        ?*/?*) ;;
        *)
          echo "ob-thread: --model must be chat, small, or provider/model (openai/xai/openrouter/google, vault-brokered)" >&2
          exit 2 ;;
      esac
    elif [ -n "$copyin" ]; then
      echo "ob-thread: --copy-in only applies to --sandbox" >&2
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
      elif [ -n "$persona" ] || [ -n "$dir" ] || [ -n "$sandbox" ]; then visible=1; else visible=0; fi
    fi
    if [ "$visible" -eq 1 ]; then
      body=$(printf '%s' "$body" | jq '. + {display: true}')
    fi
    if [ -n "$persona" ]; then
      body=$(printf '%s' "$body" | jq --arg persona "$persona" '. + {persona: $persona}')
    fi
    if [ -n "$model" ]; then
      body=$(printf '%s' "$body" | jq --arg model "$model" '. + {model: $model}')
    fi
    if [ -n "$effort" ]; then
      body=$(printf '%s' "$body" | jq --arg effort "$effort" '. + {effort: $effort}')
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
    if [ -n "$steps" ]; then
      body=$(printf '%s' "$body" | jq '. + {steps: "unlimited"}')
    fi
    if [ -n "$sandbox" ]; then
      body=$(printf '%s' "$body" | jq --arg sandbox "$sandbox" '. + {sandbox: $sandbox}')
    fi
    if [ -n "$standalone" ]; then
      body=$(printf '%s' "$body" | jq '. + {standalone: true}')
    fi
    if [ -n "$copyin" ]; then
      copyin_json=$(printf '%s' "$copyin" | jq -Rsc 'split("\n") | map(select(length > 0))')
      body=$(printf '%s' "$body" | jq --argjson copyIn "$copyin_json" '. + {copyIn: $copyIn}')
    fi
    out=$(request_retry_transient POST /api/threads "$body")
    fail_on_error "$out"
    warning=$(printf '%s' "$out" | jq -r '.warning // empty' 2>/dev/null) || warning=""
    if [ -n "$warning" ]; then
      echo "ob-thread: $warning" >&2
    fi
    printf '%s' "$out" | jq '{id, title, display} + (if .persona then {persona: .persona} else {} end) + (if .model then {model: .model} else {} end) + (if .effort then {effort: .effort} else {} end) + (if .dir then {dir: .dir} else {} end) + (if .council then {council: .council} else {} end) + (if .standalone then {standalone: .standalone} else {} end) + (if .wake then {wake: .wake} else {} end) + (if .sandbox then {sandbox: .sandbox} else {} end)'
    ;;
  sandbox-profiles)
    out=$(request GET /api/sandbox-profiles)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '.profiles[] | "\(.name)\(if .builtin then " (built-in)" else "" end) skills=\(.profile.skills | length) mcp=\(.profile.mcp | length) bash=\(.profile.tools.bash) network=\(.profile.network)"'
    ;;
  sandbox-export)
    [ $# -ge 1 ] || { usage; exit 2; }
    out=$(request POST "/api/sandbox/$(urlencode "$1")/export-to-desktop" "{}")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{path}'
    ;;
  models)
    out=$(request GET /api/cron/models)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '.models[] | "\(.providerID)/\(.modelID)\(if .name then "  \(.name)" else "" end)\(if (.variants // []) | length > 0 then "  [efforts: \(.variants | join(", "))]" else "" end)"'
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
    out=$(request_retry_transient GET "/api/opencode/session/$(urlencode "$id")/message")
    fail_on_error "$out"
    # Filter to text-bearing messages BEFORE taking the last N: a busy
    # teammate mid tool-loop has text-less last entries, and slicing first
    # printed a successful empty page (#106).
    printf '%s' "$out" | jq -r --argjson n "$count" '
      if type != "array" then "(no messages)"
      else
        (map(
          . as $m |
          ([ $m.parts[]? | select(.type == "text") | .text ] | join("\n")) as $text |
          select($text | length > 0) | "[\($m.info.role)] \($text)"
        )) as $visible |
        if ($visible | length) == 0
        then "(no text messages yet — recent activity is tool calls only; the thread may still be working, check ob-thread wait)"
        else ($visible[-$n:] | join("\n\n")) + (if ($visible | length) < length then "\n\n(showing the last \($visible[-$n:] | length) visible of \(length) message(s); tool-only entries hidden)" else "" end)
        end
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
          if .desktop and .desktop.running == false then
            "desktop is down" +
            (if .desktop.oomKilled then " (OOM-killed — check memory: fewer members, fewer browser tabs, capped build jobs)" else "" end) +
            "\n" + "revive the desktop, then rerun the council"
          elif (.members | length) == 0 then "(no members)"
          else
            (.statusVerified != false) as $verified |
            .members[] |
            "- [\(.sessionId)] \(if .role != "" then .role + " " else "" end)(\(if .status == "unknown" and $verified == false then "unknown — could not verify" else .status end)\(if .title != "" then " — " + .title else "" end))" +
            (if ([(.persona // ""), (.model // ""), (.effort // "")] | map(select(. != "")) | length) > 0 then " [" + ([(.persona // ""), (.model // ""), (.effort // "")] | map(select(. != "")) | join(" · ")) + "]" else "" end) +
            (if .stalled then "\n    STALLED: last turn did not end cleanly (\(.endDetail // .endState)) — verify deliverables, relaunch with ob-thread post" else "" end) +
            (if .lastReply != "" then "\n    " + (.lastReply | gsub("\n"; "\n    ") | .[0:280]) else "" end)
          end'
        ;;
      close)
        force=""
        name=""
        for arg in "$@"; do
          case "$arg" in
            --force) force=1 ;;
            *) name="$arg" ;;
          esac
        done
        [ -n "$name" ] || { usage; exit 2; }
        # Closing deletes every member thread — refuse while one is still
        # working so unfinished work is not silently lost.
        status_out=$(request GET "/api/councils/$(urlencode "$name")/status" 2>/dev/null) || status_out=""
        # `unknown` is "could not verify" (#139), never confirmed running
        # work. Only a verified non-idle, non-unknown state is busy.
        busy=$(printf '%s' "$status_out" | jq -r '[.members[]? | select(.status != "idle" and .status != "unknown")] | length' 2>/dev/null) || busy=""
        unverified=$(printf '%s' "$status_out" | jq -r 'if .statusVerified == false then ([.members[]? | select(.status == "unknown")] | length) else 0 end' 2>/dev/null) || unverified=""
        if [ -z "$force" ] && [ -n "$busy" ] && [ "$busy" -gt 0 ]; then
          echo "ob-thread: $busy member(s) of $name are still running — check \`ob-thread council status $name\`, wait for them to finish, or pass --force to close anyway" >&2
          printf '%s' "$status_out" | jq -r '.members[]? | select(.status != "idle" and .status != "unknown") | "  - [\(.sessionId)] \(if .role != "" then .role + " " else "" end)(\(.status))"' >&2
          exit 1
        fi
        if [ -z "$force" ] && [ -n "$unverified" ] && [ "$unverified" -gt 0 ]; then
          echo "ob-thread: could not verify $unverified member(s) of $name (status unknown) — that is not confirmed running work; retry \`ob-thread council status $name\` in a moment, or pass --force to close anyway" >&2
          exit 1
        fi
        out=$(request DELETE "/api/councils/$(urlencode "$name")")
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
  parent)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request GET /api/threads)
    fail_on_error "$out"
    parent_id=$(printf '%s' "$out" | jq -r --arg id "$1" '.threads[] | select(.id == $id) | .creatorSessionId // empty')
    if [ -n "$parent_id" ]; then
      printf '%s\n' "$parent_id"
    else
      echo "no delegating thread recorded for $1" >&2
      exit 1
    fi
    ;;
  notify-parent)
    [ $# -ge 2 ] || { usage; exit 2; }
    id="$1"
    shift
    text="$*"
    body=$(jq -n --arg message "$text" '{message: $message}' | jq_dedupe "$(dedupe_id "$id" "$text")")
    out=$(REQ_MAX_TIME=45 request_retry_transient POST "/api/threads/$(urlencode "$id")/notify-parent" "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{id, parent, notified} + (if .deduplicated then {deduplicated: .deduplicated} else {} end)'
    ;;
  relay)
    [ $# -ge 2 ] || { usage; exit 2; }
    handle="$1"
    shift
    text="$*"
    body=$(jq -n --arg token "$handle" --arg message "$text" '{token: $token, message: $message}' | jq_dedupe "$(dedupe_id "$handle" "$text")")
    out=$(REQ_MAX_TIME=45 request_retry_transient POST "/api/thread-relay" "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{targetSessionId, delivered, remainingUses} + (if .deduplicated then {deduplicated: .deduplicated} else {} end)'
    ;;
  post)
    [ $# -ge 2 ] || { usage; exit 2; }
    id="$1"
    shift
    model=""
    effort=""
    # Flags come before the text; the first non-flag word (or --) starts it,
    # so message text may itself contain --model later on.
    while [ $# -gt 0 ]; do
      case "$1" in
        --model)
          [ $# -ge 2 ] || { usage; exit 2; }
          model="$2"; shift 2 ;;
        --effort)
          [ $# -ge 2 ] || { usage; exit 2; }
          effort="$2"; shift 2 ;;
        --)
          shift; break ;;
        --*)
          echo "unknown option: $1 (flags go before the text; use -- when the text starts with a flag)" >&2; usage; exit 2 ;;
        *)
          break ;;
      esac
    done
    [ $# -ge 1 ] || { usage; exit 2; }
    if [ -n "$model" ]; then
      check_model_flag "$model"
    fi
    text="$*"
    body=$(jq -n --arg message "$text" '{message: $message}' | jq_model_half model "$model" | jq_model_half effort "$effort" | jq_dedupe "$(dedupe_id "$id" "$text")")
    out=$(REQ_MAX_TIME=45 request_retry_transient POST "/api/threads/$(urlencode "$id")/post" "$body")
    fail_on_error "$out"
    warn_effort_dropped "$out"
    printf '%s' "$out" | jq '{id, posted} + (if .deduplicated then {deduplicated: .deduplicated} else {} end) + (if .model then {model: .model} else {} end) + (if .effort then {effort: .effort} else {} end) + (if .effortDropped then {effortDropped: .effortDropped} else {} end)'
    ;;
  model)
    [ $# -ge 1 ] || { usage; exit 2; }
    id="$1"
    shift
    model=""
    effort=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --model)
          [ $# -ge 2 ] || { usage; exit 2; }
          model="$2"; shift 2 ;;
        --effort)
          [ $# -ge 2 ] || { usage; exit 2; }
          effort="$2"; shift 2 ;;
        *)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    if [ -n "$model" ]; then
      check_model_flag "$model"
    fi
    if [ -z "$model" ] && [ -z "$effort" ]; then
      out=$(request GET "/api/threads/$(urlencode "$id")/model")
    else
      body=$(printf '{}' | jq_model_half model "$model" | jq_model_half effort "$effort")
      out=$(request_retry_transient POST "/api/threads/$(urlencode "$id")/model" "$body")
    fi
    fail_on_error "$out"
    warn_effort_dropped "$out"
    printf '%s' "$out" | jq '{id, model, effort, thread} + (if .effortDropped then {effortDropped: .effortDropped} else {} end)'
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2; usage; exit 2
    ;;
esac
