import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, mock, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { VikingHealth } from "./VikingHealth"

// echarts cannot canvas-render under happy-dom; stub the dynamic import
// ChartView makes so charts mount without a real renderer.
mock.module("echarts", () => ({
  init: () => ({ setOption: () => {}, resize: () => {}, dispose: () => {} }),
}))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms = 30) {
  await act(async () => {
    await sleep(ms)
  })
}

function healthyBody() {
  return {
    status: "healthy",
    detail: "",
    errors: [],
    checkedAt: Date.parse("2026-11-06T10:00:00Z"),
    components: [
      {
        name: "queue",
        healthy: true,
        hasErrors: false,
        status: QUEUE_BOX,
        columns: [
          "Queue",
          "Pending",
          "In Progress",
          "Processed",
          "Requeued",
          "Errors",
          "Total",
        ],
        rows: [
          ["Embedding", "0", "0", "10", "0", "0", "10"],
          ["TOTAL", "0", "0", "10", "0", "0", "10"],
        ],
      },
      {
        name: "vikingdb",
        healthy: true,
        hasErrors: false,
        status:
          "Account: default\nBackend: local\nCollection: context\nVector count: 55",
        columns: ["Setting", "Value"],
        rows: [
          ["Account", "default"],
          ["Backend", "local"],
          ["Collection", "context"],
          ["Vector count", "55"],
        ],
      },
      {
        name: "lock",
        healthy: true,
        hasErrors: false,
        status: "no locks held\nlast sweep 3s ago",
        columns: [],
        rows: [],
      },
      {
        name: "models",
        healthy: false,
        hasErrors: true,
        status:
          "+----------------+---------+---------+\n| provider_model | healthy | detail  |\n+----------------+---------+---------+\n| dense_embed    | yes     | ok      |\n| vlm            | no      | timeout |\n+----------------+---------+---------+",
        columns: ["provider_model", "healthy", "detail"],
        rows: [
          ["dense_embed", "yes", "ok"],
          ["vlm", "no", "timeout"],
        ],
      },
    ],
  }
}

// Exactly what the live server draws: an ASCII box table between "+---+"
// rules with center-aligned cells.
const QUEUE_BOX = `+---------+---------+-------------+-----------+----------+--------+-------+
|  Queue  | Pending | In Progress | Processed | Requeued | Errors | Total |
+---------+---------+-------------+-----------+----------+--------+-------+
| Embed   |    0    |      0      |    10     |    0     |   0    |  10   |
|  ding   |         |             |           |          |        |       |
|  TOTAL  |    0    |      0      |    10     |    0     |   0    |  10   |
+---------+---------+-------------+-----------+----------+--------+-------+`

function installFetch(body: unknown) {
  const realFetch = globalThis.fetch
  ;(globalThis as any).fetch = (input: RequestInfo | URL) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "")
    const payload = path === "/api/viking/health" ? body : {}
    return Promise.resolve(
      new Response(JSON.stringify(payload), { status: 200 }),
    )
  }
  return () => {
    globalThis.fetch = realFetch
  }
}

async function renderHealth(body: unknown) {
  const restore = installFetch(body)
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <StrictMode>
        <VikingHealth />
      </StrictMode>,
    )
  })
  await flush()
  return {
    container,
    root,
    restore,
  }
}

describe("VikingHealth", () => {
  test("renders tables, chart panes, summary, and raw-text fallback", async () => {
    const { container, root, restore } = await renderHealth(healthyBody())
    const text = container.textContent ?? ""
    expect(text).toContain("OpenViking health")
    expect(text).toContain("Healthy")
    expect(text).toContain("3/4 components healthy")
    // Parsed tables render as real tables with headers and rows.
    expect(container.querySelectorAll("table").length).toBeGreaterThanOrEqual(3)
    expect(text).toContain("In Progress")
    expect(text).toContain("Embedding")
    expect(text).toContain("Vector count")
    expect(text).toContain("context")
    expect(text).toContain("TOTAL")
    // Chart pane mounts for queue only — the live vikingdb is a key-value
    // block with nothing chartable (echarts stubbed).
    expect(container.querySelector('[data-chart="queue"]')).not.toBeNull()
    expect(container.querySelector('[data-chart="vikingdb"]')).toBeNull()
    // Free-form component shows its full raw status text, never clipped.
    expect(text).toContain("no locks held")
    expect(text).toContain("last sweep 3s ago")
    // Sentiment cells keep their text (coloring is style-only).
    expect(text).toContain("timeout")
    expect(text).toContain("checked at")
    expect(text).toContain("Check again")
    act(() => root.unmount())
    restore()
  })

  test("a partial body (older control plane) renders without crashing", async () => {
    // Regression for the TypeError reading `.length`: the first-deploy
    // control shape carried no columns/rows, and a mismatched plane can omit
    // errors/components entirely.
    const { container, root, restore } = await renderHealth({
      status: "healthy",
      detail: undefined,
      errors: undefined,
      components: [
        { name: "queue", healthy: true, hasErrors: false, status: "A  B" },
      ],
      checkedAt: undefined,
    })
    const text = container.textContent ?? ""
    expect(text).toContain("OpenViking health")
    expect(text).toContain("Healthy")
    expect(text).toContain("A  B")
    expect(container.querySelectorAll("table").length).toBe(0)
    act(() => root.unmount())
    restore()
  })

  test("an empty object body degrades to the up chip, no crash", async () => {
    const { container, root, restore } = await renderHealth({})
    const text = container.textContent ?? ""
    expect(text).toContain("Running — limited")
    expect(container.querySelectorAll("table").length).toBe(0)
    act(() => root.unmount())
    restore()
  })

  test("asleep desktop shows the asleep chip and detail, no components", async () => {
    const { container, root, restore } = await renderHealth({
      status: "asleep",
      detail:
        "OpenViking sleeps with the desktop — start the desktop to bring it up",
      errors: [],
      components: [],
      checkedAt: Date.now(),
    })
    const text = container.textContent ?? ""
    expect(text).toContain("Asleep")
    expect(text).toContain("sleeps with the desktop")
    expect(text).not.toContain("Embedding")
    expect(container.querySelectorAll("table").length).toBe(0)
    act(() => root.unmount())
    restore()
  })

  test("unhealthy instance lists its errors", async () => {
    const { container, root, restore } = await renderHealth({
      status: "unhealthy",
      detail: "",
      errors: ["vikingdb missing records"],
      components: [],
      checkedAt: Date.now(),
    })
    const text = container.textContent ?? ""
    expect(text).toContain("Unhealthy")
    expect(text).toContain("vikingdb missing records")
    act(() => root.unmount())
    restore()
  })

  test("a failed check surfaces the request error", async () => {
    const realFetch = globalThis.fetch
    ;(globalThis as any).fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "control plane hiccups" }), {
          status: 502,
        }),
      )
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <StrictMode>
          <VikingHealth />
        </StrictMode>,
      )
    })
    await flush()
    const text = container.textContent ?? ""
    expect(text).toContain("control plane hiccups")
    act(() => root.unmount())
    globalThis.fetch = realFetch
  })
})
