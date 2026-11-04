import { describe, expect, test } from "bun:test"
import {
  BackNavStack,
  layersOf,
  patchSearch,
  planPopSync,
  planReconcile,
  searchParam,
  splitUrl,
} from "./back-nav"

/**
 * Fake browser history for the back-layer stack, mirroring nav-guard.test:
 * entries + index, traversals fire the pop callback synchronously.
 */
function fakeHost(initialUrl = "/chat") {
  const entries: { url: string; state: Record<string, unknown> }[] = [
    { url: initialUrl, state: {} },
  ]
  let index = 0
  const host = {
    entries,
    get index() {
      return index
    },
    onPop: undefined as (() => void) | undefined,
    getState: () => entries[index].state,
    getUrl: () => entries[index].url,
    push: (state: Record<string, unknown>, url: string) => {
      entries.splice(index + 1)
      entries.push({ url, state })
      index += 1
    },
    replace: (state: Record<string, unknown>, url: string) => {
      entries[index] = { url, state }
    },
    back: () => host.traverse(-1),
    forward: () => host.traverse(1),
    traverse: (delta: number) => {
      const next = index + delta
      if (next < 0 || next >= entries.length) return
      index = next
      host.onPop?.()
    },
  }
  return host
}

function setup(initialUrl?: string) {
  const host = fakeHost(initialUrl)
  const stack = new BackNavStack(host, { defer: (fn) => fn() })
  const closed: string[] = []
  const reopened: string[] = []
  const pops: { closedCount: number; url: string }[] = []
  host.onPop = () => {
    const result = stack.syncFromPop()
    pops.push({ closedCount: result.closedCount, url: host.getUrl() })
  }
  const layer = (
    token: string,
    opts?: { reopen?: boolean; suspend?: () => boolean },
  ) => {
    stack.register(token, {
      close: () => {
        closed.push(token)
        stack.setOpen(token, false)
      },
      reopen: opts?.reopen
        ? () => {
            reopened.push(token)
            stack.setOpen(token, true)
          }
        : undefined,
      suspended: opts?.suspend,
    })
    return {
      open: () => stack.setOpen(token, true),
      closeFromUi: () => {
        closed.push(token)
        stack.setOpen(token, false)
      },
    }
  }
  return { host, stack, closed, reopened, pops, layer }
}

describe("layersOf / splitUrl / search helpers", () => {
  test("reads only a string array from state", () => {
    expect(layersOf(null)).toEqual([])
    expect(layersOf({})).toEqual([])
    expect(layersOf({ obLayers: "x" })).toEqual([])
    expect(layersOf({ obLayers: ["a", 1, "b"] })).toEqual(["a", "b"])
    expect(layersOf({ obLayers: ["a", "a", "b"] })).toEqual(["a", "b"])
  })

  test("splitUrl separates pathname and search", () => {
    expect(splitUrl("/chat")).toEqual({ pathname: "/chat", search: "" })
    expect(splitUrl("/chat?thread=1")).toEqual({
      pathname: "/chat",
      search: "?thread=1",
    })
    expect(splitUrl("/media?album=a&item=b#x")).toEqual({
      pathname: "/media",
      search: "?album=a&item=b",
    })
  })

  test("patchSearch sets, clears and preserves params", () => {
    expect(patchSearch("", { thread: "t1" })).toBe("?thread=t1")
    expect(patchSearch("?thread=t1", { thread: null })).toBe("")
    expect(patchSearch("?album=a", { item: "i 1" })).toBe("?album=a&item=i+1")
    expect(patchSearch("?album=a&item=b", { item: null })).toBe("?album=a")
    expect(patchSearch("?job=1", { job: undefined })).toBe("?job=1")
    expect(searchParam("?album=a&item=b", "item")).toBe("b")
    expect(searchParam("", "item")).toBe("")
  })
})

describe("planReconcile", () => {
  test("push when exactly one layer opened on top", () => {
    expect(planReconcile(["a"], [])).toBe("push")
    expect(planReconcile(["a", "b"], ["a"])).toBe("push")
  })
  test("back when exactly the top layer closed", () => {
    expect(planReconcile([], ["a"])).toBe("back")
    expect(planReconcile(["a"], ["a", "b"])).toBe("back")
  })
  test("replace for swaps and multi-layer diffs, none when equal", () => {
    expect(planReconcile(["b"], ["a"])).toBe("replace")
    expect(planReconcile([], ["a", "b"])).toBe("replace")
    expect(planReconcile(["a", "b"], [])).toBe("replace")
    expect(planReconcile(["a"], ["a"])).toBe("none")
    expect(planReconcile([], [])).toBe("none")
  })
})

describe("planPopSync", () => {
  test("closes extras top-first, reopens reopenable, strips the rest", () => {
    const plan = planPopSync({
      open: ["a", "b"],
      entry: ["a", "c", "d"],
      reopenable: new Set(["c"]),
      suspended: new Set<string>(),
    })
    expect(plan.close).toEqual(["b"])
    expect(plan.reopen).toEqual(["c"])
    expect(plan.strip).toEqual(["d"])
    expect(plan.blocked).toEqual([])
  })
  test("suspended layers are blocked, never closed", () => {
    const plan = planPopSync({
      open: ["a"],
      entry: [],
      reopenable: new Set<string>(),
      suspended: new Set(["a"]),
    })
    expect(plan.close).toEqual([])
    expect(plan.blocked).toEqual(["a"])
  })
})

describe("BackNavStack — back dismisses overlays like an app", () => {
  test("opening a layer pushes one entry on the same URL; Back closes it without leaving the page", () => {
    const { host, stack, closed, pops, layer } = setup()
    const lightbox = layer("lightbox")
    lightbox.open()
    expect(host.entries.length).toBe(2)
    expect(host.getUrl()).toBe("/chat")
    expect(layersOf(host.getState())).toEqual(["lightbox"])
    host.back()
    expect(closed).toEqual(["lightbox"])
    expect(host.getUrl()).toBe("/chat")
    expect(pops.at(-1)?.closedCount).toBe(1)
    expect(stack.openTokens()).toEqual([])
  })

  test("stacked layers close one Back at a time, top first", () => {
    const { host, closed, layer } = setup()
    const drawer = layer("drawer")
    const dialog = layer("dialog")
    drawer.open()
    dialog.open()
    expect(layersOf(host.getState())).toEqual(["drawer", "dialog"])
    host.back()
    expect(closed).toEqual(["dialog"])
    host.back()
    expect(closed).toEqual(["dialog", "drawer"])
  })

  test("closing from the UI consumes its history entry (one Back, no page jump)", () => {
    const { host, stack, layer } = setup()
    // A real previous page sits under the current one.
    host.push({}, "/media")
    stack.syncEntry()
    const viewer = layer("viewer")
    viewer.open()
    expect(host.index).toBe(2)
    viewer.closeFromUi()
    // The close went through history.back(): we land on /media, not /chat.
    expect(host.getUrl()).toBe("/media")
    expect(host.index).toBe(1)
    expect(stack.openTokens()).toEqual([])
  })

  test("chained menu swap replaces the token instead of stacking entries", () => {
    const { host, closed, layer } = setup()
    const menu = layer("menu")
    const submenu = layer("submenu")
    menu.open()
    const entriesAfterOpen = host.entries.length
    menu.closeFromUi()
    submenu.open()
    // One entry carries the submenu; Back closes it and stays on the page.
    expect(layersOf(host.getState())).toContain("submenu")
    expect(layersOf(host.getState())).not.toContain("menu")
    expect(host.entries.length).toBeLessThanOrEqual(entriesAfterOpen + 1)
    host.back()
    expect(closed).toContain("submenu")
    expect(host.getUrl()).toBe("/chat")
  })

  test("Forward reopens a reopenable layer but not a transient one", () => {
    const { host, reopened, layer } = setup()
    const lightbox = layer("lightbox", { reopen: true })
    const confirm = layer("confirm")
    lightbox.open()
    host.back()
    host.forward()
    expect(reopened).toEqual(["lightbox"])
    host.back()
    confirm.open()
    host.back()
    host.forward()
    expect(reopened).toEqual(["lightbox"])
    // The stale transient token was stripped from the landed entry.
    expect(layersOf(host.getState())).toEqual([])
  })

  test("a suspended (busy) layer ignores Back and re-arms its entry", () => {
    const { host, stack, closed, layer } = setup()
    let busy = true
    const dialog = layer("dialog", { suspend: () => busy })
    dialog.open()
    host.back()
    expect(closed).toEqual([])
    expect(stack.openTokens()).toEqual(["dialog"])
    expect(layersOf(host.getState())).toEqual(["dialog"])
    busy = false
    host.back()
    expect(closed).toEqual(["dialog"])
  })

  test("multi-entry jump closes every layer above the landing entry", () => {
    const { host, closed, pops, layer } = setup()
    const a = layer("a")
    const b = layer("b")
    a.open()
    b.open()
    host.traverse(-2)
    expect(closed).toEqual(["b", "a"])
    expect(pops.at(-1)?.closedCount).toBe(2)
  })

  test("closeAllSilently clears layers without history traversal (page navigation)", () => {
    const { host, stack, closed, layer } = setup()
    const dialog = layer("dialog")
    dialog.open()
    const at = host.index
    stack.closeAllSilently()
    expect(closed).toEqual(["dialog"])
    expect(host.index).toBe(at)
    expect(layersOf(host.getState())).toEqual([])
    expect(stack.openTokens()).toEqual([])
  })

  test("unregistering an open layer strips it without closing others", () => {
    const { host, stack, closed, layer } = setup()
    const a = layer("a")
    const b = layer("b")
    a.open()
    b.open()
    stack.unregister("a")
    expect(closed).toEqual([])
    expect(stack.openTokens()).toEqual(["b"])
    host.back()
    expect(closed).toEqual(["b"])
  })

  test("setOpen is idempotent — double open pushes once", () => {
    const { host, layer } = setup()
    const dialog = layer("dialog")
    dialog.open()
    dialog.open()
    expect(host.entries.length).toBe(2)
    expect(layersOf(host.getState())).toEqual(["dialog"])
  })
})
