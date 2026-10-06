FROM oven/bun:1.4

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-28.3.3.tgz \
      | tar -xz -C /usr/local/bin --strip-components=1 docker/docker \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lock* tsconfig.json biome.json ./
COPY apps ./apps
COPY packages ./packages
COPY images ./images
COPY scripts ./scripts
COPY config ./config
RUN bun install && bun run --cwd apps/web build

ENV OPEN_BOT_IN_DOCKER=1
ENV DATA_DIR=/data
EXPOSE 8787
CMD ["bun", "apps/control/src/index.ts"]
