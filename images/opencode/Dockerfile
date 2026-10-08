FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl jq libatomic1 procps sudo unzip \
    xvfb openbox chromium sqlite3 \
    python3 python3-pip python3-venv \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && arch=$(dpkg --print-architecture) \
    && case "$arch" in \
         amd64) ttyd_arch=x86_64; ttyd_sha=8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55; node_arch=x64; node_sha=cb5c9ce9c80d7b8821e3a258543c71b939138cf17c74d5cc44bbe85d6dbc5ad8 ;; \
         arm64) ttyd_arch=aarch64; ttyd_sha=b38acadd89d1d396a0f5649aa52c539edbad07f4bc7348b27b4f4b7219dd4165; node_arch=arm64; node_sha=423a41bff8e2a2fa15e702fefe2919ef95823b2378744daccb8439302534b44f ;; \
         *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
       esac \
    && curl -fsSL -o /tmp/node.tar.gz "https://nodejs.org/dist/v26.10.0/node-v26.10.0-linux-${node_arch}.tar.gz" \
    && echo "${node_sha}  /tmp/node.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.gz \
    && node --version \
    && curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.${ttyd_arch}" \
    && echo "${ttyd_sha}  /usr/local/bin/ttyd" | sha256sum -c - \
    && chmod 755 /usr/local/bin/ttyd \
    && python3 -m venv /opt/vncdotool \
    && /opt/vncdotool/bin/pip install --no-cache-dir vncdotool \
    && ln -sf /opt/vncdotool/bin/vncdo /usr/local/bin/vncdo

RUN arch=$(dpkg --print-architecture) \
 && if [ "$arch" = "amd64" ]; then \
      apt-get update \
      && curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
      && apt-get install -y /tmp/chrome.deb \
      && rm -f /tmp/chrome.deb \
      && chmod 4755 /opt/google/chrome/chrome-sandbox \
      && rm -rf /var/lib/apt/lists/*; \
    fi

RUN curl -fsSL https://opencode.ai/install | bash \
    && cp -a /root/.opencode /opt/opencode \
    && chmod -R a+rX /opt/opencode \
    && ln -sf /opt/opencode/bin/opencode /usr/local/bin/opencode \
    && useradd --create-home --shell /bin/bash agent

RUN curl -fsSL https://bun.sh/install | bash \
    && cp /root/.bun/bin/bun /usr/local/bin/bun \
    && chmod 755 /usr/local/bin/bun \
    && mkdir -p /opt/cf-ai \
    && cd /opt/cf-ai \
    && bun add cloudflare-ai-worker-cli \
    && ln -sf /opt/cf-ai/node_modules/.bin/cf-ai /usr/local/bin/cf-ai \
    && chmod -R a+rx /opt/cf-ai

COPY images/opencode/gpio-3d /opt/gpio-3d
RUN python3 -m venv /opt/gpio-3d/venv \
    && /opt/gpio-3d/venv/bin/pip install --no-cache-dir --only-binary=:all: -r /opt/gpio-3d/requirements.txt \
    && /opt/gpio-3d/venv/bin/python -c "import trimesh, numpy, manifold3d" \
    && printf '#!/bin/sh\nset -eu\nexport PYTHONPATH="/opt/gpio-3d${PYTHONPATH:+:$PYTHONPATH}"\nexec /opt/gpio-3d/venv/bin/python -m gpio_3d "$@"\n' > /usr/local/bin/gpio-3d \
    && chmod 755 /usr/local/bin/gpio-3d \
    && chmod -R a+rX /opt/gpio-3d

RUN apt-get update \
    && apt-get install -y --no-install-recommends blender xauth \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m pip install --no-cache-dir --no-binary=:all: --target /opt/blender-requests requests \
    && python3 -m venv /opt/blender-mcp-venv \
    && /opt/blender-mcp-venv/bin/pip install --no-cache-dir blender-mcp \
    && test -x /opt/blender-mcp-venv/bin/blender-mcp \
    && chmod -R a+rX /opt/blender-requests /opt/blender-mcp-venv

COPY images/opencode/blender-mcp /opt/open-bot/blender-mcp
COPY images/opencode/blender-up.sh /opt/open-bot/blender-up.sh
COPY images/opencode/apply-blender-mcp.sh /opt/open-bot/apply-blender-mcp.sh

COPY images/opencode/seed /opt/open-bot/seed
COPY scripts/opencode-auth.sh /opt/open-bot/opencode-auth.sh
COPY scripts/ob-cron.sh /usr/local/bin/ob-cron
COPY scripts/ob-persona.sh /usr/local/bin/ob-persona
COPY scripts/ob-config.sh /usr/local/bin/ob-config
COPY images/opencode/entrypoint.sh /opt/open-bot/entrypoint.sh
COPY images/opencode/apply-model.sh /opt/open-bot/apply-model.sh
COPY images/opencode/apply-image-auth.sh /opt/open-bot/apply-image-auth.sh
COPY images/opencode/gen-image.ts /opt/open-bot/gen-image.ts
RUN ln -sf /opt/open-bot/gen-image.ts /usr/local/bin/gen-image \
    && chmod 755 /opt/open-bot/gen-image.ts
COPY images/opencode/apply-video-auth.sh /opt/open-bot/apply-video-auth.sh
COPY images/opencode/gen-video.ts /opt/open-bot/gen-video.ts
RUN ln -sf /opt/open-bot/gen-video.ts /usr/local/bin/gen-video \
    && chmod 755 /opt/open-bot/gen-video.ts
COPY images/opencode/apply-model3d-auth.sh /opt/open-bot/apply-model3d-auth.sh
COPY images/opencode/gen-3d.ts /opt/open-bot/gen-3d.ts
RUN ln -sf /opt/open-bot/gen-3d.ts /usr/local/bin/gen-3d \
    && chmod 755 /opt/open-bot/gen-3d.ts
COPY images/opencode/blender-team.ts /opt/open-bot/blender-team.ts
RUN ln -sf /opt/open-bot/blender-team.ts /usr/local/bin/blender-team \
    && chmod 755 /opt/open-bot/blender-team.ts
COPY images/opencode/apply-system1.sh /opt/open-bot/apply-system1.sh
COPY apps/control/src/nav /opt/open-bot/nav
COPY images/opencode/screen-up.sh /opt/open-bot/screen-up.sh
COPY images/opencode/screen-down.sh /opt/open-bot/screen-down.sh
COPY images/opencode/screen-list.sh /opt/open-bot/screen-list.sh
COPY images/opencode/sync-chromium.sh /opt/open-bot/sync-chromium.sh
COPY images/opencode/record-apt.sh /opt/open-bot/record-apt.sh
COPY images/opencode/restore-apt.sh /opt/open-bot/restore-apt.sh
COPY images/opencode/apt-persist.conf /etc/apt/apt.conf.d/99open-bot-persist
COPY images/opencode/ob-vnc.sh /usr/local/bin/ob-vnc
COPY images/opencode/ob-page.sh /usr/local/bin/ob-page
COPY images/opencode/xcap.py /opt/open-bot/xcap.py
COPY images/opencode/xshot.ts /opt/open-bot/xshot.ts
COPY images/opencode/hittest.ts /opt/open-bot/hittest.ts
COPY images/opencode/coord.ts /opt/open-bot/coord.ts
COPY images/opencode/url-watch.ts /opt/open-bot/url-watch.ts
COPY images/opencode/ob-nav.sh /usr/local/bin/ob-nav
COPY images/opencode/chromium-policy.json /etc/chromium/policies/managed/open-bot.json
COPY images/opencode/chromium-policy.json /etc/opt/chrome/policies/managed/open-bot.json
COPY scripts/ob-improve.sh /tmp/ob-improve.sh
ARG OPEN_BOT_DEV=0
RUN if [ "$OPEN_BOT_DEV" = "1" ]; then \
      cp /tmp/ob-improve.sh /usr/local/bin/ob-improve \
      && chmod 755 /usr/local/bin/ob-improve \
      && touch /opt/open-bot/dev-mode; \
    else \
      rm -rf /opt/open-bot/seed/skills/improve; \
    fi \
    && rm -f /tmp/ob-improve.sh
RUN LC_ALL=C apt-mark showmanual | LC_ALL=C sort > /opt/open-bot/apt-baseline \
     && chmod 755 /usr/local/bin/ob-vnc /usr/local/bin/ob-nav /usr/local/bin/ob-cron /usr/local/bin/ob-persona /usr/local/bin/ob-config /usr/local/bin/ob-page \
    && cp -a /usr/local /opt/image-usr-local \
    && echo 'agent ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/open-bot-agent \
    && chmod 440 /etc/sudoers.d/open-bot-agent \
    && visudo -cf /etc/sudoers.d/open-bot-agent \
     && chmod 755 /opt/open-bot/opencode-auth.sh /opt/open-bot/entrypoint.sh /opt/open-bot/apply-model.sh /opt/open-bot/apply-image-auth.sh /opt/open-bot/apply-video-auth.sh /opt/open-bot/apply-model3d-auth.sh /opt/open-bot/apply-system1.sh /opt/open-bot/apply-blender-mcp.sh /opt/open-bot/blender-up.sh /opt/open-bot/screen-up.sh /opt/open-bot/screen-down.sh /opt/open-bot/screen-list.sh /opt/open-bot/sync-chromium.sh /opt/open-bot/record-apt.sh /opt/open-bot/restore-apt.sh /usr/local/bin/ob-vnc /usr/local/bin/ob-nav /usr/local/bin/ob-cron /usr/local/bin/ob-persona /opt/image-usr-local/bin/ob-vnc /opt/image-usr-local/bin/ob-nav /opt/image-usr-local/bin/ob-cron /opt/image-usr-local/bin/ob-persona /opt/image-usr-local/bin/ob-page \
    && touch /opt/open-bot/instance

USER root
ENTRYPOINT ["/opt/open-bot/entrypoint.sh"]
