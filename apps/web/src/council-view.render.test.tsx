import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { type CouncilData, CouncilOverlay } from "./CouncilView"
import type { StreamEvent } from "./chat-view"

const data: CouncilData = {
  id: "c1",
  name: "auth-review",
  createdAt: 1,
  members: [
    {
      sessionId: "s1",
      role: "reviewer",
      title: "worker: reviewer-alice",
      createdAt: 1,
    },
    {
      sessionId: "s2",
      role: "implementer",
      title: "worker: builder-bob",
      createdAt: 2,
    },
  ],
  subagents: [
    { sessionId: "s3", parentId: "s1", title: "worker: scout", createdAt: 3 },
  ],
}

const baseProps = {
  data,
  selectedId: "s1",
  statusOf: (sessionId: string) =>
    sessionId === "s1" ? { type: "running" } : { type: "idle" },
  onClose: () => {},
  onSelect: () => {},
  subscribe: (_listener: (event: StreamEvent) => void) => () => {},
  live: false,
}

describe("CouncilOverlay — render", () => {
  test("mobile renders the chip strip above a full-width transcript", () => {
    const html = renderToStaticMarkup(<CouncilOverlay {...baseProps} mobile />)
    expect(html).toContain("ob-council-strip")
    // Strip order: members first, subagents last.
    const alice = html.indexOf("reviewer-alice")
    const bob = html.indexOf("builder-bob")
    const scout = html.indexOf("scout")
    expect(alice).toBeGreaterThanOrEqual(0)
    expect(bob).toBeGreaterThan(alice)
    expect(scout).toBeGreaterThan(bob)
    expect(html).toContain("Subagents")
  })

  test("desktop keeps the rail + transcript row without the strip", () => {
    const html = renderToStaticMarkup(
      <CouncilOverlay {...baseProps} mobile={false} />,
    )
    expect(html).not.toContain("ob-council-strip")
    expect(html).toContain("reviewer-alice")
    expect(html).toContain("builder-bob")
  })

  test("mobile strip says so when the council has no members", () => {
    const html = renderToStaticMarkup(
      <CouncilOverlay
        {...baseProps}
        data={{ ...data, members: [], subagents: [] }}
        mobile
      />,
    )
    expect(html).toContain("No members in this council.")
  })
})
