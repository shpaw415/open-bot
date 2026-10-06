FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl jq libatomic1 procps unzip \
    xvfb openbox chromium \
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

COPY images/opencode/seed /opt/open-bot/seed
COPY scripts/opencode-auth.sh /opt/open-bot/opencode-auth.sh
COPY scripts/ob-cron.sh /usr/local/bin/ob-cron
COPY scripts/ob-persona.sh /usr/local/bin/ob-persona
COPY images/opencode/entrypoint.sh /opt/open-bot/entrypoint.sh
COPY images/opencode/apply-model.sh /opt/open-bot/apply-model.sh
COPY images/opencode/apply-image-auth.sh /opt/open-bot/apply-image-auth.sh
RUN chmod 755 /opt/open-bot/opencode-auth.sh /opt/open-bot/entrypoint.sh /opt/open-bot/apply-model.sh /opt/open-bot/apply-image-auth.sh /usr/local/bin/ob-cron /usr/local/bin/ob-persona \
    && touch /opt/open-bot/instance

USER root
ENTRYPOINT ["/opt/open-bot/entrypoint.sh"]
