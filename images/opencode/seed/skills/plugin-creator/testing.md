# Testing: cheapest first, never ship untested

Run the ladder in order and stop at the first failure. Each rung is an order of magnitude more expensive than the one before — a manifest typo caught by rung 1 must never reach the browser rung.

## The ladder

1. **`bun test`** from the plugin root. The scaffold ships `smoke.test.ts` (manifest well-formed, every `files[]` source exists, page entry declared). Grow it — see the test convention below. `ob-plugin doctor` runs `*.test.ts` automatically (failures advisory there, blocking for you here).
2. **Run it directly.** Tools: invoke the script with real and edge-case args. Servers: `bun server/server.ts` with a throwaway `OPEN_BOT_PAGE_PORT`, then `curl` `/healthz` and each route. Cron scripts: run the script body once by hand.
3. **`ob-plugin validate ~/plugins-create/<slug>`** — fix every issue in one pass.
4. **`ob-plugin install --path ~/plugins-create/<slug>`** and test the *installed* payload, never the draft: run the `ob-plugin-<id>-*` binaries, read the installed skill copy (`openviking_read viking://user/skills/<name>/SKILL.md`) and follow it literally.
5. **UI only: click-test.** `ob-plugin page <id>` prints the port; `ob-chrome navigate http://127.0.0.1:<port>/` + `ob-page` drives the real page. Local installs run `bun --hot`, so checkout edits apply live. Test **both** `prefers-color-scheme` values. In-thread preview for the user: `ob-preview up --entry ~/plugins-create/<slug>/server/server.ts` + the `![title](open-bot://preview)` marker.
6. **Stress-test** with the `stress-test` skill before any publish (and after any behavior change): 3–5 cases from the user's seat — happy path end-to-end, missing/default config, hostile input (empty / very long / unicode / nonsense), dependency-down failure path, and a repeat run that must not corrupt state. File defects with `ob-report`, iterate, cap at 3 rounds. Personas and cron jobs are exercised via one-shot `ob-cron` runs (`--persona`, `ob-cron run`) since the current thread cannot switch.

## The test convention

- Tests are `*.test.ts` at the plugin root, run with `bun test`, written with `bun:test`. They are **not** declared in `files[]`, so they never ship — but they are committed to the repo and the doctor runs them on every pre-publish check.
- Keep `smoke.test.ts` and add one `describe` per surface you ship. Priorities, in order:
  1. Pure logic (parsing, shaping, guards) — export it from the module and assert on it directly. Free to run, no ports.
  2. Tool entry behavior with bad input: exit code and the single `{error}` JSON line.
  3. Server routes: spawn your own instance (below) and assert `/healthz`, the main route's happy path, and one hostile request.
- Tests are **hermetic**: no network beyond loopback, no reliance on another plugin being installed, no clock-dependent assertions. A test that needs a key tests the *key-missing* path instead — that path is a feature.
- **Guard/auto scripts get the silence test:** stub the CLIs they call (fixture files + PATH stubs in a temp `HOME`), then assert the contract — first run emits `[cron-agent]` with the items, an immediate second run prints *nothing*, a new/changed fixture line emits only that line, and a failing fetch exits non-zero without advancing the seen state (the next good run still emits the item). The same shape tests any loop-batching tool: one call over a multi-page fixture returns the complete result.

## The data-safety rule (non-negotiable)

A harness that hits a live server must never be able to touch real user data — a real plugin's cleanup once deleted every live vault account because it ran against the default port. Always:

- Spawn **your own** server instance on a throwaway port (env `OPEN_BOT_PAGE_PORT=0` picks an ephemeral one — read the actual port from the server handle or stdout, never assume).
- Point every data/config env (`DATA_DIR`, config paths, sqlite paths, `OPEN_BOT_PAGE_TOKEN`) at a **fresh temp directory / test value**.
- Before any cleanup or delete, assert the target is that temp directory. Refuse to run against a default port, default path, or missing env.

Skeleton for the server rung:

```ts
import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("server answers healthz and the main route on a throwaway instance", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ob-plugin-test-"))
  const proc = Bun.spawn(["bun", "server/server.ts"], {
    cwd: import.meta.dir,
    env: {
      ...process.env,
      OPEN_BOT_PAGE_PORT: "4891", // throwaway, never the 4740-4759 live range
      OPEN_BOT_PAGE_TOKEN: "test-token",
      DATA_DIR: dataDir,
    },
    stdout: "ignore",
    stderr: "ignore",
  })
  try {
    // poll /healthz until the server is up (bounded)
    let up = false
    for (let i = 0; i < 50 && !up; i++) {
      up = await fetch("http://127.0.0.1:4891/healthz")
        .then((r) => r.ok)
        .catch(() => false)
      if (!up) await Bun.sleep(100)
    }
    expect(up).toBe(true)
    const res = await fetch("http://127.0.0.1:4891/api/ping", {
      headers: { "x-open-bot-page-token": "test-token" },
    })
    expect(res.ok).toBe(true)
  } finally {
    proc.kill()
    await proc.exited
  }
})
```

## When something fails

- A real plugin bug: fix in the checkout, re-run the ladder from rung 1 for that surface. Never patch the installed payload — it hides the bug and the next install resurrects it.
- Work left after this thread: `ob-report add --plugin <slug> --kind bug --title "..." --detail "Expected: ... Actual: ... Repeat: ..."`. A defect in open-bot itself surfaced by the test: `ob-improve add`. No secrets in any report.
- Save a working harness (ports, commands, assertions) as a `shortcut` skill so the next session reuses it instead of re-deriving it.
