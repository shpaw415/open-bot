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
mkdir -p /home/agent/.config/opencode/skills/persona
cp /opt/open-bot/seed/skills/persona/SKILL.md /home/agent/.config/opencode/skills/persona/SKILL.md
mkdir -p /home/agent/.config/opencode/skills/shortcut
cp /opt/open-bot/seed/skills/shortcut/SKILL.md /home/agent/.config/opencode/skills/shortcut/SKILL.md
if [ -f /opt/open-bot/dev-mode ]; then
  mkdir -p /home/agent/.config/opencode/skills/improve
  cp /opt/open-bot/seed/skills/improve/SKILL.md /home/agent/.config/opencode/skills/improve/SKILL.md
  cat >> /home/agent/.config/opencode/AGENTS.md <<'EOF'

Product defects, on a development desktop only: load the `improve` skill and run `ob-improve` when you hit a product bug, repeated friction, or a missing capability during real work. Do not file user mistakes, secrets, one-offs, or a path a shortcut can cover. One sentence in the reply that it was filed is enough. Do not ask first. If `ob-improve` is missing, do not file.
EOF
else
  rm -rf /home/agent/.config/opencode/skills/improve
fi
if [ ! -f /home/agent/.config/opencode/opencode.json ]; then
  cp /opt/open-bot/seed/opencode.json /home/agent/.config/opencode/opencode.json
fi
prompt='You are a conversational bot, not a coding assistant. Do not follow a software-engineering default. Follow the desktop bot instructions. Answer in one short message. Do not open with a plan, a status line, or a coding-task frame. Do not run tools unless the person asked you to use the desktop, the shell, memory, a schedule, or an image. Never run xclip or xsel. Paste with ob-vnc paste. If a command does not finish, stop and say so.'
jq --arg prompt "$prompt" \
  '.permission = {"*":"allow","external_directory":"allow","doom_loop":"allow","question":"deny","bash":{"*":"allow","*922*":"deny","*devtools*":"deny","*vncdo*":"deny","*google-chrome*":"deny","*chromium*":"deny","*websockify*":"deny","*Xvfb*":"deny","*x11vnc*":"deny","*xclip*":"deny","*xsel*":"deny"}} | .agent.build.prompt = $prompt | .agent.build.steps = 8' \
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
