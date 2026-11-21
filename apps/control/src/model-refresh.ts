import type { Db, Desktop } from "@open-bot/db"
import {
  endpoint,
  isRunning,
  opencodeExec,
  pendingRestart,
  restartOpencode,
} from "./docker"
import { basicOpencodeAuth, clearModelVariants } from "./effort"
import { names } from "./env"
import type { EventHub } from "./events"

// The opencode daemon loads its provider/model catalog (models.dev, cached
// in ~/.cache/opencode/models.json) into memory at startup and never
// reloads it, so a desktop that stays awake for days keeps offering the
// model list from its last boot — new releases never reach the picker
// (field 2026-11-20: GPT-6.2 released 2026-11-17 was invisible because
// the daemon had started 2026-11-16). This sweeper closes the gap: a
// fresh `opencode models <provider>` process reads the same cache and
// config a restarted daemon would, so its output is exactly what the
// picker would show after a restart. When that differs from what the
// daemon serves for a connected provider, the daemon restarts through
// the usual drain-aware path and the dashboard refetches on
// `models.changed`.

export const MODEL_REFRESH_SWEEP_MS = 15 * 60_000
const FIRST_SWEEP_MS = 30_000
const PROBE_TIMEOUT_SECONDS = 60
const CONFIRM_POLL_MS = 2_000
const CONFIRM_TIMEOUT_MS = 120_000

export type ServedCatalog = {
  connected: string[]
  /** "providerID/modelID" refs the daemon serves for connected providers. */
  models: Set<string>
}

/** The live daemon's `/provider` body as a comparable catalog. */
export function parseServedCatalog(body: unknown): ServedCatalog | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const record = body as { all?: unknown; connected?: unknown }
  const connected = Array.isArray(record.connected)
    ? record.connected.filter(
        (id): id is string => typeof id === "string" && id !== "",
      )
    : []
  if (connected.length === 0 || !Array.isArray(record.all)) return null
  const connectedSet = new Set(connected)
  const models = new Set<string>()
  for (const entry of record.all) {
    if (!entry || typeof entry !== "object") continue
    const provider = entry as { id?: unknown; models?: unknown }
    if (typeof provider.id !== "string" || !connectedSet.has(provider.id))
      continue
    if (
      !provider.models ||
      typeof provider.models !== "object" ||
      Array.isArray(provider.models)
    )
      continue
    for (const modelID of Object.keys(provider.models))
      models.add(`${provider.id}/${modelID}`)
  }
  return { connected, models }
}

/** `opencode models` stdout (one "provider/model" ref per line) as refs. */
export function parseCliModels(stdout: string): string[] {
  const refs: string[] = []
  for (const line of stdout.split("\n")) {
    const ref = line.trim()
    if (ref !== "" && ref.includes("/") && !/\s/.test(ref)) refs.push(ref)
  }
  return refs
}

function sortedRefs(models: Iterable<string>): string[] {
  return [...new Set(models)].sort()
}

/** Stable fingerprint of a model-ref set, for restart-loop suppression. */
export function catalogSignature(models: Iterable<string>): string {
  return sortedRefs(models).join("\n")
}

function providerOf(ref: string): string {
  const slash = ref.indexOf("/")
  return slash > 0 ? ref.slice(0, slash) : ""
}

/** Refs limited to the given providers (both sides compare the same scope). */
export function comparableCatalog(
  models: Iterable<string>,
  providers: Iterable<string>,
): Set<string> {
  const keep = new Set(providers)
  const out = new Set<string>()
  for (const ref of models) if (keep.has(providerOf(ref))) out.add(ref)
  return out
}

export function catalogsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const ref of a) if (!b.has(ref)) return false
  return true
}

export function catalogDiff(
  served: Set<string>,
  probed: Set<string>,
): { added: string[]; removed: string[] } {
  return {
    added: sortedRefs([...probed].filter((ref) => !served.has(ref))),
    removed: sortedRefs([...served].filter((ref) => !probed.has(ref))),
  }
}

async function servedCatalog(
  userId: string,
  desktop: Desktop,
): Promise<ServedCatalog | null> {
  try {
    const base = await endpoint(userId, "opencode", 4096)
    const response = await fetch(`${base}/provider`, {
      headers: basicOpencodeAuth(desktop.opencodePassword),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    return parseServedCatalog(await response.json())
  } catch {
    return null
  }
}

// One fresh CLI process per provider: the exact list a restarted daemon
// would serve. A failed/timed-out/empty probe is "unknown", never a
// mass removal, so a flaky exec cannot restart the daemon.
async function probeProviderModels(
  userId: string,
  providerId: string,
): Promise<string[] | null> {
  try {
    const result = await opencodeExec(userId, [
      "timeout",
      String(PROBE_TIMEOUT_SECONDS),
      "opencode",
      "models",
      providerId,
    ])
    if (result.code !== 0) return null
    const models = parseCliModels(result.stdout).filter((ref) =>
      ref.startsWith(`${providerId}/`),
    )
    return models.length > 0 ? models : null
  } catch {
    return null
  }
}

export type ModelRefreshDeps = {
  running: (userId: string) => Promise<boolean>
  served: (userId: string, desktop: Desktop) => Promise<ServedCatalog | null>
  probe: (userId: string, providerId: string) => Promise<string[] | null>
  restart: (
    userId: string,
    desktop: Desktop,
    db: Db,
    hub?: EventHub,
  ) => Promise<void>
  pending: (userId: string) => Promise<unknown> | undefined
  sleep: (ms: number) => Promise<void>
  now: () => number
}

const realDeps: ModelRefreshDeps = {
  running: (userId) => isRunning(names(userId).opencode),
  served: servedCatalog,
  probe: probeProviderModels,
  restart: (userId, desktop, db, hub) =>
    restartOpencode(userId, { db, desktop, hub }),
  pending: (userId) => pendingRestart(userId),
  sleep: (ms) => Bun.sleep(ms),
  now: () => Date.now(),
}

// Catalog fingerprints already restarted for, per user. If a daemon still
// serves something else after its restart (a probe/serve transform
// mismatch), the same catalog never restarts it twice; a converged sweep
// or a control-plane restart clears the guard.
const restartedFor = new Map<string, string>()
const checking = new Set<string>()
const confirming = new Set<string>()

export type ModelRefreshStatus =
  | "current"
  | "restarted"
  | "suppressed"
  | "skipped"
  | "unavailable"

export type ModelRefreshResult = {
  status: ModelRefreshStatus
  added: string[]
  removed: string[]
  /** Resolves true once the daemon serves the probed catalog. */
  confirmed?: Promise<boolean>
}

async function confirmModelRefresh(
  hub: EventHub | undefined,
  userId: string,
  desktop: Desktop,
  providers: string[],
  expected: Set<string>,
  deps: ModelRefreshDeps,
): Promise<boolean> {
  if (confirming.has(userId)) return false
  confirming.add(userId)
  try {
    // A deferred restart first waits out running threads (up to the
    // drain cap); the poll budget below covers the boot after it.
    const pending = deps.pending(userId)
    if (pending) await pending.catch(() => {})
    const deadline = deps.now() + CONFIRM_TIMEOUT_MS
    for (;;) {
      const served = await deps.served(userId, desktop)
      if (
        served &&
        catalogsEqual(comparableCatalog(served.models, providers), expected)
      ) {
        hub?.emit(userId, { type: "models.changed" })
        return true
      }
      if (deps.now() >= deadline) return false
      await deps.sleep(CONFIRM_POLL_MS)
    }
  } finally {
    confirming.delete(userId)
  }
}

/**
 * One user's catalog check. Running desktops only — a sleeping desktop
 * loads the current catalog on its next wake, so it is never woken for
 * this. On drift the daemon restarts through `restartOpencode` (busy
 * threads drain first) and the confirmation watcher emits
 * `models.changed` once the new daemon serves the probed catalog.
 */
export async function refreshUserModelCatalog(
  db: Db,
  hub: EventHub | undefined,
  userId: string,
  deps: ModelRefreshDeps = realDeps,
): Promise<ModelRefreshResult> {
  const empty = { added: [] as string[], removed: [] as string[] }
  const desktop = db.desktop(userId)
  if (!desktop || checking.has(userId)) return { status: "skipped", ...empty }
  checking.add(userId)
  try {
    if (!(await deps.running(userId))) return { status: "skipped", ...empty }
    const served = await deps.served(userId, desktop)
    if (!served) return { status: "unavailable", ...empty }

    const probed = new Set<string>()
    const probedProviders: string[] = []
    for (const providerId of served.connected) {
      const models = await deps.probe(userId, providerId)
      if (!models) continue
      probedProviders.push(providerId)
      for (const ref of models) probed.add(ref)
    }
    if (probedProviders.length === 0) return { status: "unavailable", ...empty }

    const servedComparable = comparableCatalog(served.models, probedProviders)
    if (catalogsEqual(servedComparable, probed)) {
      restartedFor.delete(userId)
      return { status: "current", ...empty }
    }

    const signature = catalogSignature(probed)
    const diff = catalogDiff(servedComparable, probed)
    if (restartedFor.get(userId) === signature)
      return { status: "suppressed", ...diff }
    restartedFor.set(userId, signature)

    clearModelVariants(userId)
    console.log(
      `model catalog changed for user ${userId} (+${diff.added.length}/-${diff.removed.length}: ${[...diff.added, ...diff.removed.map((ref) => `-${ref}`)].slice(0, 8).join(", ")}${diff.added.length + diff.removed.length > 8 ? ", …" : ""}); restarting OpenCode`,
    )
    await deps.restart(userId, desktop, db, hub)
    const confirmed = confirmModelRefresh(
      hub,
      userId,
      desktop,
      probedProviders,
      probed,
      deps,
    )
    // The sweeper never awaits confirmation (a deferred restart can wait
    // out a long turn); failures just mean no dashboard refetch event.
    confirmed.catch(() => {})
    return { status: "restarted", ...diff, confirmed }
  } finally {
    checking.delete(userId)
  }
}

export async function sweepModelCatalogs(
  db: Db,
  hub?: EventHub,
  deps: ModelRefreshDeps = realDeps,
) {
  for (const user of db.listUsers()) {
    if (user.disabled) continue
    try {
      await refreshUserModelCatalog(db, hub, user.id, deps)
    } catch {
      // desktop may be restarting
    }
  }
}

export function startModelCatalogRefresh(db: Db, hub?: EventHub) {
  // A first pass shortly after boot heals desktops that were already
  // stale when the control plane (re)started, instead of waiting out
  // the first interval.
  const first = setTimeout(
    () => void sweepModelCatalogs(db, hub),
    FIRST_SWEEP_MS,
  )
  first.unref?.()
  const timer = setInterval(
    () => void sweepModelCatalogs(db, hub),
    MODEL_REFRESH_SWEEP_MS,
  )
  timer.unref?.()
  return timer
}
