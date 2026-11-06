import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { patchSearch, searchParam } from "./back-nav"
import {
  type CouncilData,
  CouncilGroupSwitcher,
  CouncilOverlay,
  CouncilPane,
  CouncilTimeline,
  councilRunningIds,
  councilSwitchPatch,
  memberMetaText,
} from "./CouncilView"
import type { ChatMessage, ChatPart, StreamEvent } from "./chat-view"

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

describe("memberMetaText", () => {
  test("joins role, persona, model, and effort picks", () => {
    expect(
      memberMetaText({
        sessionId: "s1",
        role: "Reviewer",
        title: "worker:Token storage",
        createdAt: 1,
        persona: "Software manager",
        model: "prov/reasoner",
        effort: "high",
      }),
    ).toBe("Reviewer · Software manager · prov/reasoner · effort: high")
  })

  test("defaults stay invisible and role-as-label is not repeated", () => {
    expect(
      memberMetaText({
        sessionId: "s1",
        role: "Reviewer",
        title: "",
        createdAt: 1,
      }),
    ).toBe("")
    expect(
      memberMetaText({
        sessionId: "s1",
        role: "",
        title: "worker:Scan",
        createdAt: 1,
        model: "prov/plain",
      }),
    ).toBe("prov/plain")
  })
})

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

  const groups = [
    { name: "auth-review", members: 2, running: 1 },
    { name: "perf-check", members: 3, running: 0 },
  ]

  test("council groups render above the members so switching stays in the viewer", () => {
    for (const mobile of [false, true]) {
      const html = renderToStaticMarkup(
        <CouncilOverlay
          {...baseProps}
          mobile={mobile}
          councils={groups}
          selectedCouncilName="auth-review"
          onSelectCouncil={() => {}}
        />,
      )
      expect(html).toContain("ob-council-groups")
      // Group order first, member group below it (rail or chip strip).
      const group = html.indexOf("perf-check")
      const member = html.indexOf("reviewer-alice")
      expect(group).toBeGreaterThanOrEqual(0)
      expect(member).toBeGreaterThan(group)
      // The open council is the pressed chip; the other stays switchable.
      expect(html).toContain('aria-pressed="true"')
      expect(html).toContain('aria-pressed="false"')
    }
  })

  test("the desktop pane puts the groups over the member rail too", () => {
    const html = renderToStaticMarkup(
      <CouncilPane
        {...baseProps}
        mobile={false}
        width={420}
        paneRef={() => {}}
        onFullscreen={() => {}}
        onDrag={() => {}}
        councils={groups}
        selectedCouncilName="perf-check"
        onSelectCouncil={() => {}}
      />,
    )
    expect(html).toContain("ob-council-groups")
    expect(html.indexOf("auth-review · 2")).toBeLessThan(
      html.indexOf("reviewer-alice"),
    )
  })

  test("a single council needs no switcher", () => {
    const html = renderToStaticMarkup(
      <CouncilGroupSwitcher
        councils={[{ name: "auth-review", members: 2, running: 0 }]}
        selectedName="auth-review"
        onSelect={() => {}}
      />,
    )
    expect(html).toBe("")
    const overlay = renderToStaticMarkup(
      <CouncilOverlay {...baseProps} mobile={false} />,
    )
    expect(overlay).not.toContain("ob-council-groups")
  })

  test("group switch patch moves ?council= and clears the old member", () => {
    // The viewer syncs the open council from ?council= (Workspace), so a
    // group switch that only changed local state would be reverted by
    // that sync. The patch must carry the new council and drop the
    // previous council's member, leaving other params alone.
    const next = patchSearch(
      "?thread=t1&council=auth-review&member=s1",
      councilSwitchPatch("perf-check"),
    )
    expect(searchParam(next, "council")).toBe("perf-check")
    expect(searchParam(next, "member")).toBe("")
    expect(searchParam(next, "thread")).toBe("t1")
    // Many councils: every group stays a switchable chip, one pressed.
    const many = Array.from({ length: 6 }, (_, i) => ({
      name: `team-${i + 1}`,
      members: i + 1,
      running: 0,
    }))
    const html = renderToStaticMarkup(
      <CouncilGroupSwitcher
        councils={many}
        selectedName="team-1"
        onSelect={() => {}}
      />,
    )
    for (const group of many) expect(html).toContain(group.name)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(5)
  })

  test("stop button shows only with a handler and a running member", () => {
    const stop = async () => {}
    // baseProps has s1 running: both surfaces offer the stop.
    const overlay = renderToStaticMarkup(
      <CouncilOverlay {...baseProps} mobile={false} onStop={stop} />,
    )
    expect(overlay).toContain("Stop council")
    const pane = renderToStaticMarkup(
      <CouncilPane
        {...baseProps}
        mobile={false}
        width={420}
        paneRef={() => {}}
        onFullscreen={() => {}}
        onDrag={() => {}}
        onStop={stop}
      />,
    )
    expect(pane).toContain("Stop council")
    // Nobody running: nothing to stop.
    const idle = renderToStaticMarkup(
      <CouncilOverlay
        {...baseProps}
        mobile={false}
        statusOf={() => ({ type: "idle" })}
        onStop={stop}
      />,
    )
    expect(idle).not.toContain("Stop council")
    // No handler wired (read-only embed): no dead button.
    const unwired = renderToStaticMarkup(
      <CouncilOverlay {...baseProps} mobile={false} />,
    )
    expect(unwired).not.toContain("Stop council")
  })

  test("councilRunningIds collects running members then subagents", () => {
    expect(councilRunningIds(data, baseProps.statusOf)).toEqual(["s1"])
    expect(
      councilRunningIds(data, (id) =>
        id === "s2" || id === "s3" ? { type: "busy" } : { type: "idle" },
      ),
    ).toEqual(["s2", "s3"])
    expect(councilRunningIds(data, () => undefined)).toEqual([])
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

const userMsg = (id: string, text: string, at: number): ChatMessage => ({
  info: { id, role: "user", time: { created: at } },
  parts: [{ type: "text", text }],
})

const assistantMsg = (
  id: string,
  created: number,
  completed: number | undefined,
  parts: ChatPart[],
): ChatMessage => ({
  info: {
    id,
    role: "assistant",
    time: completed ? { created, completed } : { created },
  },
  parts,
})

const toolPart = (name: string, title?: string): ChatPart => ({
  type: "tool",
  tool: name,
  state: { status: "completed", ...(title ? { title } : {}) },
})

describe("CouncilTimeline — main-thread parity", () => {
  const messages = [
    userMsg("u1", "review the auth code", 1_000),
    assistantMsg("a1", 2_000, 5_000, [
      toolPart("read", "src/auth.ts"),
      { type: "text", text: "checking" },
    ]),
    assistantMsg("a2", 5_500, 62_000, [
      toolPart("grep", "token"),
      { type: "text", text: "found it" },
    ]),
  ]

  test("renders the main thread's bubbles with a per-turn work row", () => {
    const html = renderToStaticMarkup(
      <CouncilTimeline messages={messages} startUserCount={0} />,
    )
    // Same bubble DOM as Workspace's MessageBubble.
    expect(html).toContain("ob-msg ob-msg-user")
    expect(html).toContain("ob-bubble ob-bubble-user")
    expect(html).toContain("ob-msg ob-msg-assistant")
    expect(html).toContain("ob-bubble ob-bubble-assistant")
    expect(html).toContain("ob-msg-meta")
    // Burst merging: the two assistant replies are one bubble.
    expect(html.match(/ob-msg-assistant/g)).toHaveLength(1)
    expect(html).toContain("checking")
    expect(html).toContain("found it")
    // Tool work the old transcript dropped: one summary row for the turn.
    expect(html).toContain("ob-work-head")
    expect(html).toContain("2 étapes")
    // The work row lands after its turn's bubble, like the main log.
    expect(html.indexOf("found it")).toBeLessThan(html.indexOf("ob-work"))
  })

  test("a tool-only live turn still shows its running work row", () => {
    const html = renderToStaticMarkup(
      <CouncilTimeline
        messages={[
          userMsg("u1", "scan", 1_000),
          assistantMsg("a1", 2_000, undefined, [toolPart("bash", "ls")]),
        ]}
        startUserCount={0}
        running
      />,
    )
    expect(html).not.toContain("ob-msg-assistant")
    expect(html).toContain("ob-work-head")
    expect(html).toContain("En cours")
    expect(html).toContain("ob-work-dot")
  })

  test("attached images render inside the bubble, not dropped", () => {
    const html = renderToStaticMarkup(
      <CouncilTimeline
        messages={[
          assistantMsg("a1", 2_000, 3_000, [
            {
              type: "file",
              mime: "image/png",
              url: "data:image/png;base64,iVBORw0KGgo=",
            },
          ]),
        ]}
        startUserCount={0}
      />,
    )
    expect(html).toContain("data:image/png;base64")
  })
})
