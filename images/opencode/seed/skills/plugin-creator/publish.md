# Publish: dev tag while iterating, semver when green

Publish only after `testing.md`'s ladder passes on the installed payload. Publishing is a maintenance commitment — the `plugin:<slug>:guard` cron it creates is yours indefinitely.

## While iterating: the dev channel

Set `version` to a short lowercase tag (`beta-1`) and let one command run the whole loop — commit, push, force-move the `v<tag>` tag, clobber the release, publish, wait for review, reinstall pinned:

```sh
cd ~/plugins-create/NAME
ob-plugin publish ~/plugins-create/NAME --dev   # --no-commit if you already committed
```

Dev versions pass the same security review and consent as stable but stay out of marketplace search and never become "latest". Reinstalling the pinned version picks up a republish. Stay on dev tags through the whole stress-test phase.

## Pre-publish gate (every time)

1. `bun test` green.
2. `ob-plugin validate ~/plugins-create/NAME` clean.
3. `ob-plugin doctor ~/plugins-create/NAME` — manifest, repo reachability, `v<version>` tag, the `*.test.ts` run, CONFIG.md placeholder and privacy checks in one pass. Fix everything it flags before publishing.
4. **Privacy self-check:** load the `plugin-privacy` skill. No real names, contacts, addresses, keys, or schedule entries in any file — placeholders (`Acme Corp`, `Alex`, `example.com`) and runtime personalization only. The marketplace AI review rejects leaks and reads CONFIG.md as a steering vector, so CONFIG.md configures this plugin and nothing else.
5. CONFIG.md filled (when configs/vault exist), README written for the person deciding whether to install.

## First stable release

```sh
cd ~/plugins-create/NAME
# set version to 1.0.0 in the manifest first
ob-plugin validate ~/plugins-create/NAME
git init -b main && git add -A && git commit -m "v1.0.0"
gh repo create OWNER/NAME --public --source . --push
gh release create v1.0.0 -R OWNER/NAME --notes "First release"
ob-plugin publish ~/plugins-create/NAME
ob-plugin install NAME
```

The `repo` manifest field must match the GitHub repo, and a release tagged `v<version>` must exist — publish reads the manifest from that tag. `ob-plugin publish` queues the marketplace security review and waits up to 8 minutes for `pass` / `concern` / `error`. Reviews are sometimes flaky (slow, unparsable verdicts): republishing re-reviews; space the retries out instead of hammering. Address a `concern` on the merits (token handling, public-endpoint validation, privacy) before republishing.

## Every change after that

Bump `version` → test ladder → commit → `gh release create v<version>` → `ob-plugin publish` → `ob-plugin install NAME`. Never retag a stable version; never publish another creator's plugin under your name; never publish a manifest you did not validate.

## Premium (only when the user asks for a paid listing)

`pricing: {model: "one-time", amount: <USD cents, 99–50000>}` makes the listing paid; users buy once and own updates forever. If an install fails as unpurchased, relay the marketplace buy link to the user and stop — buying is a human step, never attempt to purchase.

## The guard cron is yours

Publish creates a daily `plugin:NAME:guard` job. When a message starts with `[cron: plugin:NAME:guard]`, run the maintenance pass from the `plugin` skill (GitHub issues/PRs, marketplace comments, fixes in this checkout, release when warranted). `ob-plugin guard status NAME` shows it; `guard off` only on plugins you published, only when maintenance should stop.

Report to the user in one or two sentences: what shipped, which version, and that it passed the stress test — or exactly what still fails.
