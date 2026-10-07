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

test("a low-confidence click is not performed", async () => {
  const acts: Act[] = []
  const result = await runNav({
    goal: "open the page",
    ask: async () =>
      decision({ operation: "CLICK", target: "1", confidence: 0.2 }),
    driver: driver(acts),
  })
  expect(result.status).toBe("low_confidence")
  expect(acts).toEqual([])
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

test("a false user handoff falls back to legacy navigation", async () => {
  const acts: Act[] = []
  const result = await runNav({
    goal: "open the page",
    ask: async () =>
      decision({ operation: "CLICK", target: "1", needsUser: 0.9 }),
    driver: driver(acts),
  })
  expect(result.status).toBe("low_confidence")
  expect(result.fallback).toBe("vnc")
  expect(acts).toEqual([])
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
