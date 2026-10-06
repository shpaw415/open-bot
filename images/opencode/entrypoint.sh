#!/bin/sh
set -eu
export HOME=/home/agent
mkdir -p /home/agent/workspace /home/agent/.config/opencode/skills /home/agent/.local/share/opencode /home/agent/.openviking /tmp/.X11-unix /home/agent/.config/chromium-threads
cp /opt/open-bot/seed/AGENTS.md /home/agent/.config/opencode/AGENTS.md
mkdir -p /home/agent/.config/opencode/skills/desktop
cp /opt/open-bot/seed/skills/desktop/SKILL.md /home/agent/.config/opencode/skills/desktop/SKILL.md
mkdir -p /home/agent/.config/opencode/skills/cron
cp /opt/open-bot/seed/skills/cron/SKILL.md /home/agent/.config/opencode/skills/cron/SKILL.md
mkdir -p /home/agent/.config/opencode/skills/cf-ai
cp /opt/open-bot/seed/skills/cf-ai/SKILL.md /home/agent/.config/opencode/skills/cf-ai/SKILL.md
mkdir -p /home/agent/.config/opencode/skills/persona
cp /opt/open-bot/seed/skills/persona/SKILL.md /home/agent/.config/opencode/skills/persona/SKILL.md
if [ ! -f /home/agent/.config/opencode/opencode.json ]; then
  cp /opt/open-bot/seed/opencode.json /home/agent/.config/opencode/opencode.json
fi
jq --arg prompt "You are a conversational bot, not a coding assistant. Do not follow a software-engineering default. Follow the desktop bot instructions." \
  '.permission = {"*":"allow","external_directory":"allow","doom_loop":"allow","question":"deny"} | .agent.build.prompt = $prompt' \
  /home/agent/.config/opencode/opencode.json > /tmp/oc-perm.json
mv /tmp/oc-perm.json /home/agent/.config/opencode/opencode.json
cp /opt/open-bot/seed/openviking-config.json /home/agent/.config/opencode/openviking-config.json
cat > /home/agent/.openviking/ovcli.conf <<EOF
{"url":"${OPENVIKING_URL}","api_key":"${OPENVIKING_API_KEY}"}
EOF
chown -R agent:agent /home/agent
chmod 1777 /tmp/.X11-unix
run() {
  su -s /bin/sh agent -c "export HOME=/home/agent; $1"
}
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
