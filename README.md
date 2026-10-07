<img src="assets/icon.svg" width="64" height="64" alt="">

# open-bot

Self-hosted multi-user conversational bot, not a coding agent. Each user gets a chat, an isolated Linux desktop the bot can see and operate, and an OpenViking memory bound to that desktop. OpenCode is only the runtime inside the desktop. The control plane runs in Docker so it does not read the host OpenCode config.

```sh
bun run setup
```

The wizard writes `deploy/.env` and can install dependencies, build images, pull OpenViking, and start Compose. It does not ask for an AI provider. It prints the URL. Default publish is http://100.96.0.3:8787. Default login is `admin@localhost` / `changeme`. The first login asks for new credentials and stores them in sqlite. Set OpenViking embedding and VLM on the Config page (see [docs/openviking-setup.md](docs/openviking-setup.md) for the Cloudflare Workers AI setup). Chat models are connected on the Providers page with `opencode auth login` inside the user container.

`bun run update` rebuilds the desktop images, recreates the control container, and restarts running desktops. Volumes are kept, including browser logins and extra installed packages. `bun run update -- --pull-viking` also pulls OpenViking. `bun run update -- --dev` builds a development desktop that can file product reports; a later update without `--dev` turns filing off.
