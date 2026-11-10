// ov-eval — golden-query evaluation for OpenViking memory search
// (#20/#21/#32/#71/#83). Ranking quality is upstream-owned; this harness
// turns anecdotes ("search feels off") into a repeatable baseline: for each
// golden query it records the top hits, scores, latency, and stability
// (same query twice → same top-1). Run where the sidecar is reachable:
//   OPENVIKING_URL=http://viking:1933 OPENVIKING_API_KEY=... bun scripts/ov-eval.ts
// or inside a desktop: docker exec <ob-oc-*> bun /path/to/ov-eval.ts
// Output: JSON report on stdout; exit 1 if any hard check fails.
import { readFileSync } from "node:fs"

type Golden = { query: string; expectAnyOf?: string[]; note?: string }

const base = (process.env.OPENVIKING_URL ?? "http://viking:1933").replace(
  /\/$/,
  "",
)
const key = process.env.OPENVIKING_API_KEY ?? ""
const goldenPath = new URL("./ov-eval.golden.json", import.meta.url)
const goldens = JSON.parse(readFileSync(goldenPath, "utf8")) as Golden[]

async function find(query: string) {
  const started = performance.now()
  const res = await fetch(`${base}/api/v1/search/find`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { "x-api-key": key, authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ query, limit: 5 }),
  })
  const ms = Math.round(performance.now() - started)
  if (!res.ok)
    throw new Error(`find ${res.status}: ${await res.text().catch(() => "")}`)
  const body = (await res.json()) as {
    result?: {
      memories?: Array<{ uri?: string; score?: number; abstract?: string }>
    }
    memories?: Array<{ uri?: string; score?: number; abstract?: string }>
  }
  const hits = body.result?.memories ?? body.memories ?? []
  return {
    ms,
    hits: hits.map((h) => ({
      uri: h.uri ?? "",
      score: h.score ?? 0,
      abstract: (h.abstract ?? "").slice(0, 160),
    })),
  }
}

let failures = 0
const report: unknown[] = []
for (const g of goldens) {
  try {
    const a = await find(g.query)
    const b = await find(g.query)
    const sorted = a.hits.every(
      (h, i) => i === 0 || (a.hits[i - 1]?.score ?? 0) >= h.score,
    )
    const stable = (a.hits[0]?.uri ?? "") === (b.hits[0]?.uri ?? "")
    const wanted = g.expectAnyOf ?? []
    const expectHit =
      wanted.length === 0 ||
      a.hits.some((h) =>
        wanted.some((s) =>
          `${h.uri} ${h.abstract}`.toLowerCase().includes(s.toLowerCase()),
        ),
      )
    const checks = { sorted, stable, expectHit, nonEmpty: a.hits.length > 0 }
    if (!sorted || !stable || !expectHit) failures++
    report.push({
      query: g.query,
      note: g.note ?? "",
      ms: a.ms,
      checks,
      top: a.hits,
    })
  } catch (error) {
    failures++
    report.push({
      query: g.query,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
console.log(
  JSON.stringify(
    { base, at: new Date().toISOString(), failures, report },
    null,
    2,
  ),
)
process.exit(failures ? 1 : 0)
