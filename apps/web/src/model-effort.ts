/**
 * Coordinated model + thinking-effort saves for the chat composer.
 *
 * The two settings are independent server resources (PUT /api/model,
 * PUT /api/thinking) but one UI owns both, so the writes are serialized
 * through a single queue: every save runs its PUT + /api/me reconciliation
 * to completion before the next starts. That gives a deterministic final
 * server state (last enqueued write per resource wins), which ignoring
 * stale responses in React alone cannot.
 *
 * Per-channel sequence numbers keep the UI honest while chains wait:
 * - a chain superseded before it runs does nothing (no wasted PUT);
 * - a chain finishing out of date never reverts the newer optimistic value
 *   and never adopts a stale /api/me snapshot;
 * - only the newest effort chain owns effortSaving, so the picker can never
 *   stay disabled forever (the old shared-counter bug: a model save bumped
 *   the shared sequence, the effort chain's finally skipped its clear).
 */

export type MeModelInfo = {
  providerID?: string
  modelID?: string
  thinkingEffort?: string
}

export type MeLike = { model?: MeModelInfo }

export type SettingsSaverDeps = {
  putModel: (modelKey: string) => Promise<void>
  putThinking: (effort: string) => Promise<void>
  fetchMe: () => Promise<MeLike>
  /** Server truth (already persisted) to adopt into the picker state. */
  adoptServer: (me: MeLike) => void
  revertModel: (previous: string) => void
  revertEffort: (previous: string) => void
  setEffortSaving: (saving: boolean) => void
  onError: (message: string) => void
  isTeamLocked: (caught: unknown) => boolean
}

export type SettingsSaver = {
  selectModel(input: { value: string; previous: string }): void
  selectEffort(input: { value: string; previous: string }): void
  /** True while any save chain is queued or running. */
  busy(): boolean
  /** True while at least one effort save is queued or running. */
  effortPending(): boolean
}

export function createSettingsSaver(deps: SettingsSaverDeps): SettingsSaver {
  let modelSeq = 0
  let effortSeq = 0
  let runningOrQueued = 0
  let effortChains = 0
  let tail: Promise<void> = Promise.resolve()

  /** One chain at a time; a chain never throws (it reports through deps). */
  function enqueue(step: () => Promise<void>) {
    runningOrQueued += 1
    const run = tail.then(step, step)
    tail = run.then(
      () => {},
      () => {},
    )
    void run.then(
      () => {
        runningOrQueued -= 1
      },
      () => {
        runningOrQueued -= 1
      },
    )
  }

  function message(caught: unknown, fallback: string): string {
    if (deps.isTeamLocked(caught)) return "managed by your team admin"
    return caught instanceof Error && caught.message ? caught.message : fallback
  }

  return {
    selectModel({ value, previous }) {
      const split = value.indexOf("/")
      const providerID = split > 0 ? value.slice(0, split) : ""
      const modelID = split > 0 ? value.slice(split + 1) : ""
      if (!providerID || !modelID) return
      const seq = ++modelSeq
      enqueue(async () => {
        try {
          await deps.putModel(`${providerID}/${modelID}`)
        } catch (caught) {
          if (seq !== modelSeq) return
          deps.revertModel(previous)
          deps.onError(
            deps.isTeamLocked(caught)
              ? "the model is managed by your team admin"
              : message(caught, "model save failed"),
          )
          return
        }
        // The server re-validated the saved effort against the new model
        // and dropped it when unsupported; adopt the server answer so the
        // picker never claims a level the engine will not use.
        const me = await deps.fetchMe().catch(() => null)
        if (seq !== modelSeq) return
        if (me) deps.adoptServer(me)
      })
    },

    selectEffort({ value, previous }) {
      const seq = ++effortSeq
      effortChains += 1
      deps.setEffortSaving(true)
      enqueue(async () => {
        try {
          if (seq === effortSeq) {
            await deps.putThinking(value)
            const me = await deps.fetchMe().catch(() => null)
            if (seq === effortSeq && me) deps.adoptServer(me)
          }
          // Superseded while queued: the newer effort chain owns the
          // outcome — writing here would only race its newer value.
        } catch (caught) {
          if (seq === effortSeq) {
            deps.revertEffort(previous)
            deps.onError(
              deps.isTeamLocked(caught)
                ? "thinking effort is managed by your team admin"
                : message(caught, "thinking effort save failed"),
            )
          }
        } finally {
          effortChains -= 1
          // Only the newest chain may release the busy flag: an older
          // chain whose successor is already queued would otherwise clear
          // the flag that successor just raised.
          if (seq === effortSeq) deps.setEffortSaving(false)
        }
      })
    },

    busy() {
      return runningOrQueued > 0
    },

    effortPending() {
      return effortChains > 0
    },
  }
}
