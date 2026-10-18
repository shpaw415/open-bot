import { describe, expect, test } from "bun:test"
import {
  createSettingsSaver,
  type MeLike,
  type SettingsSaverDeps,
} from "./model-effort"

/**
 * Deterministic fake transport. Every PUT/GET resolves through a gate the
 * test releases in order, so interleavings (model during effort save, rapid
 * taps) are reproduced exactly instead of hoped for.
 */
function makeDeps(options?: { dropEffortOnModelMove?: boolean }) {
  const calls: string[] = []
  const errors: string[] = []
  const state = {
    modelKey: "p/a",
    effort: "",
    failModel: null as Error | null,
    failEffort: null as Error | null,
  }
  const waiters: (() => void)[] = []

  const deps: SettingsSaverDeps = {
    async putModel(key) {
      calls.push(`putModel:${key}`)
      await gate()
      if (state.failModel) throw state.failModel
      state.modelKey = key
      // Server-side rule: a model move re-validates the saved effort and
      // drops it when the new model does not support it.
      if (options?.dropEffortOnModelMove) state.effort = ""
    },
    async putThinking(effort) {
      calls.push(`putThinking:${effort}`)
      await gate()
      if (state.failEffort) throw state.failEffort
      state.effort = effort
    },
    async fetchMe() {
      calls.push("fetchMe")
      await gate()
      const info: MeLike["model"] = {
        providerID: state.modelKey.split("/")[0],
        modelID: state.modelKey.split("/").slice(1).join("/"),
        thinkingEffort: state.effort,
      }
      return { model: info }
    },
    adoptServer(me) {
      calls.push(
        `adopt:${me.model?.providerID}/${me.model?.modelID}:${me.model?.thinkingEffort ?? ""}`,
      )
    },
    revertModel(previous) {
      calls.push(`revertModel:${previous}`)
    },
    revertEffort(previous) {
      calls.push(`revertEffort:${previous}`)
    },
    setEffortSaving(saving) {
      calls.push(`effortSaving:${saving ? "on" : "off"}`)
    },
    onError(message) {
      errors.push(message)
    },
    isTeamLocked: (caught) =>
      caught instanceof Error && caught.message === "team_locked",
  }
  const saver = createSettingsSaver(deps)
  return { saver, calls, errors, state, waiters }

  function gate() {
    return new Promise<void>((resolve) => {
      waiters.push(resolve)
    })
  }
}

/** Release every pending gate in order and let all queued chains complete. */
async function flush(waiters: (() => void)[]) {
  for (;;) {
    while (waiters.length) {
      const release = waiters.shift()
      release?.()
    }
    // A macrotask drains every microtask: chains advance, register their
    // next gate, and completion handlers (busy-flag release) settle.
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (waiters.length === 0) break
  }
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Let the queue start the next chain up to (and including) its first gate. */
async function startChain() {
  await Promise.resolve()
  await Promise.resolve()
}

describe("settings saver — model / effort coordination", () => {
  test("a plain effort save: put → me → adopt → saving off", async () => {
    const { saver, calls, waiters } = makeDeps()
    saver.selectEffort({ value: "high", previous: "" })
    expect(calls).toEqual(["effortSaving:on"])
    await startChain()
    expect(calls[1]).toBe("putThinking:high")
    await flush(waiters)
    expect(calls).toContain("adopt:p/a:high")
    expect(calls).toContain("effortSaving:off")
    expect(saver.busy()).toBe(false)
    expect(saver.effortPending()).toBe(false)
  })

  test("the original bug: a model save during an effort save must not leave effortSaving stuck", async () => {
    const { saver, calls, waiters, errors } = makeDeps()
    // 1. the effort save starts (queued first)
    saver.selectEffort({ value: "high", previous: "" })
    // 2. the model save starts before the effort chain resolved — the old
    //    shared sequence counter made the effort chain's finally skip its
    //    clear, disabling the picker forever.
    saver.selectModel({ value: "p/b", previous: "p/a" })
    await flush(waiters)
    expect(calls).toContain("effortSaving:off")
    expect(saver.effortPending()).toBe(false)
    expect(saver.busy()).toBe(false)
    // Both writes landed, in queue order, and the final server truth won.
    expect(calls.filter((call) => call.startsWith("putThinking"))).toEqual([
      "putThinking:high",
    ])
    expect(calls.filter((call) => call.startsWith("putModel"))).toEqual([
      "putModel:p/b",
    ])
    expect(calls.filter((call) => call.startsWith("adopt"))).toEqual([
      "adopt:p/a:high",
      "adopt:p/b:high",
    ])
    expect(errors).toEqual([])
  })

  test("rapid effort taps: the superseded chain skips its write, the newest wins", async () => {
    const { saver, calls, waiters } = makeDeps()
    saver.selectEffort({ value: "low", previous: "" })
    // Tapped again before the first chain ran: its PUT is skipped entirely
    // (no wasted write that would only be overwritten).
    saver.selectEffort({ value: "high", previous: "low" })
    await flush(waiters)
    expect(calls.filter((call) => call.startsWith("putThinking"))).toEqual([
      "putThinking:high",
    ])
    expect(calls.filter((call) => call.startsWith("adopt")).pop()).toBe(
      "adopt:p/a:high",
    )
    expect(calls.filter((call) => call === "effortSaving:off")).toHaveLength(1)
    expect(saver.effortPending()).toBe(false)
  })

  test("an effort failure reverts to the previous value and reports once", async () => {
    const { saver, calls, waiters, errors, state } = makeDeps()
    state.failEffort = new Error("boom")
    saver.selectEffort({ value: "high", previous: "low" })
    await flush(waiters)
    expect(calls).toContain("revertEffort:low")
    expect(errors).toEqual(["boom"])
    expect(calls).toContain("effortSaving:off")
    expect(saver.effortPending()).toBe(false)
  })

  test("a superseded chain's failure stays quiet; the newest chain's failure reverts to ITS previous", async () => {
    const env = makeDeps()
    env.state.failEffort = new Error("boom")
    env.saver.selectEffort({ value: "high", previous: "low" })
    await startChain()
    // The user taps again before the first chain resolved. Both PUTs fail:
    // the old chain's failure is ignored (a newer pick owns the outcome),
    // the newest chain's failure reverts to its own previous value.
    env.saver.selectEffort({ value: "max", previous: "high" })
    await flush(env.waiters)
    expect(env.errors).toEqual(["boom"])
    expect(env.calls).toContain("revertEffort:high")
    expect(env.calls).not.toContain("revertEffort:low")
    expect(env.calls.filter((call) => call.startsWith("putThinking"))).toEqual([
      "putThinking:high",
      "putThinking:max",
    ])
    expect(
      env.calls.filter((call) => call === "effortSaving:off"),
    ).toHaveLength(1)
    expect(env.saver.effortPending()).toBe(false)
  })

  test("a team-locked effort save reports the team message", async () => {
    const env = makeDeps()
    env.state.failEffort = new Error("team_locked")
    env.saver.selectEffort({ value: "high", previous: "low" })
    await flush(env.waiters)
    expect(env.errors).toEqual([
      "thinking effort is managed by your team admin",
    ])
    expect(env.calls).toContain("revertEffort:low")
  })

  test("a model failure reverts the model and never adopts a stale /api/me", async () => {
    const env = makeDeps()
    env.state.failModel = new Error("offline")
    env.saver.selectModel({ value: "p/b", previous: "p/a" })
    await flush(env.waiters)
    expect(env.calls).toContain("revertModel:p/a")
    expect(env.errors).toEqual(["offline"])
    expect(env.calls.filter((call) => call.startsWith("adopt"))).toEqual([])
    expect(env.saver.busy()).toBe(false)
  })

  test("when a model move drops the saved effort server-side, the drop is adopted", async () => {
    const env = makeDeps({ dropEffortOnModelMove: true })
    env.state.effort = "high"
    env.saver.selectModel({ value: "p/b", previous: "p/a" })
    await flush(env.waiters)
    expect(env.calls.filter((call) => call.startsWith("adopt")).pop()).toBe(
      "adopt:p/b:",
    )
  })

  test("a model save queued behind an effort save does not clobber the queued pick", async () => {
    const env = makeDeps()
    env.saver.selectEffort({ value: "high", previous: "" })
    env.saver.selectModel({ value: "p/b", previous: "p/a" })
    await flush(env.waiters)
    // Final server truth: model p/b with effort high. The model chain's
    // /api/me ran while the effort chain was still pending, so its older
    // snapshot was not allowed to overwrite the queued effort.
    expect(env.calls.filter((call) => call.startsWith("adopt")).pop()).toBe(
      "adopt:p/b:high",
    )
    expect(env.saver.busy()).toBe(false)
  })

  test("an invalid model key never starts a save", () => {
    const env = makeDeps()
    env.saver.selectModel({ value: "no-slash", previous: "p/a" })
    expect(env.saver.busy()).toBe(false)
    expect(env.calls).toEqual([])
  })
})
