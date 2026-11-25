import { describe, expect, test } from "bun:test"
import {
  BACK_SETTLE_MS,
  BackNavStack,
  backOr,
  documentBack,
  installShellHost,
  layersOf,
  paneSyncAction,
  patchSearch,
  planPopSync,
  planReconcile,
  searchParam,
  splitUrl,
  stepBack,
} from "./back-nav"
import { dirtyForms } from "./dirty-form"

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

/**
 * Run `fn` with browser globals swapped in, restoring whatever stood there
 * (other test files may have registered a DOM on this same process, whose
 * `window`/`history` are read-only accessors — so define, never assign).
 */
function withGlobals(values: Record<string, unknown>, fn: () => void) {
  const g = globalThis as Record<string, unknown>
  const before = Object.keys(values).map((key) => ({
    key,
    descriptor: Object.getOwnPropertyDescriptor(g, key),
  }))
  const define = (key: string, value: unknown) =>
    Object.defineProperty(g, key, {
      value,
      configurable: true,
      writable: true,
      enumerable: true,
    })
  for (const [key, value] of Object.entries(values)) define(key, value)
  try {
    fn()
  } finally {
    for (const { key, descriptor } of before) {
      if (descriptor) Object.defineProperty(g, key, descriptor)
      else delete g[key]
    }
  }
}

/**
 * Joint session history the way a browser keeps it: the page's entries and
 * a child frame's (the preview iframe) share one stack. A plain
 * history.back() steps one entry of that stack, and the page only hears a
 * popstate when its own part of the entry changed — stepping between the
 * frame's entries, or from those onto the page entry they sit on, is
 * silent. The Navigation API only ever sees the page's own entries.
 */
function jointHistory() {
  type Entry = {
    page: boolean
    main: number
    url: string
    state: Record<string, unknown>
  }
  let main = 0
  let pos = 0
  const entries: Entry[] = [
    { page: true, main: 0, url: "/chat?thread=t", state: { obPos: 0 } },
  ]
  let index = 0
  const listeners = new Set<() => void>()
  const timers: (() => void)[] = []
  const delays: number[] = []
  const replaced: string[] = []
  const navBacks: string[] = []
  const pop = () => {
    history.pops += 1
    for (const fn of [...listeners]) fn()
  }
  const step = (delta: number) => {
    const next = index + delta
    if (next < 0 || next >= entries.length) return
    const from = entries[index]
    index = next
    if (entries[index].main !== from.main) pop()
  }
  const replace = (url: string) => {
    replaced.push(url)
    entries[index] = { ...entries[index], url }
  }
  const history = {
    get index() {
      return index
    },
    get url() {
      return entries[index].url
    },
    get state() {
      return entries[index].state
    },
    pops: 0,
    push(url: string) {
      entries.splice(index + 1)
      pos += 1
      main += 1
      entries.push({ page: true, main, url, state: { obPos: pos } })
      index = entries.length - 1
    },
    /** The child frame navigated: a joint entry carrying the page's part. */
    frameNavigates() {
      entries.splice(index + 1)
      entries.push({ ...entries[index], page: false })
      index = entries.length - 1
    },
    backs: 0,
    back: () => {
      history.backs += 1
      step(-1)
    },
    flush: () => {
      while (timers.length) timers.shift()?.()
    },
  }
  const navigation = {
    get canGoBack() {
      return entries[index].main > 0
    },
    /** Chrome 154+ hands back `{committed, finished}`; older engines a promise. */
    result: "promise" as "promise" | "committed",
    back: () => {
      navBacks.push(entries[index].url)
      const previous = entries.filter(
        (entry) => entry.page && entry.main === entries[index].main - 1,
      )
      index = entries.lastIndexOf(previous[0])
      pop()
      return navigation.result === "promise"
        ? Promise.resolve()
        : { committed: Promise.resolve(), finished: Promise.resolve() }
    },
  }
  const host = {
    getState: () => history.state,
    getUrl: () => history.url,
    push: (_patch: { obLayers: string[] }, url: string) => history.push(url),
    replace: (_patch: { obLayers: string[] }, url: string) => replace(url),
    back: () => history.back(),
    go: (url: string) => history.push(url),
    replaceUrl: (url: string) => replace(url),
    canGoBackInApp: () => Number(history.state.obPos) > 0,
  }
  const window = {
    addEventListener: (_type: string, fn: () => void) => {
      listeners.add(fn)
    },
    removeEventListener: (_type: string, fn: () => void) => {
      listeners.delete(fn)
    },
    setTimeout: (fn: () => void, ms: number) => {
      delays.push(ms)
      timers.push(fn)
      return timers.length
    },
  }
  return {
    history,
    host,
    window,
    navigation,
    replaced,
    navBacks,
    listeners,
    delays,
  }
}

describe("documentBack / stepBack — Back for this document", () => {
  test("no Navigation API: declines, the caller keeps history.back()", () => {
    withGlobals({ navigation: undefined }, () => {
      expect(documentBack()).toBe(false)
    })
  })

  test("nothing behind this document: declines instead of calling", () => {
    const calls: string[] = []
    withGlobals(
      {
        navigation: {
          canGoBack: false,
          back: () => {
            calls.push("back")
            return Promise.resolve()
          },
        },
      },
      () => {
        expect(documentBack()).toBe(false)
      },
    )
    expect(calls).toEqual([])
  })

  test("one back() per call, whatever the engine hands back", async () => {
    // Firefox and Safari resolve a promise; Chrome 154+ returns
    // `{ committed, finished }` promises; a cancelled traversal rejects.
    // Each call must issue exactly one traversal and count as issued.
    const shapes: (() => unknown)[] = [
      () => Promise.resolve(),
      () => Promise.reject(new Error("aborted")),
      () => ({
        committed: Promise.reject(new Error("aborted")),
        finished: Promise.resolve(),
      }),
      () => undefined,
    ]
    for (const back of shapes) {
      let calls = 0
      withGlobals(
        {
          navigation: {
            canGoBack: true,
            back: () => {
              calls += 1
              return back()
            },
          },
        },
        () => {
          expect(documentBack()).toBe(true)
        },
      )
      expect(calls).toBe(1)
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  test("an engine refusing the traversal in the call issues nothing", () => {
    withGlobals(
      {
        navigation: {
          canGoBack: true,
          back: () => {
            throw new Error("InvalidStateError")
          },
        },
      },
      () => {
        expect(documentBack()).toBe(false)
      },
    )
  })

  test("stepBack prefers the Navigation API, else history.back()", () => {
    const calls: string[] = []
    const navigation = {
      canGoBack: true,
      back: () => {
        calls.push("navigation")
        return Promise.resolve()
      },
    }
    const history = { back: () => calls.push("history") }
    withGlobals({ navigation, history }, () => stepBack())
    withGlobals({ navigation: undefined, history }, () => stepBack())
    expect(calls).toEqual(["navigation", "history"])
  })
})

describe("backOr — leaving a URL-backed screen", () => {
  test("the preview iframe navigated: Back reaches the page's entry, not the frame's", () => {
    const h = jointHistory()
    withGlobals(
      { window: h.window, history: h.history, navigation: h.navigation },
      () => {
        const uninstall = installShellHost(h.host)
        try {
          h.history.push("/chat?thread=t&preview=1")
          h.history.frameNavigates()
          h.history.frameNavigates()
          backOr("/chat?thread=t")
          expect(h.navBacks).toEqual(["/chat?thread=t&preview=1"])
          expect(h.history.url).toBe("/chat?thread=t")
          expect(h.history.pops).toBe(1)
          expect(h.replaced).toEqual([])
        } finally {
          uninstall()
        }
      },
    )
  })

  test("a {committed, finished} result is still exactly one traversal", () => {
    const h = jointHistory()
    h.navigation.result = "committed"
    withGlobals(
      { window: h.window, history: h.history, navigation: h.navigation },
      () => {
        const uninstall = installShellHost(h.host)
        try {
          h.history.push("/chat?thread=t&preview=1")
          h.history.frameNavigates()
          backOr("/chat?thread=t")
          // Taken as "not issued", this traversal used to be repeated through
          // host.back() and history.back(): three steps instead of one.
          expect(h.navBacks).toHaveLength(1)
          expect(h.history.backs).toBe(0)
          expect(h.history.url).toBe("/chat?thread=t")
          expect(h.replaced).toEqual([])
        } finally {
          uninstall()
        }
      },
    )
  })

  test("no Navigation API: a Back the frame absorbed is settled in place", () => {
    const h = jointHistory()
    withGlobals(
      { window: h.window, history: h.history, navigation: undefined },
      () => {
        const uninstall = installShellHost(h.host)
        try {
          h.history.push("/chat?thread=t&preview=1")
          h.history.frameNavigates()
          h.history.frameNavigates()
          backOr("/chat?thread=t")
          // The plain step went into the frame's entries: the page heard
          // nothing and its URL still names the preview.
          expect(h.history.pops).toBe(0)
          expect(h.history.url).toBe("/chat?thread=t&preview=1")
          expect(h.replaced).toEqual([])
          // The rewrite waits one settle window: a slow traversal that
          // lands meanwhile owns the URL instead.
          expect(h.delays).toEqual([BACK_SETTLE_MS])
          h.history.flush()
          expect(h.replaced).toEqual(["/chat?thread=t"])
        } finally {
          uninstall()
        }
      },
    )
  })

  test("no Navigation API, plain step: the popstate ends the settle watch", () => {
    const h = jointHistory()
    withGlobals(
      { window: h.window, history: h.history, navigation: undefined },
      () => {
        const uninstall = installShellHost(h.host)
        try {
          h.history.push("/chat?thread=t&preview=1")
          backOr("/chat?thread=t")
          expect(h.history.pops).toBe(1)
          expect(h.history.url).toBe("/chat?thread=t")
          h.history.flush()
          expect(h.replaced).toEqual([])
          expect(h.listeners.size).toBe(0)
        } finally {
          uninstall()
        }
      },
    )
  })

  test("an entry that moved on its own, or a dirty form, is not rewritten", () => {
    const moved = jointHistory()
    withGlobals(
      { window: moved.window, history: moved.history, navigation: undefined },
      () => {
        const uninstall = installShellHost(moved.host)
        try {
          moved.history.push("/chat?thread=t&preview=1")
          moved.history.frameNavigates()
          backOr("/chat?thread=t")
          moved.history.push("/chat?thread=t2&preview=1")
          moved.history.flush()
          expect(moved.replaced).toEqual([])
        } finally {
          uninstall()
        }
      },
    )
    const dirty = jointHistory()
    const key = Symbol("editor")
    dirtyForms.mark(key)
    try {
      withGlobals(
        { window: dirty.window, history: dirty.history, navigation: undefined },
        () => {
          const uninstall = installShellHost(dirty.host)
          try {
            dirty.history.push("/chat?thread=t&job=new")
            dirty.history.frameNavigates()
            backOr("/chat?thread=t")
            dirty.history.flush()
            expect(dirty.replaced).toEqual([])
          } finally {
            uninstall()
          }
        },
      )
    } finally {
      dirtyForms.clear(key)
    }
  })

  test("nothing behind (fresh deep link): pushes the parent URL, as before", () => {
    const h = jointHistory()
    withGlobals(
      { window: h.window, history: h.history, navigation: h.navigation },
      () => {
        // Boot straight on the preview entry: no page entry behind it.
        h.history.push("/chat?thread=t&preview=1")
        const uninstall = installShellHost({
          ...h.host,
          canGoBackInApp: () => false,
        })
        try {
          backOr("/chat?thread=t")
          expect(h.navBacks).toEqual([])
          expect(h.replaced).toEqual([])
          expect(h.history.url).toBe("/chat?thread=t")
          expect(h.history.pops).toBe(0)
        } finally {
          uninstall()
        }
      },
    )
  })
})

describe("paneSyncAction — URL-backed panes", () => {
  test("the URL opens a closed pane and closes one it no longer names", () => {
    expect(paneSyncAction(true, "closed", false)).toBe("open")
    expect(paneSyncAction(false, "pane", false)).toBe("close")
    expect(paneSyncAction(false, "overlay", true)).toBe("close")
    expect(paneSyncAction(true, "pane", false)).toBe("none")
    expect(paneSyncAction(true, "overlay", true)).toBe("none")
    expect(paneSyncAction(false, "closed", false)).toBe("none")
  })
  test("a pane whose UI close is still travelling is not re-opened", () => {
    expect(paneSyncAction(true, "closed", true)).toBe("none")
  })
})
