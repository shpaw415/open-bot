import { describe, expect, test } from "bun:test"
import { delegatedBusyIds, parseDelegationWatches } from "./delegations"

describe("parseDelegationWatches", () => {
  test("keeps well-formed rows and drops malformed ones", () => {
    const rows = parseDelegationWatches({
      watches: [
        {
          kind: "council",
          creator: "chat1",
          subject: "m1",
          councilId: "c1",
        },
        { kind: "persona", creator: "chat2", subject: "mate1" },
        { creator: "chat3" }, // no subject
        { subject: "m2" }, // no creator
        { kind: "council", creator: "same", subject: "same" }, // self-watch
        42,
      ],
    })
    expect(rows).toEqual([
      { kind: "council", creator: "chat1", subject: "m1", councilId: "c1" },
      { kind: "persona", creator: "chat2", subject: "mate1", councilId: null },
    ])
  })

  test("a missing or non-object body is an empty list", () => {
    expect(parseDelegationWatches(null)).toEqual([])
    expect(parseDelegationWatches({})).toEqual([])
    expect(parseDelegationWatches({ watches: "nope" })).toEqual([])
  })

  test("an unknown kind falls back to council", () => {
    const rows = parseDelegationWatches({
      watches: [{ kind: "other", creator: "a", subject: "b" }],
    })
    expect(rows[0]?.kind).toBe("council")
  })
})

describe("delegatedBusyIds", () => {
  const watches = [
    {
      kind: "council" as const,
      creator: "chat1",
      subject: "m1",
      councilId: "c1",
    },
    {
      kind: "council" as const,
      creator: "chat1",
      subject: "m2",
      councilId: "c1",
    },
    {
      kind: "persona" as const,
      creator: "chat2",
      subject: "mate1",
      councilId: null,
    },
  ]

  test("a busy hidden subject lifts onto its creator", () => {
    const busy = delegatedBusyIds(
      watches,
      (id) => id === "m1",
      new Set(["chat1", "chat2"]),
    )
    expect(busy.has("chat1")).toBe(true)
    expect(busy.has("chat2")).toBe(false)
  })

  test("a visible busy subject never duplicates onto the creator", () => {
    const busy = delegatedBusyIds(
      watches,
      (id) => id === "mate1",
      new Set(["chat2", "mate1"]),
    )
    expect(busy.has("chat2")).toBe(false)
    expect(busy.size).toBe(0)
  })

  test("an all-idle council lifts nothing", () => {
    const busy = delegatedBusyIds(watches, () => false, new Set(["chat1"]))
    expect(busy.size).toBe(0)
  })

  test("no watches means no lifted rows", () => {
    expect(delegatedBusyIds([], () => true, new Set()).size).toBe(0)
  })
})
