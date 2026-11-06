import { describe, expect, test } from "bun:test"
import {
  parseStatusTable,
  parseVikingObserver,
  probeVikingHealth,
  type VikingHealth,
} from "./viking-health"

function okJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

// Bun's `typeof fetch` carries a preconnect member test doubles lack; the
// cast keeps the mocks minimal (same pattern as viking-skills.test.ts).
function asFetch(
  impl: (input: RequestInfo | URL) => Promise<Response>,
): typeof fetch {
  return impl as typeof fetch
}

const QUEUE_TABLE =
  "Queue                 Pending  In Progress  Processed  Errors  Total\nEmbedding             0        0            10         0       10\nSemantic              1        2            10         3       16\nTOTAL                 1        2            20         3       26"

// The format the LIVE server actually draws (2026-11-06 field capture): an
// ASCII box table between "+---+" rules, quite unlike the docs' aligned
// example above. Regression: the first parser shredded these into pipes.
const QUEUE_BOX_TABLE = `+---------------+---------+-------------+-----------+---------+--------+-------+
| Queue         | Pending | In Progress | Processed | Requeued | Errors | Total |
+---------------+---------+-------------+-----------+----------+--------+-------+
| Embedding     | 0       | 0           | 4         | 0        | 0      | 4     |
| Semantic      | 0       | 0           | 2         | 0        | 0      | 2     |
| SessionCommit | 1       | 0           | 0         | 0        | 0      | 1     |
| TOTAL         | 1       | 0           | 6         | 0        | 0      | 7     |
+---------------+---------+-------------+-----------+----------+--------+-------+`

const VIKINGDB_BOX_TABLE = `+--------------+-------------+--------------+--------+
| Collection   | Index Count | Vector Count | Status |
+--------------+-------------+--------------+--------+
| context      | 1           | 55           | OK     |
| projects     | 2           | 1204         | OK     |
| TOTAL        | 3           | 1259         |        |
+--------------+-------------+--------------+--------+`

const VIKINGDB_TABLE =
  "Collection  Index Count  Vector Count  Status\ncontext     1            55            OK\nTOTAL       1            55"

const OBSERVER_HEALTHY = {
  status: "ok",
  result: {
    is_healthy: true,
    errors: [],
    components: {
      queue: {
        name: "queue",
        is_healthy: true,
        has_errors: false,
        status: QUEUE_TABLE,
      },
      vikingdb: {
        name: "vikingdb",
        is_healthy: true,
        has_errors: false,
        status: VIKINGDB_TABLE,
      },
      lock: {
        name: "lock",
        is_healthy: true,
        has_errors: false,
        status: "...",
      },
      models: {
        name: "models",
        is_healthy: false,
        has_errors: true,
        status:
          "provider_model         healthy  detail\ndense_embedding        yes      ok\nvlm                    no       timeout",
      },
    },
  },
  time: 0.1,
}

describe("parseStatusTable", () => {
  test("parses the queue table with multi-word headers", () => {
    const table = parseStatusTable(QUEUE_TABLE)
    expect(table).not.toBeNull()
    expect(table?.columns).toEqual([
      "Queue",
      "Pending",
      "In Progress",
      "Processed",
      "Errors",
      "Total",
    ])
    expect(table?.rows).toEqual([
      ["Embedding", "0", "0", "10", "0", "10"],
      ["Semantic", "1", "2", "10", "3", "16"],
      ["TOTAL", "1", "2", "20", "3", "26"],
    ])
  })

  test("parses the vikingdb table", () => {
    const table = parseStatusTable(VIKINGDB_TABLE)
    expect(table?.columns).toEqual([
      "Collection",
      "Index Count",
      "Vector Count",
      "Status",
    ])
    expect(table?.rows[0]).toEqual(["context", "1", "55", "OK"])
  })

  test("parses the live box-table format (pipes and +---+ rules)", () => {
    const table = parseStatusTable(QUEUE_BOX_TABLE)
    expect(table?.columns).toEqual([
      "Queue",
      "Pending",
      "In Progress",
      "Processed",
      "Requeued",
      "Errors",
      "Total",
    ])
    expect(table?.rows).toEqual([
      ["Embedding", "0", "0", "4", "0", "0", "4"],
      ["Semantic", "0", "0", "2", "0", "0", "2"],
      ["SessionCommit", "1", "0", "0", "0", "0", "1"],
      ["TOTAL", "1", "0", "6", "0", "0", "7"],
    ])
  })

  test("box-table rules never leak into rows or headers", () => {
    const table = parseStatusTable(VIKINGDB_BOX_TABLE)
    expect(table?.columns).toEqual([
      "Collection",
      "Index Count",
      "Vector Count",
      "Status",
    ])
    expect(
      table?.rows.every((row) => row.every((cell) => !cell.includes("+"))),
    ).toBe(true)
    expect(table?.rows).toHaveLength(3)
  })

  test("parses the live vikingdb key-value block", () => {
    const table = parseStatusTable(
      "Account: default\nBackend: local\nCollection: context\nIndex: default\nDimension: 1024\nVector count: 24",
    )
    expect(table?.columns).toEqual(["Setting", "Value"])
    expect(table?.rows).toEqual([
      ["Account", "default"],
      ["Backend", "local"],
      ["Collection", "context"],
      ["Index", "default"],
      ["Dimension", "1024"],
      ["Vector count", "24"],
    ])
  })

  test("lock key-value lines become a table", () => {
    const table = parseStatusTable(
      "Active locks: 0\nWaiting locks: 0\nConflicts: 0",
    )
    expect(table?.rows).toEqual([
      ["Active locks", "0"],
      ["Waiting locks", "0"],
      ["Conflicts", "0"],
    ])
  })

  test("filesystem: first section wins; a repeated header opens a new section", () => {
    const status = `Mount: /local (plugin: localfs)
============================================
+-------------+-------+
| Operation   | Count |
+-------------+-------+
| read        | 12    |
| stat        | 88    |
+-------------+-------+
+-------------+-------+
| Operation   | Count |
+-------------+-------+
| read        | 99    |
+-------------+-------+`
    const table = parseStatusTable(status)
    // The "Mount" lead line is skipped (a one-line kv block is not a
    // table), the first Operation table wins, the duplicate section is cut.
    expect(table?.columns).toEqual(["Operation", "Count"])
    expect(table?.rows).toEqual([
      ["read", "12"],
      ["stat", "88"],
    ])
  })

  test("values containing colons survive the key-value split", () => {
    const table = parseStatusTable(
      "Path: /data/viking\nLast error: timeout: connection refused",
    )
    expect(table?.rows).toEqual([
      ["Path", "/data/viking"],
      ["Last error", "timeout: connection refused"],
    ])
  })

  test("skips blank lines and tolerates a leading non-table line", () => {
    const table = parseStatusTable("\n[queue] (healthy)\n\nA  B\n1  2\n")
    expect(table?.columns).toEqual(["A", "B"])
    expect(table?.rows).toEqual([["1", "2"]])
  })

  test("null on free-form or single-column text", () => {
    expect(parseStatusTable("...")).toBeNull()
    expect(parseStatusTable("single line")).toBeNull()
    expect(parseStatusTable("Header\n")).toBeNull()
    expect(parseStatusTable("")).toBeNull()
  })
})

describe("parseVikingObserver", () => {
  test("reads the envelope and parses each component table", () => {
    const report = parseVikingObserver(OBSERVER_HEALTHY)
    expect(report).not.toBeNull()
    expect(report?.healthy).toBe(true)
    expect(report?.errors).toEqual([])
    const queue = report?.components.find((c) => c.name === "queue")
    expect(queue?.columns[1]).toBe("Pending")
    expect(queue?.rows).toHaveLength(3)
    const lock = report?.components.find((c) => c.name === "lock")
    expect(lock?.columns).toEqual([])
    expect(lock?.rows).toEqual([])
    expect(lock?.status).toBe("...")
    const models = report?.components.find((c) => c.name === "models")
    expect(models?.healthy).toBe(false)
    expect(models?.rows[1]).toEqual(["vlm", "no", "timeout"])
  })

  test("accepts the bare result shape and component-name fallback", () => {
    const report = parseVikingObserver({
      is_healthy: false,
      errors: ["embedding down", { message: "vlm timeout" }, "embedding down"],
      components: {
        vikingdb: { is_healthy: false, has_errors: true, status: "" },
      },
    })
    expect(report?.healthy).toBe(false)
    // Deduped, order preserved.
    expect(report?.errors).toEqual(["embedding down", "vlm timeout"])
    // A component without a name field falls back to the entry key.
    expect(report?.components[0]?.name).toBe("vikingdb")
  })

  test("null on nothing recognizable", () => {
    expect(parseVikingObserver(null)).toBeNull()
    expect(parseVikingObserver({})).toBeNull()
    expect(parseVikingObserver({ result: { components: {} } })).toBeNull()
    expect(parseVikingObserver("ok")).toBeNull()
  })

  test("keeps realistic tables unclipped; clips only pathological sizes", () => {
    const report = parseVikingObserver({
      is_healthy: false,
      errors: ["x".repeat(500)],
      components: {
        queue: {
          is_healthy: true,
          has_errors: false,
          status: "y".repeat(9000),
        },
      },
    })
    expect(report?.errors[0]?.length).toBeLessThanOrEqual(301)
    // 9000 chars clips at the 8000 guard; a realistic 500-char table rides
    // along whole — the dashboard shows everything.
    expect(report?.components[0]?.status.length).toBe(8001)
    const realistic = parseVikingObserver({
      is_healthy: true,
      errors: [],
      components: {
        queue: { is_healthy: true, has_errors: false, status: QUEUE_TABLE },
      },
    })
    expect(realistic?.components[0]?.status).toBe(QUEUE_TABLE)
  })
})

describe("probeVikingHealth", () => {
  test("healthy observer report maps to status healthy with parsed tables", async () => {
    const health = await probeVikingHealth(
      "http://viking:1933/",
      "root",
      asFetch(async () => okJson(OBSERVER_HEALTHY)),
    )
    expect(health.status).toBe("healthy")
    expect(health.components).toHaveLength(4)
    expect(health.components[0]?.columns.length).toBeGreaterThan(1)
    expect(health.detail).toBe("")
  })

  test("unhealthy observer report carries errors", async () => {
    const health = await probeVikingHealth(
      "http://viking:1933",
      "root",
      asFetch(async () =>
        okJson({
          result: {
            is_healthy: false,
            errors: ["vikingdb missing records"],
            components: {},
          },
        }),
      ),
    )
    expect(health.status).toBe("unhealthy")
    expect(health.errors).toEqual(["vikingdb missing records"])
  })

  test("observer failure falls back to /health: up", async () => {
    const urls: string[] = []
    const health = await probeVikingHealth(
      "http://viking:1933",
      "root",
      asFetch(async (input) => {
        const url = String(input)
        urls.push(url)
        if (url.endsWith("/api/v1/observer/system"))
          return new Response("nope", { status: 404 })
        return new Response("ok", { status: 200 })
      }),
    )
    expect(urls).toEqual([
      "http://viking:1933/api/v1/observer/system",
      "http://viking:1933/health",
    ])
    expect(health.status).toBe("up")
    expect(health.detail).toContain("observer unavailable (404)")
  })

  test("both fail: down with combined detail", async () => {
    const health = await probeVikingHealth(
      "http://viking:1933",
      "root",
      asFetch(async () => {
        throw new Error("connection refused")
      }),
    )
    expect(health.status).toBe("down")
    expect(health.detail).toContain("connection refused")
  })

  test("observer ok but unparseable body falls back to /health", async () => {
    const health: VikingHealth = await probeVikingHealth(
      "http://viking:1933",
      "root",
      asFetch(async (input) =>
        String(input).endsWith("/health")
          ? okJson({ ok: true })
          : okJson({ status: "ok", result: { unexpected: true } }),
      ),
    )
    expect(health.status).toBe("up")
  })
})
