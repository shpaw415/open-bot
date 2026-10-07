import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "@open-bot/db"
import {
  capturePath,
  holdFile,
  holdSystemLine,
  parseScreenList,
  pickDisplay,
  rfbPortFor,
  screenSessionId,
  screensToStop,
  threadScreenCap,
  vncHost,
  vncSystemLine,
  vncViewPath,
} from "./screens"

describe("thread screens", () => {
  test("session ids are token-safe", () => {
    expect(screenSessionId("ses_abc-1")).toBe("ses_abc-1")
    expect(screenSessionId("  ses_ok  ")).toBe("ses_ok")
    expect(screenSessionId("ses:bad")).toBeNull()
    expect(screenSessionId("../etc")).toBeNull()
    expect(screenSessionId("")).toBeNull()
  })

  test("ports and the system line name one host", () => {
    expect(rfbPortFor(2)).toBe(5902)
    expect(vncHost(5902)).toBe("computer::5902")
    const line = vncSystemLine("ses_abc", 5904)
    expect(line).toContain("computer::5904")
    expect(line).toContain("ob-vnc --session ses_abc")
    expect(line).toContain("ob-vnc paste")
    expect(line).toContain("xclip")
    expect(line).toContain("ob-nav --session ses_abc")
    expect(line).toContain(capturePath(5904))
    expect(line).toContain("$OPEN_BOT_VNC")
    expect(line).toContain("![screen](open-bot://screen)")
    expect(line).toContain("takes control")
    expect(holdSystemLine()).toContain("user holds this screen")
    expect(holdFile("ses_abc")).toBe("/home/agent/.open-bot/vnc/ses_abc.hold")
    expect(vncViewPath("ses_abc")).toBe("desktop/view/websockify?token=ses_abc")
  })

  test("cap stays inside the display range", () => {
    expect(threadScreenCap(3)).toBe(3)
    expect(threadScreenCap(0)).toBe(1)
    expect(threadScreenCap(99)).toBe(8)
  })

  test("list parser skips junk", () => {
    expect(parseScreenList("ses_a 2\n\nbad:id 3\nses_b 9\nses_c 1\n")).toEqual([
      { sessionId: "ses_a", display: 2 },
      { sessionId: "ses_b", display: 9 },
    ])
  })

  test("lru stops the oldest until one slot is free", () => {
    const alive = [
      { sessionId: "c", lastActiveAt: 30 },
      { sessionId: "a", lastActiveAt: 10 },
      { sessionId: "b", lastActiveAt: 20 },
    ]
    expect(screensToStop(alive, 3)).toEqual(["a"])
    expect(screensToStop(alive.slice(0, 2), 3)).toEqual([])
    expect(
      screensToStop(
        [
          { sessionId: "b", lastActiveAt: 1 },
          { sessionId: "a", lastActiveAt: 1 },
        ],
        1,
      ),
    ).toEqual(["a", "b"])
  })

  test("display pick reuses a free preferred number", () => {
    expect(pickDisplay([3], 2)).toBe(2)
    expect(pickDisplay([2], 2)).toBe(3)
    expect(pickDisplay([2, 3, 4, 5, 6, 7, 8, 9], null)).toBeNull()
  })

  test("screen rows round-trip", () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
    )
    db.upsertThreadScreen({
      userId: "u",
      sessionId: "ses_a",
      display: 2,
      rfbPort: 5902,
      lastActiveAt: 1,
    })
    db.upsertThreadScreen({
      userId: "u",
      sessionId: "ses_a",
      display: 4,
      rfbPort: 5904,
      lastActiveAt: 2,
    })
    expect(db.threadScreen("u", "ses_a")).toEqual({
      userId: "u",
      sessionId: "ses_a",
      display: 4,
      rfbPort: 5904,
      lastActiveAt: 2,
    })
    expect(db.threadScreens("u")).toHaveLength(1)
    db.clearThreadScreen("u", "ses_a")
    expect(db.threadScreen("u", "ses_a")).toBeNull()
  })
})
