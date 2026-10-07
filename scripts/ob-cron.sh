#!/bin/sh
# ob-cron — manage scheduled agent jobs from inside the desktop container.
# Talks to the open-bot control plane; never prints the auth token.
set -eu

BASE="${OPEN_BOT_CONTROL_URL:-http://open-bot:8787}"
TOKEN="${OPEN_BOT_LLM_TOKEN:?OPEN_BOT_LLM_TOKEN is not set}"

usage() {
  cat >&2 <<'EOF'
Usage:
  ob-cron add --name NAME (--message TEXT | --script TEXT | both) (--every SECONDS | --cron "M H DOM MON DOW" | --at ISO8601) [--model PROVIDER/MODEL] [--persona ID]
  ob-cron list
  ob-cron models
  ob-cron set ID [--run prompt|script|both] [--script TEXT | --clear-script] [--model PROVIDER/MODEL | --clear-model] [--persona ID | --clear-persona] [--name NAME] [--message TEXT]
  ob-cron remove ID
  ob-cron run ID

Schedules (exactly one on add):
  --every SECONDS   recurring interval, minimum 60
  --cron "EXPR"     5-field UTC cron expression, e.g. "0 9 * * 1-5"
  --at ISO8601      one-shot run, e.g. 2026-12-01T09:00:00Z

Run options:
  --message TEXT           prompt for the agent. Alone, the job is a prompt.
  --script TEXT            shell command run as you in /home/agent/workspace. Alone, its output is the result.
                           With --message, the output is added to the prompt and the agent's result is stored.
  --model PROVIDER/MODEL   model for the temporary run. Omit to use the desktop default. Ignored for script-only jobs.
  --persona ID             personality that runs the job. Omit for Assistant. Applies only to the temporary run.

Examples:
  ob-cron add --name standup --message "Summarize git log since yesterday" --cron "0 13 * * 1-5" --model grok/grok-4.5 --persona designer
  ob-cron add --name disk --script "df -h" --every 3600
  ob-cron add --name digest --script "git -C /home/agent/workspace log -1 --oneline" --message "Summarize this and say if anything needs attention" --cron "0 13 * * 1-5"
  ob-cron models
  ob-cron set 3f2b... --run script --script "df -h"
  ob-cron set 3f2b... --clear-model --persona assistant
  ob-cron list
  ob-cron remove 3f2b...
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

fail_on_error() {
  msg=$(printf '%s' "$1" | jq -r '.error // empty' 2>/dev/null) || msg=""
  if [ -n "$msg" ]; then
    echo "ob-cron: $msg" >&2
    exit 1
  fi
}

urlencode() {
  printf '%s' "$1" | jq -sRr @uri
}

split_model() {
  model="$1"
  provider=${model%%/*}
  modelid=${model#*/}
  if [ -z "$provider" ] || [ -z "$modelid" ] || [ "$provider" = "$model" ]; then
    echo "ob-cron: --model must be provider/model" >&2
    exit 2
  fi
}

[ $# -ge 1 ] || { usage; exit 2; }
cmd="$1"
shift

case "$cmd" in
  add)
    name=""
    message=""
    script=""
    every=""
    cron=""
    at=""
    model=""
    persona=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --name)
          [ $# -ge 2 ] || { usage; exit 2; }
          name="$2"; shift 2 ;;
        --message)
          [ $# -ge 2 ] || { usage; exit 2; }
          message="$2"; shift 2 ;;
        --script)
          [ $# -ge 2 ] || { usage; exit 2; }
          script="$2"; shift 2 ;;
        --every)
          [ $# -ge 2 ] || { usage; exit 2; }
          every="$2"; shift 2 ;;
        --cron)
          [ $# -ge 2 ] || { usage; exit 2; }
          cron="$2"; shift 2 ;;
        --at)
          [ $# -ge 2 ] || { usage; exit 2; }
          at="$2"; shift 2 ;;
        --model)
          [ $# -ge 2 ] || { usage; exit 2; }
          model="$2"; shift 2 ;;
        --persona)
          [ $# -ge 2 ] || { usage; exit 2; }
          persona="$2"; shift 2 ;;
        *)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    [ -n "$name" ] || { usage; exit 2; }
    [ -n "$message" ] || [ -n "$script" ] || { usage; exit 2; }
    kind=""
    every_json="null"
    cron_json="null"
    at_json="null"
    schedules=0
    if [ -n "$every" ]; then
      kind="every"; every_json="$every"; schedules=$((schedules + 1))
    fi
    if [ -n "$cron" ]; then
      kind="cron"; cron_json=$(jq -Rn --arg v "$cron" '$v'); schedules=$((schedules + 1))
    fi
    if [ -n "$at" ]; then
      at_s=$(date -u -d "$at" +%s 2>/dev/null) || {
        echo "ob-cron: invalid --at value (use ISO 8601, e.g. 2026-12-01T09:00:00Z)" >&2
        exit 2
      }
      kind="at"; at_json=$((at_s * 1000)); schedules=$((schedules + 1))
    fi
    [ "$schedules" -eq 1 ] || {
      echo "ob-cron: pass exactly one of --every, --cron, --at" >&2
      exit 2
    }
    provider_json="null"
    model_json="null"
    persona_json="null"
    if [ -n "$model" ]; then
      split_model "$model"
      provider_json=$(jq -Rn --arg v "$provider" '$v')
      model_json=$(jq -Rn --arg v "$modelid" '$v')
    fi
    if [ -n "$persona" ]; then
      persona_json=$(jq -Rn --arg v "$persona" '$v')
    fi
    run_kind="prompt"
    script_json="null"
    if [ -n "$script" ]; then
      script_json=$(jq -Rn --arg v "$script" '$v')
      if [ -n "$message" ]; then
        run_kind="both"
      else
        run_kind="script"
      fi
    fi
    body=$(jq -n --arg name "$name" --arg message "$message" --arg kind "$kind" --arg runKind "$run_kind" \
      --argjson every "$every_json" --argjson cron "$cron_json" --argjson at "$at_json" \
      --argjson provider "$provider_json" --argjson model "$model_json" --argjson persona "$persona_json" \
      --argjson script "$script_json" \
      '{name: $name, message: $message, kind: $kind, everySeconds: $every, cronExpr: $cron, atMs: $at, providerID: $provider, modelID: $model, personaId: $persona, runKind: $runKind, script: $script}')
    out=$(request POST /api/cron "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{id, name, kind, runKind, cronExpr, everySeconds, atMs, nextRunAt, enabled, providerId, modelId, personaId}'
    ;;
  list)
    out=$(request GET /api/cron)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '.[] |
      "- \(.name) [\(.id)] \(
        if .kind == "cron" then (.cronExpr // "")
        elif .kind == "every" then "every \(.everySeconds)s"
        else "at \((.atMs / 1000 | strftime("%Y-%m-%dT%H:%M:%SZ")) // "")"
        end)\(if .runKind == "script" or .runKind == "both" then " run=\(.runKind)" else "" end)\(if .providerId and .modelId then " model=\(.providerId)/\(.modelId)" else "" end)\(if .personaId then " persona=\(.personaId)" else "" end)\(if .enabled then "" else " (disabled)" end) runs=\(.runCount)"'
    ;;
  models)
    out=$(request GET /api/cron/models)
    fail_on_error "$out"
    printf '%s' "$out" | jq -r '.models[] | "\(.providerID)/\(.modelID)\(if .name then "  \(.name)" else "" end)"'
    ;;
  set)
    [ $# -ge 2 ] || { usage; exit 2; }
    id="$1"
    shift
    model=""
    clear_model=0
    persona=""
    clear_persona=0
    name=""
    message=""
    run=""
    script=""
    clear_script=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --run)
          [ $# -ge 2 ] || { usage; exit 2; }
          run="$2"; shift 2 ;;
        --script)
          [ $# -ge 2 ] || { usage; exit 2; }
          script="$2"; shift 2 ;;
        --clear-script)
          clear_script=1; shift ;;
        --model)
          [ $# -ge 2 ] || { usage; exit 2; }
          model="$2"; shift 2 ;;
        --clear-model)
          clear_model=1; shift ;;
        --persona)
          [ $# -ge 2 ] || { usage; exit 2; }
          persona="$2"; shift 2 ;;
        --clear-persona)
          clear_persona=1; shift ;;
        --name)
          [ $# -ge 2 ] || { usage; exit 2; }
          name="$2"; shift 2 ;;
        --message)
          [ $# -ge 2 ] || { usage; exit 2; }
          message="$2"; shift 2 ;;
        *)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    if [ -n "$model" ] && [ "$clear_model" -eq 1 ]; then
      echo "ob-cron: pass only one of --model or --clear-model" >&2
      exit 2
    fi
    if [ -n "$persona" ] && [ "$clear_persona" -eq 1 ]; then
      echo "ob-cron: pass only one of --persona or --clear-persona" >&2
      exit 2
    fi
    if [ -n "$script" ] && [ "$clear_script" -eq 1 ]; then
      echo "ob-cron: pass only one of --script or --clear-script" >&2
      exit 2
    fi
    if [ -n "$run" ] && [ "$run" != "prompt" ] && [ "$run" != "script" ] && [ "$run" != "both" ]; then
      echo "ob-cron: --run must be prompt, script, or both" >&2
      exit 2
    fi
    if [ -z "$model" ] && [ "$clear_model" -eq 0 ] && [ -z "$persona" ] && [ "$clear_persona" -eq 0 ] && [ -z "$name" ] && [ -z "$message" ] && [ -z "$run" ] && [ -z "$script" ] && [ "$clear_script" -eq 0 ]; then
      usage
      exit 2
    fi
    body='{}'
    if [ -n "$name" ]; then
      body=$(printf '%s' "$body" | jq --arg name "$name" '. + {name: $name}')
    fi
    if [ -n "$message" ]; then
      body=$(printf '%s' "$body" | jq --arg message "$message" '. + {message: $message}')
    fi
    if [ -n "$run" ]; then
      body=$(printf '%s' "$body" | jq --arg runKind "$run" '. + {runKind: $runKind}')
    fi
    if [ "$clear_script" -eq 1 ]; then
      body=$(printf '%s' "$body" | jq '. + {script: null}')
    elif [ -n "$script" ]; then
      body=$(printf '%s' "$body" | jq --arg script "$script" '. + {script: $script}')
    fi
    if [ "$clear_model" -eq 1 ]; then
      body=$(printf '%s' "$body" | jq '. + {providerID: null, modelID: null}')
    elif [ -n "$model" ]; then
      split_model "$model"
      body=$(printf '%s' "$body" | jq --arg p "$provider" --arg m "$modelid" '. + {providerID: $p, modelID: $m}')
    fi
    if [ "$clear_persona" -eq 1 ] || [ "$persona" = "assistant" ]; then
      body=$(printf '%s' "$body" | jq '. + {personaId: null}')
    elif [ -n "$persona" ]; then
      body=$(printf '%s' "$body" | jq --arg id "$persona" '. + {personaId: $id}')
    fi
    out=$(request PATCH "/api/cron/$(urlencode "$id")" "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{id, name, runKind, script, providerId, modelId, personaId, enabled}'
    ;;
  remove)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request DELETE "/api/cron/$(urlencode "$1")")
    fail_on_error "$out"
    echo "removed $1"
    ;;
  run)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request POST "/api/cron/$(urlencode "$1")/run")
    fail_on_error "$out"
    echo "ran $1"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2; usage; exit 2
    ;;
esac
