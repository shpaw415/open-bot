import { beforeEach, describe, expect, test } from "bun:test"
import {
  clearNotices,
  markAllNoticesRead,
  markNoticeRead,
  markNoticesForSession,
  NOTICE_CAP,
  noticeFromPluginEvent,
  noticeFromSecurityEvent,
  pushNotice,
  readNotices,
  subscribeNotices,
  unreadNoticeCount,
} from "./notices"

function reset() {
  clearNotices()
}

beforeEach(reset)

describe("notices — store", () => {
  test("push prepends, unread count tracks new entries", () => {
    pushNotice({ id: "a", kind: "reply", title: "A", body: "a" }, 1000)
    pushNotice({ id: "b", kind: "plugin", title: "B", body: "b" }, 2000)
    const items = readNotices()
    expect(items.map((item) => item.id)).toEqual(["b", "a"])
    expect(unreadNoticeCount()).toBe(2)
    expect(items[0].read).toBe(false)
  })

  test("a repeat dedupeKey inside the window refreshes instead of stacking", () => {
    pushNotice(
      {
        id: "s1",
        kind: "security",
        title: "first",
        body: "x",
        dedupeKey: "security:7",
      },
      1000,
    )
    pushNotice(
      {
        id: "s2",
        kind: "security",
        title: "second",
        body: "y",
        dedupeKey: "security:7",
      },
      1000 + 60_000,
    )
    const items = readNotices()
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe("second")
    expect(items[0].at).toBe(1000 + 60_000)
    // Still unread: the count keeps meaning after a bump.
    expect(unreadNoticeCount()).toBe(1)
  })

  test("the same dedupeKey outside the window stacks a new entry", () => {
    const old = pushNotice(
      {
        id: "s1",
        kind: "security",
        title: "old",
        body: "x",
        dedupeKey: "security:7",
      },
      1000,
    )
    markNoticeRead(old.id)
    pushNotice(
      {
        id: "s2",
        kind: "security",
        title: "new",
        body: "y",
        dedupeKey: "security:7",
      },
      1000 + 11 * 60_000,
    )
    expect(readNotices()).toHaveLength(2)
    expect(unreadNoticeCount()).toBe(1)
  })

  test("cap drops the oldest read entries first, unread survive longer", () => {
    for (let index = 0; index < NOTICE_CAP + 5; index += 1) {
      const notice = pushNotice(
        { id: `n${index}`, kind: "reply", title: `N${index}`, body: "" },
        index + 1,
      )
      // Read every third entry early so the cap has read history to drop.
      if (index % 3 === 0) markNoticeRead(notice.id)
    }
    const items = readNotices()
    expect(items.length).toBeLessThanOrEqual(NOTICE_CAP)
    // Newest entry always survives.
    expect(items[0].id).toBe(`n${NOTICE_CAP + 4}`)
    // No entry was dropped that is still unread while older reads exist.
    const reads = items.filter((item) => item.read).length
    expect(reads).toBeGreaterThan(0)
  })

  test("markAllNoticesRead clears the count and is idempotent", () => {
    pushNotice({ id: "a", kind: "reply", title: "A", body: "" }, 1)
    pushNotice({ id: "b", kind: "plugin", title: "B", body: "" }, 2)
    markAllNoticesRead()
    expect(unreadNoticeCount()).toBe(0)
    markAllNoticesRead()
    expect(unreadNoticeCount()).toBe(0)
  })

  test("opening a thread by any path clears that thread's reply notices", () => {
    pushNotice(
      { id: "r1", kind: "reply", title: "T", body: "", sessionId: "sess-1" },
      1,
    )
    pushNotice(
      { id: "r2", kind: "reply", title: "T", body: "", sessionId: "sess-2" },
      2,
    )
    markNoticesForSession("sess-1")
    const items = readNotices()
    expect(items.find((item) => item.id === "r1")?.read).toBe(true)
    expect(items.find((item) => item.id === "r2")?.read).toBe(false)
    expect(unreadNoticeCount()).toBe(1)
  })

  test("clearNotices wipes everything and notifies subscribers", () => {
    let events = 0
    const unsubscribe = subscribeNotices(() => {
      events += 1
    })
    pushNotice({ id: "a", kind: "reply", title: "A", body: "" }, 1)
    expect(events).toBe(1)
    clearNotices()
    expect(readNotices()).toHaveLength(0)
    expect(events).toBe(2)
    unsubscribe()
  })
})

describe("notices — event mapping", () => {
  test("security events map to the Watchdog tab, deduped by finding", () => {
    const notice = noticeFromSecurityEvent(
      {
        findingId: 42,
        severity: "high",
        title: "ssh key write",
        action: "stopped",
      },
      "id-1",
    )
    expect(notice.kind).toBe("security")
    expect(notice.title).toBe("Watchdog (high) — turn stopped")
    expect(notice.body).toBe("ssh key write")
    expect(notice.href).toBe("/config/security")
    expect(notice.sessionId).toBeUndefined()
    expect(notice.dedupeKey).toBe("security:42")
  })

  test("security events with no title still produce a usable notice", () => {
    const notice = noticeFromSecurityEvent(undefined, "id-2")
    expect(notice.title).toBe("Watchdog (finding)")
    expect(notice.body).toBe("suspicious activity detected")
  })

  test("plugin events carry no fake conversation destination", () => {
    const notice = noticeFromPluginEvent(
      { pluginId: "stock", name: "Stock", title: "Alert", body: "AAPL moved" },
      "id-3",
    )
    expect(notice.kind).toBe("plugin")
    expect(notice.title).toBe("Stock: Alert")
    expect(notice.sessionId).toBeUndefined()
    expect(notice.href).toBeUndefined()
    expect(notice.dedupeKey).toContain("stock")
  })

  test("a security notice lands in the store pointing at the real tab", () => {
    const notice = pushNotice(noticeFromSecurityEvent({ findingId: 9 }, "id-4"))
    expect(readNotices()).toHaveLength(1)
    expect(readNotices()[0].href).toBe("/config/security")
    expect(notice.read).toBe(false)
  })
})
