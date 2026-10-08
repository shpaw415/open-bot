import { expect, test } from "bun:test"
import type { Decision, Snapshot } from "./action-space"
import { type Act, runNav } from "./loop"
import { decisionBody, decisionHeaders } from "./wire"

const page: Snapshot = {
  url: "https://example.test/search",
  title: "Search",
  text: "results",
  canScrollDown: false,
  canScrollUp: false,
  elements: [
    {
      targetId: "9",
      role: "button",
      label: "Go",
      value: "",
      editable: false,
      actionable: true,
    },
  ],
}

function driver(acts: Act[]) {
  return {
    async probe() {
      return page
    },
    async act(action: Act) {
      acts.push(action)
    },
  }
}

function decision(partial: Partial<Decision>): Decision {
  return {
    operation: "DONE",
    confidence: 0.9,
    target: null,
    textValue: null,
    needsUser: 0,
    ...partial,
  }
}

test("a low-confidence click is skipped, then the run recovers", async () => {
  const acts: Act[] = []
  let asked = 0
  const result = await runNav({
    goal: "open the page",
    ask: async () => {
      asked += 1
      if (asked === 1)
        return decision({ operation: "CLICK", target: "1", confidence: 0.2 })
      return decision({ operation: "DONE" })
    },
    driver: driver(acts),
  })
  expect(asked).toBe(2)
  expect(acts).toEqual([])
  expect(result.status).toBe("done")
})

test("three bad decisions hand off to legacy navigation", async () => {
  const acts: Act[] = []
  const result = await runNav({
    goal: "open the page",
    ask: async () => decision({ operation: "SCROLL_DOWN", confidence: 0.2 }),
    driver: driver(acts),
  })
  expect(result.status).toBe("low_confidence")
  expect(result.fallback).toBe("vnc")
  expect(acts).toEqual([])
})

test("a blocked decision scrolls once before asking again", async () => {
  const acts: Act[] = []
  let asked = 0
  const result = await runNav({
    goal: "open the page",
    ask: async () => {
      asked += 1
      if (asked === 1) return decision({ operation: "BLOCKED" })
      return decision({ operation: "DONE" })
    },
    driver: {
      async probe() {
        return { ...page, canScrollDown: true }
      },
      async act(action) {
        acts.push(action)
      },
    },
  })
  expect(asked).toBe(2)
  expect(acts).toEqual([{ kind: "scroll", direction: "down" }])
  expect(result.status).toBe("done")
})

test("a failed decision call retries once before erroring", async () => {
  const acts: Act[] = []
  let asked = 0
  const result = await runNav({
    goal: "open the page",
    ask: async () => {
      asked += 1
      if (asked === 1) throw new Error("laya down")
      return decision({ operation: "DONE" })
    },
    driver: driver(acts),
  })
  expect(asked).toBe(2)
  expect(result.status).toBe("done")
})

test("a blank page with a url opens it before a decision", async () => {
  const opened: string[] = []
  let current: Snapshot = {
    ...page,
    url: "about:blank",
    title: "",
    text: "",
    elements: [],
  }
  const result = await runNav({
    goal: "Open https://www.facebook.com/profile.php?id=1",
    ask: async () => decision({ operation: "DONE" }),
    driver: {
      async probe() {
        return current
      },
      async navigate(url) {
        opened.push(url)
        current = { ...page, url, text: "M2Tech" }
      },
      async act() {},
    },
  })
  expect(opened).toEqual(["https://www.facebook.com/profile.php?id=1"])
  expect(result.status).toBe("done")
  expect(result.url).toBe("https://www.facebook.com/profile.php?id=1")
})

test("a blank page without a url does not click", async () => {
  let asked = false
  const result = await runNav({
    goal: "open the page",
    ask: async () => {
      asked = true
      return decision({ operation: "CLICK", target: "1" })
    },
    driver: {
      async probe() {
        return {
          ...page,
          url: "about:blank",
          title: "",
          text: "",
          elements: [],
        }
      },
      async act() {},
    },
  })
  expect(result.status).toBe("blocked")
  expect(result.detail).toBe("no url")
  expect(asked).toBe(false)
})

test("a false user handoff is retried, then hands off", async () => {
  const acts: Act[] = []
  const result = await runNav({
    goal: "open the page",
    maxSteps: 5,
    ask: async () =>
      decision({
        operation: "CLICK",
        target: "1",
        confidence: 0.9,
        needsUser: 0.9,
      }),
    driver: driver(acts),
  })
  expect(acts).toEqual([])
  expect(result.status).toBe("low_confidence")
  expect(result.detail).toBe("false handoff")
  expect(result.fallback).toBe("vnc")
})

test("a server redirect is reported, not a false handoff", async () => {
  let current: Snapshot = {
    ...page,
    url: "about:blank",
    title: "",
    text: "",
    elements: [],
  }
  const result = await runNav({
    goal: "Open https://buyapi.test/search?q=orange%20pi",
    ask: async () =>
      decision({
        operation: "CLICK",
        target: "1",
        confidence: 0.9,
        needsUser: 0.9,
      }),
    driver: {
      async probe() {
        return current
      },
      async navigate(_url) {
        current = { ...page, url: "https://pishop.test/search", text: "shop" }
      },
      async act() {},
    },
  })
  expect(result.status).toBe("low_confidence")
  expect(result.detail).toBe("redirected to pishop.test")
  expect(result.requested_url).toBe("https://buyapi.test/search?q=orange%20pi")
  expect(result.motive).toBe("redirect")
})

test("a stray handoff retries the goal url once in the same run", async () => {
  const opened: string[] = []
  let asked = 0
  const result = await runNav({
    goal: "Open https://buyapi.test/search",
    maxSteps: 10,
    ask: async () => {
      asked += 1
      return decision({
        operation: "CLICK",
        target: "1",
        confidence: 0.9,
        needsUser: 0.9,
      })
    },
    driver: {
      async probe() {
        return { ...page, url: "https://pishop.test/search" }
      },
      async navigate(url) {
        opened.push(url)
      },
      async act() {},
    },
  })
  expect(opened).toEqual([
    "https://buyapi.test/search",
    "https://buyapi.test/search",
  ])
  expect(result.status).toBe("low_confidence")
  expect(result.requested_url).toBe("https://buyapi.test/search")
  expect(asked).toBe(6)
})

test("a password field stops without asking", async () => {
  let asked = false
  const result = await runNav({
    goal: "open the page",
    ask: async () => {
      asked = true
      return decision({ operation: "CLICK", target: "1" })
    },
    driver: {
      async probe() {
        return {
          ...page,
          url: "https://www.facebook.com/login",
          elements: [
            {
              targetId: "1",
              role: "input",
              label: "Password",
              value: "",
              editable: true,
              actionable: true,
            },
          ],
        }
      },
      async act() {},
    },
  })
  expect(result.status).toBe("needs_user")
  expect(result.fallback).toBeUndefined()
  expect(asked).toBe(false)
})

test("the same site is not opened again", async () => {
  const opened: string[] = []
  const result = await runNav({
    goal: "Open https://example.test/search",
    ask: async () => decision({ operation: "DONE" }),
    driver: {
      async probe() {
        return page
      },
      async navigate(url) {
        opened.push(url)
      },
      async act() {},
    },
  })
  expect(opened).toEqual([])
  expect(result.status).toBe("done")
})

test("a new url on the same site is opened, not refused", async () => {
  const opened: string[] = []
  let current: Snapshot = page
  const result = await runNav({
    goal: "Open https://example.test/search?q=orange+pi",
    ask: async () => decision({ operation: "DONE" }),
    driver: {
      async probe() {
        return current
      },
      async navigate(url) {
        opened.push(url)
        current = { ...page, url }
      },
      async act() {},
    },
  })
  expect(opened).toEqual(["https://example.test/search?q=orange+pi"])
  expect(result.status).toBe("done")
})

test("typing requires a value already in the goal", async () => {
  const field: Snapshot = {
    ...page,
    elements: [
      {
        targetId: "3",
        role: "textbox",
        label: "Query",
        value: "",
        editable: true,
        actionable: true,
      },
    ],
  }
  const acts: Act[] = []
  const missing = await runNav({
    goal: "open the page",
    ask: async () => decision({ operation: "TYPE_TEXT", target: "1" }),
    driver: {
      async probe() {
        return field
      },
      async act(action) {
        acts.push(action)
      },
    },
  })
  expect(missing.status).toBe("need_text")
  expect(missing.fallback).toBe("vnc")
  expect(acts).toEqual([])
  const typed = await runNav({
    goal: 'search for "lasagna"',
    ask: async () =>
      decision({
        operation: "TYPE_TEXT",
        target: "1",
        textValue: "lasagna",
      }),
    driver: {
      async probe() {
        return field
      },
      async act(action) {
        acts.push(action)
      },
    },
  })
  expect(typed.status).not.toBe("need_text")
  expect(acts[0]).toEqual({ kind: "type", targetId: "3", text: "lasagna" })
  const generated: Act[] = []
  const helped = await runNav({
    goal: "post a short hello on the page",
    ask: async () => decision({ operation: "TYPE_TEXT", target: "1" }),
    writeText: async () => "hello",
    driver: {
      async probe() {
        return field
      },
      async act(action) {
        generated.push(action)
      },
    },
  })
  expect(helped.status).not.toBe("need_text")
  expect(generated[0]).toEqual({ kind: "type", targetId: "3", text: "hello" })
})

test("headers keep the gateway token off the provider key", () => {
  expect(
    decisionHeaders({
      endpoint: "https://example.test/v1/systemone",
      apiKey: "provider",
      gatewayToken: "gate",
      model: "",
    }),
  ).toEqual({
    "content-type": "application/json",
    authorization: "Bearer provider",
    "cf-aig-authorization": "Bearer gate",
  })
  expect(
    decisionBody(
      {
        endpoint: "https://example.test",
        apiKey: "",
        gatewayToken: "",
        model: "",
      },
      "{}",
      {},
    ),
  ).toEqual({ state: "{}", questions: {} })
})

test("an error page exits blocked, not a false handoff", async () => {
  let asked = 0
  let current: Snapshot = {
    ...page,
    url: "about:blank",
    title: "",
    text: "",
    elements: [],
  }
  const result = await runNav({
    goal: "Open https://ebay.ca/ and search",
    ask: async () => {
      asked += 1
      return decision({
        operation: "CLICK",
        target: "1",
        confidence: 0.9,
        needsUser: 0.9,
      })
    },
    driver: {
      async probe() {
        return current
      },
      async navigate() {
        current = {
          ...page,
          url: "https://ebay.test/",
          title: "Error Page | eBay",
          text: "",
        }
      },
      async act() {},
    },
  })
  expect(result.status).toBe("blocked")
  expect(result.detail).toBe("error page: Error Page | eBay")
  expect(result.fallback).toBe("vnc")
  expect(result.requested_url).toBe("https://ebay.ca/")
  expect(asked).toBe(0)
})

test("a page-world throw hands off with the real message", async () => {
  let current: Snapshot = {
    ...page,
    url: "about:blank",
    title: "",
    text: "",
    elements: [],
  }
  const result = await runNav({
    goal: "Open https://ebay.test/search?q=pi",
    ask: async () =>
      decision({ operation: "CLICK", target: "1", confidence: 0.9 }),
    driver: {
      async probe() {
        return current
      },
      async navigate(url) {
        current = { ...page, url, title: "Search" }
      },
      async act() {
        throw new Error("page error: SecurityError: blocked by site script")
      },
    },
  })
  expect(result.status).toBe("blocked")
  expect(result.detail).toBe(
    "page error: SecurityError: blocked by site script",
  )
  expect(result.requested_url).toBe("https://ebay.test/search?q=pi")
  expect(result.fallback).toBe("vnc")
})

test("a throw before the page opens keeps the requested url", async () => {
  const result = await runNav({
    goal: "Open https://ebay.test/search?q=pi",
    ask: async () => decision({ operation: "DONE" }),
    driver: {
      async probe() {
        throw new Error("page error: context destroyed")
      },
      async navigate() {},
      async act() {},
    },
  })
  expect(result.status).toBe("error")
  expect(result.detail).toBe("page error: context destroyed")
  expect(result.requested_url).toBe("https://ebay.test/search?q=pi")
})
