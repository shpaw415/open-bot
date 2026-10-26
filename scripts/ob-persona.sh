#!/bin/sh
# ob-persona — manage bot personalities from inside the desktop container.
# Talks to the open-bot control plane; never prints the auth token.
set -eu

BASE="${OPEN_BOT_CONTROL_URL:-http://open-bot:8787}"
TOKEN="${OPEN_BOT_LLM_TOKEN:?OPEN_BOT_LLM_TOKEN is not set}"

usage() {
  cat >&2 <<'EOF'
Usage:
  ob-persona list [--verbose]
  ob-persona add --name NAME --instruction TEXT [--skills "a,b,c" | --skills none]
              [--mcp "a,b" | --mcp none]
  ob-persona update ID [--name NAME] [--instruction TEXT | --append TEXT]
              [--skills "a,b,c" | --skills none] [--skills-append NAME | --skill NAME]...
              [--skills-clear]
              [--mcp "a,b" | --mcp none] [--mcp-append NAME]... [--mcp-clear]
  ob-persona remove ID

Skill scopes: --skills replaces the editable list (the base list for your own
personalities, the extras for plugin-owned and built-in ones — their base is
locked to the desktop's seed set or the plugin's declared set).
--skills-append/--skill add one name (repeatable, accepts a comma list).
--skills-clear removes the restriction (plugin and built-in personas keep
their base list). --skills none blocks every skill on any personality —
including locked-base ones. A personality with an empty list loads all
skills. Built-in personalities cannot be renamed, re-instructed, or deleted.

MCP scopes work the same way on MCP server names: --mcp replaces the editable
server list, --mcp-append adds one (repeatable, comma list ok), --mcp-clear
removes the restriction. --mcp none blocks every MCP server on any
personality. An unrestricted personality loads every configured MCP server.

Creating or editing a personality does not change the current thread.
The user starts a new thread and picks it.
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
    echo "ob-persona: $msg" >&2
    exit 1
  fi
}

urlencode() {
  printf '%s' "$1" | jq -sRr @uri
}

# "a, b,c" -> ["a","b","c"] (trimmed, empties dropped)
list_to_json() {
  printf '%s' "$1" | jq -R 'split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0))'
}

[ $# -ge 1 ] || { usage; exit 2; }
cmd="$1"
shift

case "$cmd" in
  list)
    verbose=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --verbose) verbose=1; shift ;;
        *) echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    out=$(request GET /api/personas)
    fail_on_error "$out"
    if [ -n "$verbose" ]; then
      printf '%s' "$out" | jq -r '.personas[] |
        "- \(.name) [\(.id)]\(if .builtin then " built-in" else "" end) \(.instruction)" +
        (if .builtin then
          "\n    skills: " +
            (if .skillsNone then "none (every skill blocked)"
             else "built-in seed set" +
               (if ((.skillsExtra // []) | length) > 0 then " + " + (.skillsExtra | join(", ")) else "" end)
            end) +
          "\n    mcp: " +
            (if .mcpNone then "none (every server blocked)"
             else "built-in servers" +
               (if ((.mcpExtra // []) | length) > 0 then " + " + (.mcpExtra | join(", ")) else "" end)
            end)
        else
          (if (.skillsEffective // null) != null then
            "\n    skills: " + (.skillsEffective | join(", "))
          else "" end) +
          (if (.mcpEffective // null) != null then
            (if (.mcpEffective | length) == 0 then
              "\n    mcp: none (every server blocked)"
            else
              "\n    mcp: " + (.mcpEffective | join(", "))
            end)
          else "" end)
        end)'
    else
      printf '%s' "$out" | jq -r '.personas[] |
        (if .builtin then
          "- \(.name) [\(.id)] built-in (built-in scope" +
            (if ((.skillsExtra // []) | length) > 0 or ((.mcpExtra // []) | length) > 0 then
              " + extras"
            else "" end) + ")"
        else "- \(.name) [\(.id)]" end) +
        (if (.skillsEffective // null) != null then
          " (skills: " + ((.skillsEffective[:2] | join(", ")) +
            (if (.skillsEffective | length) > 2 then
              " +" + (((.skillsEffective | length) - 2) | tostring)
            else "" end)) + ")"
        else "" end) +
        (if (.mcpEffective // null) != null then
          (if (.mcpEffective | length) == 0 then
            " (mcp: none)"
          else
            " (mcp: " + ((.mcpEffective[:2] | join(", ")) +
              (if (.mcpEffective | length) > 2 then
                " +" + (((.mcpEffective | length) - 2) | tostring)
              else "" end)) + ")"
          end)
        else "" end) +
        (if (.instruction // "") == "" then "" else
          " — " + ((.instruction | gsub("\\s+"; " ")) as $t |
            if ($t | length) > 80 then ($t[:79] + "…") else $t end)
        end)'
    fi
    ;;
  add)
    name=""
    instruction=""
    skills_json=""
    mcp_json=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --name)
          [ $# -ge 2 ] || { usage; exit 2; }
          name="$2"; shift 2 ;;
        --instruction)
          [ $# -ge 2 ] || { usage; exit 2; }
          instruction="$2"; shift 2 ;;
        --skills)
          [ $# -ge 2 ] || { usage; exit 2; }
          [ -n "$2" ] || { echo "ob-persona: --skills needs a comma-separated list (an empty list means all skills — omit the flag; use 'none' to block every skill)" >&2; exit 2; }
          if [ "$2" = "none" ]; then
            skills_json="none"
          else
            skills_json=$(list_to_json "$2")
            [ "$(printf '%s' "$skills_json" | jq 'length')" -gt 0 ] || { echo "ob-persona: --skills needs at least one skill name" >&2; exit 2; }
          fi
          shift 2 ;;
        --mcp)
          [ $# -ge 2 ] || { usage; exit 2; }
          [ -n "$2" ] || { echo "ob-persona: --mcp needs a comma-separated list (an empty list means all servers — omit the flag; use 'none' to block every server)" >&2; exit 2; }
          if [ "$2" = "none" ]; then
            mcp_json="none"
          else
            mcp_json=$(list_to_json "$2")
            [ "$(printf '%s' "$mcp_json" | jq 'length')" -gt 0 ] || { echo "ob-persona: --mcp needs at least one server name" >&2; exit 2; }
          fi
          shift 2 ;;
        *)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    [ -n "$name" ] && [ -n "$instruction" ] || { usage; exit 2; }
    body=$(jq -n --arg name "$name" --arg instruction "$instruction" \
      '{name: $name, instruction: $instruction}')
    if [ "$skills_json" = "none" ]; then
      body=$(printf '%s' "$body" | jq '. + {skillsNone: true}')
    elif [ -n "$skills_json" ]; then
      body=$(printf '%s' "$body" | jq --argjson skills "$skills_json" '. + {skills: $skills}')
    fi
    if [ "$mcp_json" = "none" ]; then
      body=$(printf '%s' "$body" | jq '. + {mcpNone: true}')
    elif [ -n "$mcp_json" ]; then
      body=$(printf '%s' "$body" | jq --argjson mcp "$mcp_json" '. + {mcp: $mcp}')
    fi
    out=$(request POST /api/personas "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{id, name}'
    echo "Saved. Start a new thread and pick it. This thread is unchanged."
    ;;
  update)
    [ $# -ge 1 ] || { usage; exit 2; }
    id="$1"
    shift
    name=""
    instruction=""
    append=""
    skills_json=""
    appends=""
    skills_clear=""
    mcp_json=""
    mcp_appends=""
    mcp_clear=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --name)
          [ $# -ge 2 ] || { usage; exit 2; }
          name="$2"; shift 2 ;;
        --instruction)
          [ $# -ge 2 ] || { usage; exit 2; }
          instruction="$2"; shift 2 ;;
        --append)
          [ $# -ge 2 ] || { usage; exit 2; }
          append="$2"; shift 2 ;;
        --skills)
          [ $# -ge 2 ] || { usage; exit 2; }
          [ -n "$2" ] || { echo "ob-persona: --skills needs a comma-separated list (use 'none' to block every skill, --skills-clear to remove the restriction)" >&2; exit 2; }
          if [ "$2" = "none" ]; then
            skills_json="none"
          else
            skills_json=$(list_to_json "$2")
            [ "$(printf '%s' "$skills_json" | jq 'length')" -gt 0 ] || { echo "ob-persona: --skills needs at least one skill name" >&2; exit 2; }
          fi
          shift 2 ;;
        --skills-append|--skill)
          [ $# -ge 2 ] || { usage; exit 2; }
          [ -n "$2" ] || { echo "ob-persona: --skills-append needs a skill name" >&2; exit 2; }
          appends="$appends
$2"
          shift 2 ;;
        --skills-clear)
          skills_clear=1; shift ;;
        --mcp)
          [ $# -ge 2 ] || { usage; exit 2; }
          [ -n "$2" ] || { echo "ob-persona: --mcp needs a comma-separated list (use 'none' to block every server, --mcp-clear to remove the restriction)" >&2; exit 2; }
          if [ "$2" = "none" ]; then
            mcp_json="none"
          else
            mcp_json=$(list_to_json "$2")
            [ "$(printf '%s' "$mcp_json" | jq 'length')" -gt 0 ] || { echo "ob-persona: --mcp needs at least one server name" >&2; exit 2; }
          fi
          shift 2 ;;
        --mcp-append)
          [ $# -ge 2 ] || { usage; exit 2; }
          [ -n "$2" ] || { echo "ob-persona: --mcp-append needs a server name" >&2; exit 2; }
          mcp_appends="$mcp_appends
$2"
          shift 2 ;;
        --mcp-clear)
          mcp_clear=1; shift ;;
        *)
          echo "unknown option: $1" >&2; usage; exit 2 ;;
      esac
    done
    if [ -n "$append" ]; then
      if [ -n "$instruction" ]; then
        echo "ob-persona: use --instruction or --append, not both" >&2
        exit 2
      fi
      out=$(request GET /api/personas)
      fail_on_error "$out"
      instruction=$(printf '%s' "$out" | jq -r --arg id "$id" \
        '.personas[] | select(.id == $id) | .instruction // ""')
      if [ -z "$instruction" ]; then
        echo "ob-persona: persona not found: $id" >&2
        exit 1
      fi
      instruction="$instruction
$append"
    fi

    needs_current=""
    if [ -n "$skills_json" ] || [ -n "$appends" ] || [ -n "$skills_clear" ] \
       || [ -n "$mcp_json" ] || [ -n "$mcp_appends" ] || [ -n "$mcp_clear" ]; then
      needs_current=1
      out=$(request GET /api/personas)
      fail_on_error "$out"
      persona_json=$(printf '%s' "$out" | jq -c --arg id "$id" \
        '.personas[] | select(.id == $id)')
      if [ -z "$persona_json" ]; then
        echo "ob-persona: persona not found: $id" >&2
        exit 1
      fi
      is_plugin=$(printf '%s' "$persona_json" | jq -r 'if .plugin then "1" else "" end')
      # Built-in personas carry the same extras model as plugin-owned ones:
      # their locked base is the desktop's seed set, edits target the extras.
      is_builtin=$(printf '%s' "$persona_json" | jq -r 'if .builtin then "1" else "" end')
      if [ -n "$is_builtin" ] && { [ -n "$name" ] || [ -n "$instruction" ] || [ -n "$append" ]; }; then
        echo "ob-persona: built-in personalities cannot be renamed or re-instructed — use --skills-append/--mcp-append to extend their scope" >&2
        exit 1
      fi
      extras_mode="$is_plugin$is_builtin"
      base_json=$(printf '%s' "$persona_json" | jq -c '(.skills // [])')
      mcp_base_json=$(printf '%s' "$persona_json" | jq -c '(.mcp // [])')
    fi

    # --skills replaces the editable list: the base for user personas, the
    # extras for plugin-owned and built-in ones (the base itself is locked).
    # The sentinel "none" blocks every skill / server on any persona kind.
    skills_field=""
    skills_value=""
    skills_none=""
    if [ "$skills_json" = "none" ]; then
      skills_none="true"
    elif [ -n "$skills_json" ]; then
      if [ -n "$extras_mode" ]; then
        clash=$(printf '%s' "$skills_json" | jq -r --argjson base "$base_json" \
          '.[] | select(. as $n | $base | index($n))' | head -n 1)
        if [ -n "$clash" ]; then
          echo "ob-persona: '$clash' is already in the base skill list — it is always allowed" >&2
          exit 1
        fi
        skills_field="skillsExtra"
      else
        skills_field="skills"
      fi
      skills_value="$skills_json"
      skills_none="false"
    fi

    if [ -n "$appends" ]; then
      add_json=$(list_to_json "$appends")
      [ "$(printf '%s' "$add_json" | jq 'length')" -gt 0 ] || { echo "ob-persona: --skills-append needs a skill name" >&2; exit 2; }
      if [ -n "$extras_mode" ]; then
        clash=$(printf '%s' "$add_json" | jq -r --argjson base "$base_json" \
          '.[] | select(. as $n | $base | index($n))' | head -n 1)
        if [ -n "$clash" ]; then
          echo "ob-persona: '$clash' is in the base skill list — it is already allowed" >&2
          exit 1
        fi
        current_json=$(printf '%s' "$persona_json" | jq -c '(.skillsExtra // [])')
        skills_field="skillsExtra"
      else
        current_json=$(printf '%s' "$persona_json" | jq -c '(.skills // [])')
        skills_field="skills"
      fi
      skills_value=$(printf '%s' "$current_json" | jq -c --argjson add "$add_json" '. + [$add[]] | unique')
      skills_none="false"
    fi

    if [ -n "$skills_clear" ]; then
      if [ -n "$extras_mode" ]; then
        skills_field="skillsExtra"
      else
        skills_field="skills"
      fi
      skills_value="null"
      skills_none="false"
    fi

    # MCP server lists follow the same editable-list rule as skills.
    mcp_field=""
    mcp_value=""
    mcp_none=""
    if [ "$mcp_json" = "none" ] || [ "$mcp_json" = "[]" ]; then
      mcp_none="true"
    elif [ -n "$mcp_json" ]; then
      if [ -n "$extras_mode" ]; then
        clash=$(printf '%s' "$mcp_json" | jq -r --argjson base "$mcp_base_json" \
          '.[] | select(. as $n | $base | index($n))' | head -n 1)
        if [ -n "$clash" ]; then
          echo "ob-persona: '$clash' is already in the base server list — it is always allowed" >&2
          exit 1
        fi
        mcp_field="mcpExtra"
      else
        mcp_field="mcp"
      fi
      mcp_value="$mcp_json"
      mcp_none="false"
    fi

    if [ -n "$mcp_appends" ]; then
      add_json=$(list_to_json "$mcp_appends")
      [ "$(printf '%s' "$add_json" | jq 'length')" -gt 0 ] || { echo "ob-persona: --mcp-append needs a server name" >&2; exit 2; }
      if [ -n "$extras_mode" ]; then
        clash=$(printf '%s' "$add_json" | jq -r --argjson base "$mcp_base_json" \
          '.[] | select(. as $n | $base | index($n))' | head -n 1)
        if [ -n "$clash" ]; then
          echo "ob-persona: '$clash' is in the base server list — it is already allowed" >&2
          exit 1
        fi
        current_json=$(printf '%s' "$persona_json" | jq -c '(.mcpExtra // [])')
        mcp_field="mcpExtra"
      else
        current_json=$(printf '%s' "$persona_json" | jq -c '(.mcp // [])')
        mcp_field="mcp"
      fi
      mcp_value=$(printf '%s' "$current_json" | jq -c --argjson add "$add_json" '. + [$add[]] | unique')
      mcp_none="false"
    fi

    if [ -n "$mcp_clear" ]; then
      if [ -n "$extras_mode" ]; then
        mcp_field="mcpExtra"
      else
        mcp_field="mcp"
      fi
      mcp_value="null"
      mcp_none="false"
    fi

    if [ -z "$name" ] && [ -z "$instruction" ] && [ -z "$skills_field" ] && [ -z "$mcp_field" ] \
       && [ -z "$skills_none" ] && [ -z "$mcp_none" ]; then
      usage
      exit 2
    fi
    body="{}"
    if [ -n "$name" ]; then
      body=$(printf '%s' "$body" | jq --arg v "$name" '. + {name: $v}')
    fi
    if [ -n "$instruction" ]; then
      body=$(printf '%s' "$body" | jq --arg v "$instruction" '. + {instruction: $v}')
    fi
    if [ -n "$skills_field" ]; then
      body=$(printf '%s' "$body" | jq --arg f "$skills_field" --argjson v "$skills_value" '. + {($f): $v}')
    fi
    if [ -n "$skills_none" ]; then
      body=$(printf '%s' "$body" | jq --argjson v "$skills_none" '. + {skillsNone: $v}')
    fi
    if [ -n "$mcp_field" ]; then
      body=$(printf '%s' "$body" | jq --arg f "$mcp_field" --argjson v "$mcp_value" '. + {($f): $v}')
    fi
    if [ -n "$mcp_none" ]; then
      body=$(printf '%s' "$body" | jq --argjson v "$mcp_none" '. + {mcpNone: $v}')
    fi
    out=$(request PUT "/api/personas/$(urlencode "$id")" "$body")
    fail_on_error "$out"
    printf '%s' "$out" | jq '{id, name}'
    echo "Updated. Start a new thread to use it. This thread is unchanged."
    ;;
  remove)
    [ $# -eq 1 ] || { usage; exit 2; }
    out=$(request DELETE "/api/personas/$(urlencode "$1")")
    fail_on_error "$out"
    echo "removed $1"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2; usage; exit 2
    ;;
esac
