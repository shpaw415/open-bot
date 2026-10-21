import { expect, mock, test } from "bun:test"

let targets: {
  type?: string
  id?: string
  url?: string
  title?: string
  webSocketDebuggerUrl?: string
}[] = []

mock.module("./cdp", () => ({
  listPageTargets: async () => targets,
  connectCdpSocket: async () => {
    throw new Error("not mocked")
  },
  evaluate: async () => {
    throw new Error("not mocked")
  },
}))

const { sweepZombies } = await import("./tab-sweep")

function page(id: string, url: string) {
  return {
    type: "page",
    id,
    url,
    title: url,
    webSocketDebuggerUrl: `ws://127.0.0.1:9224/devices/${id}`,
  }
}

test("closes unresponsive targets and keeps healthy ones", async () => {
  targets = [page("dead", "https://heavy.test/"), page("live", "https://ok.test/")]
  const closed: string[] = []
  const result = await sweepZombies(9224, {
    probe: async (_port, target) =>
      target.id === "dead" ? "cdp call timed out: Runtime.evaluate" : null,
    close: async (target) => {
      closed.push(target.id ?? "")
      return true
    },
  })
  expect(result.swept).toBe(2)
  expect(closed).toEqual(["dead"])
  expect(result.closed).toEqual([
    { id: "dead", url: "https://heavy.test/", reason: "cdp call timed out: Runtime.evaluate" },
  ])
  expect(result.kept).toBe(1)
})

test("a refused close is not counted", async () => {
  targets = [page("dead", "https://heavy.test/"), page("live", "https://ok.test/")]
  const result = await sweepZombies(9224, {
    probe: async (_port, target) =>
      target.id === "dead" ? "target detached" : null,
    close: async () => false,
  })
  expect(result.closed).toEqual([])
  expect(result.kept).toBe(2)
})

test("every target dead means a wedged browser and nothing is closed", async () => {
  targets = [page("a", "https://a.test/"), page("b", "https://b.test/")]
  let closes = 0
  const result = await sweepZombies(9224, {
    probe: async () => "probe timed out",
    close: async () => {
      closes += 1
      return true
    },
  })
  expect(closes).toBe(0)
  expect(result.closed).toEqual([])
  expect(result.kept).toBe(2)
})

test("no page targets sweeps to zero", async () => {
  targets = []
  const result = await sweepZombies(9224, {
    probe: async () => null,
    close: async () => true,
  })
  expect(result).toEqual({ swept: 0, closed: [], kept: 0 })
})
