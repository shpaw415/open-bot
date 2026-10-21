import {
  connectCdpSocket,
  evaluate,
  listPageTargets,
  type PageTarget,
} from "./cdp"

// A renderer that never answers its probe is crashed or frozen (the OOM
// "Aw Snap" class). Closing it frees the agent's CDP ladder from timeouts
// on every later call; healthy targets are never touched.
const PROBE_TIMEOUT_MS = 2_500
const CLOSE_TIMEOUT_MS = 2_000

export type SweepResult = {
  swept: number
  closed: { id: string; url: string; reason: string }[]
  kept: number
}

function raced<T>(promise: Promise<T>, timeout: number, label: string) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), timeout),
    ),
  ])
}

async function defaultProbe(
  port: number,
  target: PageTarget,
): Promise<string | null> {
  let socket: Parameters<typeof evaluate>[0] | null = null
  try {
    socket = await raced(
      connectCdpSocket(port, target.id),
      PROBE_TIMEOUT_MS,
      "probe socket",
    )
  } catch (error) {
    return error instanceof Error ? error.message : "no socket"
  }
  try {
    const answered = await raced(
      evaluate(socket, "1").then(
        () => null,
        (error: unknown) =>
          error instanceof Error ? error.message : "evaluate failed",
      ),
      PROBE_TIMEOUT_MS,
      "probe",
    )
    return answered
  } catch (error) {
    return error instanceof Error ? error.message : "probe timed out"
  } finally {
    socket.close()
  }
}

/**
 * Probe/close hooks, both injectable for tests.
 */
export type SweepHooks = {
  probe?: (port: number, target: PageTarget) => Promise<string | null>
  close?: (target: PageTarget, reason: string) => Promise<boolean>
}

async function defaultClose(
  port: number,
  target: PageTarget,
): Promise<boolean> {
  const response = await fetch(
    `http://127.0.0.1:${port}/json/close/${encodeURIComponent(target.id)}`,
    { signal: AbortSignal.timeout(CLOSE_TIMEOUT_MS) },
  ).catch(() => null)
  return Boolean(response?.ok)
}

/**
 * Probe every page target with a trivial evaluate and close the ones that
 * do not answer. When nothing answers, the browser itself is wedged — tabs
 * are left alone so the screen heal path can restart Chromium wholesale.
 * Both hooks are injectable for tests.
 */
export async function sweepZombies(
  port: number,
  hooks: SweepHooks = {},
): Promise<SweepResult> {
  const probe = hooks.probe ?? defaultProbe
  const close = hooks.close ?? ((target) => defaultClose(port, target))
  const targets = await listPageTargets(port)
  if (targets.length === 0) return { swept: 0, closed: [], kept: 0 }
  const results = await Promise.all(
    targets.map(async (target) => ({
      target,
      reason: await probe(port, target),
    })),
  )
  const zombies = results.filter((row) => row.reason !== null)
  // Every target dead = a wedged browser, not a bad tab; heal owns that.
  if (zombies.length === targets.length)
    return { swept: targets.length, closed: [], kept: targets.length }
  const closed: SweepResult["closed"] = []
  for (const zombie of zombies) {
    const ok = await close(zombie.target, zombie.reason ?? "unresponsive")
    if (ok)
      closed.push({
        id: zombie.target.id,
        url: zombie.target.url,
        reason: zombie.reason ?? "unresponsive",
      })
  }
  return { swept: targets.length, closed, kept: targets.length - closed.length }
}

const USAGE = "usage: tab-sweep.ts PORT"

async function main() {
  const port = Number(process.argv[2])
  if (!Number.isInteger(port)) throw new Error(USAGE)
  console.log(JSON.stringify(await sweepZombies(port)))
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "tab sweep failed")
    process.exit(1)
  })
}
