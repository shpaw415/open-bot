import { describe, expect, test } from "bun:test"
import {
  type InstalledResponse,
  initialPluginsState,
  parseInstalledBody,
  pluginsReducer,
} from "./plugin-ui"

function body(overrides: Partial<InstalledResponse> = {}): InstalledResponse {
  return {
    plugins: [
      {
        id: "row-1",
        pluginId: "stock",
        version: "1.0.0",
        name: "Stock",
        description: "",
        author: "",
        repo: "",
        enabled: true,
        permissions: [],
        manifest: {},
        readme: null,
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    policy: "manual",
    configured: true,
    ...overrides,
  }
}

describe("parseInstalledBody", () => {
  test("normalizes missing fields", () => {
    const parsed = parseInstalledBody({
      plugins: undefined as never,
      policy: "weird" as never,
      configured: false,
    })
    expect(parsed.plugins).toEqual([])
    expect(parsed.policy).toBe("manual")
    expect(parsed.autoUpdate).toBe("off")
    expect(parsed.publicOrigin).toBe("")
  })
})

describe("pluginsReducer — the auth-gated load lifecycle", () => {
  test("starts unloaded and signed out", () => {
    expect(initialPluginsState.status).toBe("initial")
    expect(initialPluginsState.plugins).toEqual([])
  })

  test("a signed-in identity moves to loading with clean data", () => {
    const next = pluginsReducer(initialPluginsState, {
      type: "identity",
      identity: "user-a",
    })
    expect(next.status).toBe("loading")
    expect(next.identityKey).toBe("user-a")
    expect(next.plugins).toEqual([])
  })

  test("staying on the same identity is a no-op", () => {
    const loading = pluginsReducer(initialPluginsState, {
      type: "identity",
      identity: "user-a",
    })
    expect(
      pluginsReducer(loading, { type: "identity", identity: "user-a" }),
    ).toBe(loading)
  })

  test("logout clears everything, including the previous user's list", () => {
    const loading = pluginsReducer(initialPluginsState, {
      type: "identity",
      identity: "user-a",
    })
    const ready = pluginsReducer(loading, { type: "success", body: body() })
    const out = pluginsReducer(ready, { type: "identity", identity: null })
    expect(out).toEqual(initialPluginsState)
    expect(out.plugins).toEqual([])
  })

  test("switching users drops the previous user's data before loading", () => {
    const loading = pluginsReducer(initialPluginsState, {
      type: "identity",
      identity: "user-a",
    })
    const ready = pluginsReducer(loading, { type: "success", body: body() })
    const next = pluginsReducer(ready, {
      type: "identity",
      identity: "user-b",
    })
    expect(next.status).toBe("loading")
    expect(next.plugins).toEqual([])
    expect(next.identityKey).toBe("user-b")
  })

  test("success stores the list and lands on ready", () => {
    const loading = pluginsReducer(initialPluginsState, {
      type: "identity",
      identity: "user-a",
    })
    const ready = pluginsReducer(loading, {
      type: "success",
      body: body({
        policy: "auto",
        autoUpdate: "stable",
        publicOrigin: "https://x",
      }),
    })
    expect(ready.status).toBe("ready")
    expect(ready.plugins).toHaveLength(1)
    expect(ready.policy).toBe("auto")
    expect(ready.autoUpdate).toBe("stable")
    expect(ready.publicOrigin).toBe("https://x")
    expect(ready.error).toBe("")
  })

  test("an empty list is a real empty, not an error", () => {
    const loading = pluginsReducer(initialPluginsState, {
      type: "identity",
      identity: "user-a",
    })
    const ready = pluginsReducer(loading, {
      type: "success",
      body: body({ plugins: [] }),
    })
    expect(ready.status).toBe("ready")
    expect(ready.plugins).toEqual([])
  })

  test("first-load failure is an error with no data — never fake-empty", () => {
    const loading = pluginsReducer(initialPluginsState, {
      type: "identity",
      identity: "user-a",
    })
    const failed = pluginsReducer(loading, {
      type: "failure",
      error: "network down",
    })
    expect(failed.status).toBe("error")
    expect(failed.error).toBe("network down")
  })

  test("refresh failure keeps the last good list", () => {
    const loading = pluginsReducer(initialPluginsState, {
      type: "identity",
      identity: "user-a",
    })
    const ready = pluginsReducer(loading, { type: "success", body: body() })
    const failed = pluginsReducer(ready, {
      type: "failure",
      error: "boom",
    })
    expect(failed.status).toBe("error")
    expect(failed.plugins).toHaveLength(1)
  })

  test("refreshing marks background work on top of ready data", () => {
    const loading = pluginsReducer(initialPluginsState, {
      type: "identity",
      identity: "user-a",
    })
    const ready = pluginsReducer(loading, { type: "success", body: body() })
    const fetching = pluginsReducer(ready, { type: "fetch" })
    expect(fetching.refreshing).toBe(true)
    expect(fetching.status).toBe("ready")
    expect(fetching.plugins).toHaveLength(1)
    const done = pluginsReducer(fetching, {
      type: "success",
      body: body({ plugins: [] }),
    })
    expect(done.refreshing).toBe(false)
    expect(done.plugins).toEqual([])
  })

  test("fetch from a non-ready state goes back to loading", () => {
    const loading = pluginsReducer(initialPluginsState, {
      type: "identity",
      identity: "user-a",
    })
    const failed = pluginsReducer(loading, { type: "failure", error: "x" })
    const retrying = pluginsReducer(failed, { type: "fetch" })
    expect(retrying.status).toBe("loading")
    expect(retrying.error).toBe("")
  })
})

describe("pluginsReducer — stale-response guards", () => {
  // True hook lifecycle: identity → fetch (seq 1) → answer.
  const fetchingA = pluginsReducer(
    pluginsReducer(initialPluginsState, {
      type: "identity",
      identity: "user-a",
    }),
    { type: "fetch" },
  )
  const readyA = pluginsReducer(fetchingA, {
    type: "success",
    body: body(),
    identity: "user-a",
    seq: 1,
  })

  test("a success for another account never populates this one", () => {
    // Account A's request lands after the user switched to B.
    const loadingB = pluginsReducer(readyA, {
      type: "identity",
      identity: "user-b",
    })
    const stale = pluginsReducer(loadingB, {
      type: "success",
      body: body(),
      identity: "user-a",
      seq: 1,
    })
    expect(stale).toBe(loadingB)
    expect(stale.plugins).toEqual([])
  })

  test("a success after logout is dropped", () => {
    const signedOut = pluginsReducer(readyA, {
      type: "identity",
      identity: null,
    })
    const stale = pluginsReducer(signedOut, {
      type: "success",
      body: body(),
      identity: "user-a",
      seq: 1,
    })
    expect(stale).toEqual(initialPluginsState)
  })

  test("an out-of-order refresh cannot overwrite a newer result", () => {
    // Two refreshes fire: seq 2 then 3. Their answers land reversed.
    const fetching2 = pluginsReducer(readyA, { type: "fetch" })
    const fetching3 = pluginsReducer(fetching2, { type: "fetch" })
    const newerLandsFirst = pluginsReducer(fetching3, {
      type: "success",
      body: body({ plugins: [] }),
      identity: "user-a",
      seq: 3,
    })
    expect(newerLandsFirst.plugins).toEqual([])
    const staleLandsLast = pluginsReducer(newerLandsFirst, {
      type: "success",
      body: body(),
      identity: "user-a",
      seq: 2,
    })
    expect(staleLandsLast).toBe(newerLandsFirst)
    expect(staleLandsLast.plugins).toEqual([])
  })

  test("a stale error does not clobber a recent success", () => {
    const fetching = pluginsReducer(readyA, { type: "fetch" })
    const recovered = pluginsReducer(fetching, {
      type: "success",
      body: body(),
      identity: "user-a",
      seq: 2,
    })
    const staleFailure = pluginsReducer(recovered, {
      type: "failure",
      error: "old request died",
      identity: "user-a",
      seq: 1,
    })
    expect(staleFailure).toBe(recovered)
    expect(staleFailure.status).toBe("ready")
    expect(staleFailure.plugins).toHaveLength(1)
  })

  test("the matching seq still applies its failure", () => {
    const failed = pluginsReducer(fetchingA, {
      type: "failure",
      error: "network down",
      identity: "user-a",
      seq: 1,
    })
    expect(failed.status).toBe("error")
    expect(failed.error).toBe("network down")
  })

  test("actions without identity/seq (legacy callers) still apply", () => {
    const ready = pluginsReducer(fetchingA, { type: "success", body: body() })
    expect(ready.status).toBe("ready")
  })

  test("a refresh marks refreshing on top of ready data and keeps seq pairing", () => {
    const fetching = pluginsReducer(readyA, { type: "fetch" })
    expect(fetching.refreshing).toBe(true)
    expect(fetching.seq).toBe(2)
    const done = pluginsReducer(fetching, {
      type: "success",
      body: body({ policy: "auto" }),
      identity: "user-a",
      seq: 2,
    })
    expect(done.refreshing).toBe(false)
    expect(done.policy).toBe("auto")
  })
})
