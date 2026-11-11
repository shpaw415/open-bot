# Sandbox image (docs/sandbox-threads-spec.md): the smallest thing that
# can run opencode + skills + local MCP servers for an untrusted prompt.
# Deliberately absent vs the desktop image: sudo, ob-* CLIs, Chromium/Xvfb,
# the CLI bridge, OpenViking, apt persistence, ttyd. If a prompt needs a
# binary that is not here, that is the boundary working.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl git jq libatomic1 procps python3 ripgrep unzip \
    && rm -rf /var/lib/apt/lists/* \
    && arch=$(dpkg --print-architecture) \
    && case "$arch" in \
         amd64) node_arch=x64; node_sha=cb5c9ce9c80d7b8821e3a258543c71b939138cf17c74d5cc44bbe85d6dbc5ad8 ;; \
         arm64) node_arch=arm64; node_sha=423a41bff8e2a2fa15e702fefe2919ef95823b2378744daccb8439302534b44f ;; \
         *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
       esac \
    && curl -fsSL -o /tmp/node.tar.gz "https://nodejs.org/dist/v26.10.0/node-v26.10.0-linux-${node_arch}.tar.gz" \
    && echo "${node_sha}  /tmp/node.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.gz \
    && node --version

RUN curl -fsSL https://opencode.ai/install | bash \
    && cp -a /root/.opencode /opt/opencode \
    && chmod -R a+rX /opt/opencode \
    && ln -sf /opt/opencode/bin/opencode /usr/local/bin/opencode \
    && useradd --uid 1000 --create-home --home-dir /home/sandbox --shell /bin/bash sandbox \
    && mkdir -p /workspace && chown sandbox:sandbox /workspace

RUN curl -fsSL https://bun.sh/install | bash \
    && cp /root/.bun/bin/bun /usr/local/bin/bun \
    && chmod 755 /usr/local/bin/bun

# Seed skills are copied per-launch (only the profile's allowlist). No
# opencode plugin ships here: a local plugin makes opencode npm-install
# dependencies on first init, which blocks ~70s offline — and the desktop
# tool-guards policies protect surfaces a sandbox does not have.
COPY images/opencode/seed/skills /opt/open-bot/seed/skills
# Test fixture: an offline echo MCP server (escape battery, spec §11).
COPY images/sandbox/echo-mcp.ts /opt/open-bot/echo-mcp.ts
COPY images/sandbox/entrypoint.sh /opt/open-bot/entrypoint.sh

RUN chmod 755 /opt/open-bot/entrypoint.sh \
    && chmod -R a+rX /opt/open-bot/seed

USER sandbox
WORKDIR /workspace
ENTRYPOINT ["/opt/open-bot/entrypoint.sh"]
