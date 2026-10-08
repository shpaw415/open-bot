import { describe, expect, test } from "bun:test"
import {
  clipScriptOutput,
  cronModelFields,
  cronPersonaFields,
  cronPrompt,
  cronResultMessage,
  cronRunBody,
  interpretScriptRun,
  nextCronTime,
  nextRunMs,
  normalizeCronRun,
  parseCron,
  publishDecision,
  publishedSummary,
  scriptBlocksAgent,
  scriptJobError,
  scriptThreadText,
} from "./cron"

const T = (iso: string) => Date.parse(iso)

describe("cron publish", () => {
  const started = T("2026-10-06T10:00:00Z")

  test("prompt runs in a temporary session and the full result lands in the job thread", () => {
    const text = cronPrompt({ name: "daily", message: "Check the log" })
    expect(text).toContain("[cron: daily]")
    expect(text).toContain("Check the log")
    expect(text).toContain("temporary session")
    expect(cronResultMessage("daily", "found 3")).toBe(
      "[cron-result: daily]\n\nfound 3",
    )
  })

  test("summary is the latest finished assistant reply after the fire", () => {
    const messages = [
      {
        info: {
          role: "assistant",
          time: { created: started - 60_000, completed: started - 50_000 },
        },
        parts: [{ type: "text", text: "old result" }],
      },
      {
        info: {
          role: "assistant",
          time: { created: started + 1_000, completed: started + 2_000 },
        },
        parts: [{ type: "text", text: "found 3 changes" }],
      },
    ]
    expect(publishedSummary(messages, started)).toBe("found 3 changes")
    expect(publishedSummary([{ info: { role: "user" } }], started)).toBeNull()
  })

  test("waits while the agent is busy and settles once a result exists", () => {
    expect(
      publishDecision({
        now: started + 5_000,
        startedAt: started,
        desktopUp: true,
        sessionMissing: false,
        busy: true,
        seenBusy: true,
        summary: null,
      }),
    ).toBe("wait")
    expect(
      publishDecision({
        now: started + 30_000,
        startedAt: started,
        desktopUp: true,
        sessionMissing: false,
        busy: false,
        seenBusy: false,
        summary: null,
      }),
    ).toBe("wait")
    expect(
      publishDecision({
        now: started + 5_000,
        startedAt: started,
        desktopUp: true,
        sessionMissing: false,
        busy: true,
        seenBusy: true,
        summary: "done",
      }),
    ).toBe("settle")
    expect(
      publishDecision({
        now: started + 30_000,
        startedAt: started,
        desktopUp: false,
        sessionMissing: false,
        busy: false,
        seenBusy: false,
        summary: null,
      }),
    ).toBe("wait")
    expect(
      publishDecision({
        now: started + 21 * 60_000,
        startedAt: started,
        desktopUp: false,
        sessionMissing: true,
        busy: false,
        seenBusy: false,
        summary: null,
      }),
    ).toBe("settle")
  })
})

describe("cron expression parsing", () => {
  test("rejects malformed expressions", () => {
    expect(() => parseCron("* * * *")).toThrow(/5 fields/)
    expect(() => parseCron("* * * * * *")).toThrow(/5 fields/)
    expect(() => parseCron("60 * * * *")).toThrow(/minute/)
    expect(() => parseCron("* 24 * * *")).toThrow(/hour/)
    expect(() => parseCron("* * 0 * *")).toThrow(/day-of-month/)
    expect(() => parseCron("* * * 13 *")).toThrow(/month/)
    expect(() => parseCron("* * * * 8")).toThrow(/day-of-week/)
    expect(() => parseCron("a * * * *")).toThrow(/minute/)
    expect(() => parseCron("*/0 * * * *")).toThrow(/step/)
    expect(() => parseCron("1-2-3 * * * *")).toThrow(/minute/)
  })

  test("accepts ranges, lists, steps, and sunday as 7", () => {
    expect(() => parseCron("1,5,9 * * * *")).not.toThrow()
    expect(() => parseCron("0 8-18 * * 1-5")).not.toThrow()
    expect(() => parseCron("*/15 * * * *")).not.toThrow()
    expect(() => parseCron("5/15 * * * *")).not.toThrow()
    const fields = parseCron("* * * * 7")
    expect(fields.dow.has(0)).toBe(true)
    expect(fields.domStar).toBe(true)
    expect(fields.dowStar).toBe(false)
    const both = parseCron("0 0 1 * 1")
    expect(both.domStar).toBe(false)
    expect(both.dowStar).toBe(false)
  })
})

describe("nextCronTime", () => {
  test("every fifteen minutes lands on the next quarter", () => {
    const from = T("2026-10-06T10:07:30Z")
    expect(nextCronTime("*/15 * * * *", from)).toBe(T("2026-10-06T10:15:00Z"))
  })

  test("daily at 09:00 utc rolls to tomorrow when past", () => {
    expect(nextCronTime("0 9 * * *", T("2026-10-06T08:59Z"))).toBe(
      T("2026-10-06T09:00:00Z"),
    )
    expect(nextCronTime("0 9 * * *", T("2026-10-06T09:00Z"))).toBe(
      T("2026-10-07T09:00:00Z"),
    )
  })

  test("weekdays only skips the weekend", () => {
    // 2026-10-09 is a Friday, 2026-10-10 a Saturday
    expect(nextCronTime("0 12 * * 1-5", T("2026-10-09T13:00Z"))).toBe(
      T("2026-10-12T12:00:00Z"),
    )
  })

  test("month rollover finds the next monthly run", () => {
    expect(nextCronTime("30 1 1 * *", T("2026-10-06T00:00Z"))).toBe(
      T("2026-11-01T01:30:00Z"),
    )
  })

  test("february 29 waits for a leap year", () => {
    expect(nextCronTime("0 0 29 2 *", T("2026-10-06T00:00Z"))).toBe(
      T("2028-02-29T00:00:00Z"),
    )
  })

  test("dom and dow both restricted match as a union", () => {
    // 1st of month or any Monday, at 00:00. 2026-10-06 is a Tuesday,
    // 2026-10-07+8+9 are Wed-Fri, so first hit is Monday 2026-10-12
    // unless the 1st (already past) counts. Next: Monday 12th.
    expect(nextCronTime("0 0 1 * 1", T("2026-10-06T10:00Z"))).toBe(
      T("2026-10-12T00:00:00Z"),
    )
  })

  test("invalid expressions yield null instead of throwing", () => {
    expect(nextCronTime("bogus", Date.now())).toBeNull()
  })
})

describe("nextRunMs", () => {
  const base = 1_000_000

  test("every schedules from the reference time", () => {
    expect(
      nextRunMs(
        {
          id: "j",
          userId: "u",
          name: "n",
          message: "m",
          kind: "every",
          cronExpr: null,
          everySeconds: 90,
          atMs: null,
          enabled: true,
          deleteAfterRun: false,
          sessionId: null,
          createdAt: 0,
          lastRunAt: null,
          nextRunAt: null,
          runCount: 0,
          lastError: null,
          providerId: null,
          modelId: null,
          personaId: null,
          runKind: "prompt",
          script: null,
        },
        base,
      ),
    ).toBe(base + 90_000)
  })

  test("one-shot at returns its fixed time", () => {
    expect(
      nextRunMs(
        {
          id: "j",
          userId: "u",
          name: "n",
          message: "m",
          kind: "at",
          cronExpr: null,
          everySeconds: null,
          atMs: 123_456,
          enabled: true,
          deleteAfterRun: true,
          sessionId: null,
          createdAt: 0,
          lastRunAt: null,
          nextRunAt: null,
          runCount: 0,
          lastError: null,
          providerId: null,
          modelId: null,
          personaId: null,
          runKind: "prompt",
          script: null,
        },
        base,
      ),
    ).toBe(123_456)
  })
})

describe("cron model and personality", () => {
  test("parses a provider/model and clears an empty value", () => {
    expect(cronModelFields({ model: "grok/grok-4.5" })).toEqual({
      providerId: "grok",
      modelId: "grok-4.5",
    })
    expect(cronModelFields({ model: "@cf/zai-org/glm-5.3" })).toEqual({
      providerId: "@cf",
      modelId: "zai-org/glm-5.3",
    })
    expect(cronModelFields({ model: "" })).toEqual({
      providerId: null,
      modelId: null,
    })
    expect(cronModelFields({})).toEqual({ omitted: true })
    expect(cronModelFields({ providerID: "grok" })).toEqual({
      error: "provider and model are both required",
    })
  })

  test("rejects an unknown personality and stores assistant as unset", () => {
    const exists = (id: string) => id === "designer"
    expect(cronPersonaFields({ personaId: "designer" }, exists)).toEqual({
      personaId: "designer",
    })
    expect(cronPersonaFields({ personaId: "assistant" }, exists)).toEqual({
      personaId: null,
    })
    expect(cronPersonaFields({ personaId: "missing" }, exists)).toEqual({
      error: "personality not found",
    })
    expect(cronPersonaFields({}, exists)).toEqual({ omitted: true })
  })

  test("puts the model and personality on the run, not the result text", () => {
    const body = cronRunBody({
      name: "daily",
      message: "check the log",
      providerId: "grok",
      modelId: "grok-4.5",
      screenSystem: "screen :1",
      personaLine: "For this thread only, answer as Designer.",
    })
    expect(body.model).toEqual({ providerID: "grok", modelID: "grok-4.5" })
    expect(body.system).toContain("screen :1")
    expect(body.system).toContain("answer as Designer")
    expect(body.parts[0]?.text.startsWith("[cron: daily]")).toBe(true)
    const plain = cronRunBody({
      name: "daily",
      message: "check",
      providerId: null,
      modelId: null,
      screenSystem: "screen",
      personaLine: null,
    })
    expect(plain.model).toBeUndefined()
    expect(plain.system).toBe("screen")
  })

  test("adds script output to the prompt and not the result marker", () => {
    const text = cronPrompt({
      name: "disk",
      message: "Say if this is full",
      scriptOutput: "use 80%",
      scriptExit: 0,
    })
    expect(text).toContain("Say if this is full")
    expect(text).toContain("Script output (exit 0):\nuse 80%")
    expect(text.indexOf("Script output")).toBeGreaterThan(
      text.indexOf("Say if this is full"),
    )
    const body = cronRunBody({
      name: "disk",
      message: "Say if this is full",
      providerId: null,
      modelId: null,
      screenSystem: "screen",
      personaLine: null,
      scriptOutput: "use 80%",
      scriptExit: 1,
    })
    expect(body.parts[0]?.text).toContain("exit 1")
  })
})

describe("cron script runs", () => {
  test("requires a message or a script for the chosen mode", () => {
    expect(
      normalizeCronRun({ runKind: "prompt", message: "  hi  ", script: null }),
    ).toEqual({ message: "hi", script: null })
    expect(
      normalizeCronRun({ runKind: "script", message: "", script: " date " }),
    ).toEqual({ message: "", script: "date" })
    expect(
      normalizeCronRun({
        runKind: "both",
        message: "summarize",
        script: "df -h",
      }),
    ).toEqual({ message: "summarize", script: "df -h" })
    expect(
      normalizeCronRun({ runKind: "prompt", message: " ", script: "date" }),
    ).toEqual({ error: "message is required" })
    expect(
      normalizeCronRun({ runKind: "both", message: "hi", script: "  " }),
    ).toEqual({ error: "script is required" })
    expect(
      normalizeCronRun({ runKind: "script", message: "", script: "" }),
    ).toEqual({ error: "script is required" })
  })

  test("posts script output and only blocks the agent on a failed start or timeout", () => {
    const ok = interpretScriptRun({
      code: 0,
      stdout: "ok\n",
      stderr: "",
      timedOut: false,
      spawnError: null,
    })
    expect(ok.output).toBe("ok")
    expect(scriptJobError(ok)).toBeNull()
    expect(scriptBlocksAgent(ok)).toBeNull()
    expect(scriptThreadText(ok)).toBe("ok")

    const failed = interpretScriptRun({
      code: 2,
      stdout: "partial",
      stderr: "nope",
      timedOut: false,
      spawnError: null,
    })
    expect(failed.output).toBe("partial\nnope")
    expect(scriptJobError(failed)).toBe("script exited 2")
    expect(scriptBlocksAgent(failed)).toBeNull()
    expect(scriptThreadText(failed)).toBe("partial\nnope")

    const timedOut = interpretScriptRun({
      code: null,
      stdout: "partial",
      stderr: "",
      timedOut: true,
      spawnError: null,
    })
    expect(scriptBlocksAgent(timedOut)).toBe("script timed out")
    expect(scriptThreadText(timedOut)).toContain("The script timed out.")

    const daemon = interpretScriptRun({
      code: 1,
      stdout: "",
      stderr: "Error response from daemon: No such container",
      timedOut: false,
      spawnError: null,
    })
    expect(daemon.started).toBe(false)
    expect(scriptBlocksAgent(daemon)).toContain("No such container")
    expect(clipScriptOutput("x".repeat(12_001)).endsWith("…")).toBe(true)
  })
})
