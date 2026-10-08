#!/bin/sh
set -eu
export HOME=/home/agent
mkdir -p /home/agent/workspace /home/agent/.config/opencode/skills /home/agent/.local/share/opencode /home/agent/.openviking /home/agent/.open-bot /tmp/.X11-unix /home/agent/.config/chromium /home/agent/.config/chromium-threads
if [ -d /opt/image-usr-local ]; then
  mkdir -p /usr/local
  cp -a /opt/image-usr-local/. /usr/local/
  chmod 755 /usr/local/bin/ob-nav /usr/local/bin/ob-vnc /usr/local/bin/ob-cron /usr/local/bin/ob-persona /usr/local/bin/ob-improve 2>/dev/null || true
fi
if [ ! -f /opt/open-bot/dev-mode ]; then
  rm -f /usr/local/bin/ob-improve
fi
if [ -e /opt/google/chrome/chrome-sandbox ]; then
  chown root:root /opt/google/chrome/chrome-sandbox
  chmod 4755 /opt/google/chrome/chrome-sandbox
fi
idfile=/home/agent/.open-bot/machine-id
if [ ! -s "$idfile" ]; then
  if [ -s /etc/machine-id ]; then
    cat /etc/machine-id >"$idfile"
  else
    tr -d '-' </proc/sys/kernel/random/uuid >"$idfile"
  fi
fi
cp "$idfile" /etc/machine-id
mkdir -p /var/lib/dbus
cp "$idfile" /var/lib/dbus/machine-id
cp /opt/open-bot/seed/AGENTS.md /home/agent/.config/opencode/AGENTS.md
mkdir -p /home/agent/.config/opencode/skills/desktop
cp /opt/open-bot/seed/skills/desktop/SKILL.md /home/agent/.config/opencode/skills/desktop/SKILL.md
mkdir -p /home/agent/.config/opencode/skills/cron
cp /opt/open-bot/seed/skills/cron/SKILL.md /home/agent/.config/opencode/skills/cron/SKILL.md
mkdir -p /home/agent/.config/opencode/skills/cf-ai
cp /opt/open-bot/seed/skills/cf-ai/SKILL.md /home/agent/.config/opencode/skills/cf-ai/SKILL.md
mkdir -p /home/agent/.config/opencode/skills/gen-image
cp /opt/open-bot/seed/skills/gen-image/SKILL.md /home/agent/.config/opencode/skills/gen-image/SKILL.md
mkdir -p /home/agent/.config/opencode/skills/gen-video
cp /opt/open-bot/seed/skills/gen-video/SKILL.md /home/agent/.config/opencode/skills/gen-video/SKILL.md
mkdir -p /home/agent/.config/opencode/skills/gen-3d
cp /opt/open-bot/seed/skills/gen-3d/SKILL.md /home/agent/.config/opencode/skills/gen-3d/SKILL.md
mkdir -p /home/agent/.config/opencode/skills/blender
cp /opt/open-bot/seed/skills/blender/SKILL.md /home/agent/.config/opencode/skills/blender/SKILL.md
mkdir -p /home/agent/.config/opencode/skills/persona
cp /opt/open-bot/seed/skills/persona/SKILL.md /home/agent/.config/opencode/skills/persona/SKILL.md
mkdir -p /home/agent/.config/opencode/skills/shortcut
cp /opt/open-bot/seed/skills/shortcut/SKILL.md /home/agent/.config/opencode/skills/shortcut/SKILL.md
mkdir -p /home/agent/.config/opencode/skills/research
cp /opt/open-bot/seed/skills/research/SKILL.md /home/agent/.config/opencode/skills/research/SKILL.md
mkdir -p /home/agent/.config/opencode/skills/gpio-3d
cp /opt/open-bot/seed/skills/gpio-3d/SKILL.md /home/agent/.config/opencode/skills/gpio-3d/SKILL.md
cp /opt/open-bot/seed/skills/gpio-3d/validate-manifest.ts /home/agent/.config/opencode/skills/gpio-3d/validate-manifest.ts
if [ -f /opt/open-bot/dev-mode ]; then
  mkdir -p /home/agent/.config/opencode/skills/improve
  cp /opt/open-bot/seed/skills/improve/SKILL.md /home/agent/.config/opencode/skills/improve/SKILL.md
  cat >> /home/agent/.config/opencode/AGENTS.md <<'EOF'

Product defects, frictions, and missing capabilities, on a development desktop only: load the `improve` skill and run `ob-improve` when you hit a product bug, repeated friction, or a missing capability during real work. Features and frictions are first-class: file the whole improvement report, not only defects. Recovering yourself does not make it not a bug: file especially when ob-nav errors, repeats one decision, gives up, or falls back to ob-vnc more than once in the same job, and name what you attempted. Do not file user mistakes, secrets, one-offs, or a path a shortcut can cover. One sentence in the reply that it was filed is enough. Do not ask first. If `ob-improve` is missing, do not file.
EOF
else
  rm -rf /home/agent/.config/opencode/skills/improve
fi
if [ ! -f /home/agent/.config/opencode/opencode.json ]; then
  cp /opt/open-bot/seed/opencode.json /home/agent/.config/opencode/opencode.json
fi
prompt='You are a conversational bot, not a coding assistant. Do not follow a software-engineering default. Follow the desktop bot instructions. Answer in one short message. Do not open with a plan, a status line, or a coding-task frame. While you work, send no text messages: no plan, no status, no progress notes, no step summaries. Tool calls are silent. Send exactly one message, when the whole job is finished, containing only the final result and any deliverable images. Before that final message on a multi-step job, run the closing checklist: file a product defect or friction with ob-improve when this desktop has it, save a found shortcut with the shortcut skill, remember durable facts with openviking_remember, and record promised follow-ups. Do not run tools unless the person asked you to use the desktop, the shell, memory, a schedule, or an image. Never run xclip or xsel. Paste with ob-vnc paste. If a command hangs, kill it and move on. Never end the turn while ob-vnc can still advance the task; finish it yourself. Only stop for the user when the screen needs them.'
jq --arg prompt "$prompt" --slurpfile seed /opt/open-bot/seed/opencode.json \
  '.permission = {"*":"allow","external_directory":"allow","doom_loop":"allow","question":"deny","bash":{"*":"allow","*922*":"deny","*devtools*":"deny","*vncdo*":"deny","*google-chrome*":"deny","*chromium*":"deny","*websockify*":"deny","*Xvfb*":"deny","*x11vnc*":"deny","*xclip*":"deny","*xsel*":"deny"}} | .agent.build.prompt = $prompt | .agent.build.steps = 96 | .agent.build.tools = ((.agent.build.tools // {}) + {"blender_*": false}) | .agent.title = $seed[0].agent.title | .agent.namer = $seed[0].agent.namer | .agent["blender-worker"] = ((.agent["blender-worker"] // $seed[0].agent["blender-worker"]) ) | (if .mcp.blender == null then .mcp = ((.mcp // {}) + ($seed[0].mcp // {})) else . end)' \
  /home/agent/.config/opencode/opencode.json > /tmp/oc-perm.json
mv /tmp/oc-perm.json /home/agent/.config/opencode/opencode.json
cp /opt/open-bot/seed/openviking-config.json /home/agent/.config/opencode/openviking-config.json
cat > /home/agent/.openviking/ovcli.conf <<EOF
{"url":"${OPENVIKING_URL}","api_key":"${OPENVIKING_API_KEY}"}
EOF
chown -R agent:agent /home/agent
chmod 1777 /tmp/.X11-unix
if ! /opt/open-bot/restore-apt.sh >>/home/agent/.open-bot/apt-restore.log 2>&1; then
  echo "apt restore failed" >&2
fi
run() {
  su -s /bin/sh agent -c "export HOME=/home/agent; $1"
}
run "exec /opt/open-bot/blender-up.sh" >>/home/agent/.open-bot/blender-up.log 2>&1 &
(while true; do chmod 777 /tmp/.X11-unix/X* 2>/dev/null || true; sleep 2; done) &
run "ttyd -p 7681 -W -b /desktop/term bash" &
/opt/open-bot/apply-model.sh
# models.dev sets Workers AI output limits equal to the context window, so
# opencode sends max_tokens = context and Cloudflare rejects every request.
# Once the provider catalog cache exists, clamp output to context - 2048 via
# per-model config overrides, then restart opencode to pick them up.
(
  cache=/home/agent/.cache/opencode/models.json
  cfg=/home/agent/.config/opencode/opencode.json
  flag=/home/agent/.config/opencode/.workers-ai-limits
  while [ ! -f "$flag" ]; do
    if [ -f "$cache" ] && jq -e '."cloudflare-workers-ai".models' "$cache" >/dev/null 2>&1; then
      jq --slurpfile cat "$cache" '
        .provider["cloudflare-workers-ai"].models =
          ($cat[0]["cloudflare-workers-ai"].models
          | to_entries
          | map(.value.limit.output =
              ([.value.limit.output, .value.limit.context - 12288] | min))
          | from_entries)' "$cfg" > /tmp/oc-limits.json \
        && mv /tmp/oc-limits.json "$cfg" \
        && chown agent:agent "$cfg" \
        && touch "$flag" \
        && pkill -TERM -f "opencode serve" || true
    fi
    sleep 2
  done
) &
while true; do
  run "cd /home/agent/workspace && opencode serve --hostname 0.0.0.0 --port 4096" &
  echo $! > /run/opencode.pid
  wait $! || true
  sleep 1
done
