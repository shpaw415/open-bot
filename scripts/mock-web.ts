/**
 * Local mock server for the built web app — Serves apps/web/dist plus a
 * controlled /api so the served build can be walked in a browser without
 * touching any real desktop or account. NEVER used in production.
 *
 *   bun scripts/mock-web.ts [port]
 *
 * Controlled knobs (query on /api/control?...): none — a fixture with a
 * running desktop, a model, one recent thread, one upcoming job with an
 * old-style error on a FOURTH job (alert derivation), one one-shot job.
 */
import { join } from "node:path"

const port = Number(process.argv[2] ?? 4620)
const dist = join(import.meta.dir, "..", "apps", "web", "dist")

// V01 recipe knob: which /api/threads/recent payload the home gets.
// "full" (default) | "titles-empty" | "full-empty" | "error"
const RECENT_MODE = process.env.MOCK_RECENT ?? "full"

const me = {
  id: "mock-user",
  email: "recette@example.com",
  role: "user" as const,
  desktop: "running" as const,
  model: { providerID: "mock", modelID: "glm-flash", thinkingEffort: null },
}

const now = Date.now()
const sessions = [
  {
    id: "sess-alpha",
    title: "Rapport hebdomadaire marché",
    updatedAt: now - 3_600_000,
    time: { created: now - 86_400_000 },
  },
  {
    id: "sess-beta",
    title: "Idées améliorations site",
    updatedAt: now - 200_000,
    time: { created: now - 172_800_000 },
  },
]

const jobs = [
  {
    id: "job-1",
    name: "Veille marché",
    enabled: true,
    nextRunAt: now + 7_200_000,
    lastError: null,
    message: "Surveille les prix",
    kind: "every",
    cronExpr: null,
    everySeconds: 7_200,
    atMs: null,
    sessionId: null,
    createdAt: now,
    lastRunAt: null,
    runCount: 0,
    providerId: null,
    modelId: null,
    personaId: null,
  },
  {
    id: "job-2",
    name: "Rappel facture",
    enabled: true,
    nextRunAt: now + 26 * 3_600_000,
    lastError: null,
    message: "Rappelle la facture",
    kind: "at",
    cronExpr: null,
    everySeconds: null,
    atMs: now + 26 * 3_600_000,
    sessionId: null,
    createdAt: now,
    lastRunAt: null,
    runCount: 0,
    providerId: null,
    modelId: null,
    personaId: null,
  },
  {
    id: "job-3",
    name: "Rapport quotidien",
    enabled: true,
    nextRunAt: now + 3_600_000,
    lastError: null,
    message: "Rapport",
    kind: "every",
    cronExpr: null,
    everySeconds: 86_400,
    atMs: null,
    sessionId: null,
    createdAt: now,
    lastRunAt: null,
    runCount: 0,
    providerId: null,
    modelId: null,
    personaId: null,
  },
  // FOURTH enabled job with the only error — must still alert (R09).
  {
    id: "job-4",
    name: "Synchro inventaire",
    enabled: true,
    nextRunAt: now + 48 * 3_600_000,
    lastError: "connection refused (mock)",
    message: "Synchronise",
    kind: "every",
    cronExpr: null,
    everySeconds: 172_800,
    atMs: null,
    sessionId: null,
    createdAt: now,
    lastRunAt: null,
    runCount: 0,
    providerId: null,
    modelId: null,
    personaId: null,
  },
]

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  })

const recentFull = () => ({
  coverage: "full",
  threads: [
    {
      sessionId: "sess-beta",
      title: "Idées améliorations site",
      createdAt: now - 200_000,
    },
    {
      sessionId: "sess-alpha",
      title: "Rapport hebdomadaire marché",
      createdAt: now - 3_600_000,
    },
  ],
})

function recentPayload(): { status: number; body: unknown } {
  if (RECENT_MODE === "error")
    return { status: 500, body: { error: "mock down" } }
  if (RECENT_MODE === "titles-empty")
    return { status: 200, body: { threads: [] } }
  if (RECENT_MODE === "full-empty")
    return { status: 200, body: { threads: [], coverage: "full" } }
  return { status: 200, body: recentFull() }
}

// Two enabled plugin apps so the Apps view (and the V03 route selection)
// has something real to select. Kind "page" keeps everything in-process.
const installedPlugins = [
  {
    pluginId: "stock-dashboard",
    name: "Stock dashboard",
    enabled: true,
    manifest: {
      dashboard: {
        tabs: [
          { id: "grid", title: "Grille du marché", kind: "page" },
          { id: "leads", title: "Leads", kind: "page" },
        ],
      },
    },
  },
]

const slow = async (ms: number, pass: () => Response) => {
  await new Promise((r) => setTimeout(r, ms))
  return pass()
}

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    if (path.startsWith("/api/")) {
      // ---- controlled fixtures -------------------------------------------
      if (path === "/api/me") return json(me)
      if (path === "/api/desktop")
        return json({ phase: "running", error: null })
      if (path === "/api/desktop/start") return json({ phase: "starting" })
      if (path === "/api/threads/recent") {
        // Slightly slow: home must leave "loading" for real content (R01).
        const payload = recentPayload()
        return slow(600, () => json(payload.body, payload.status))
      }
      if (path === "/api/cron") return json(jobs)
      if (path === "/api/cron/notices") return json([])
      if (path === "/api/quota")
        return json({
          limitTokens: 100000,
          used: 1000,
          over: false,
          behavior: "warn",
        })
      if (path === "/api/projects")
        return json({
          projects: [
            { id: "p1", name: "Demo", path: "/home/agent/projects/demo" },
          ],
        })
      if (path === "/api/models")
        return json({
          models: [
            { providerID: "mock", modelID: "glm-flash", name: "GLM Flash" },
          ],
          connected: ["mock"],
        })
      if (path === "/api/personas")
        return json({
          personas: [
            {
              id: "assistant",
              name: "Assistant",
              instruction: "",
              builtin: true,
            },
          ],
        })
      if (path === "/api/personas/threads") return json({ threads: [] })
      if (path === "/api/thread-dirs") return json({ dirs: [] })
      if (path === "/api/thread-dirs/assignments") return json({ threads: [] })
      if (path === "/api/skills") return json({ skills: [] })
      if (path === "/api/opencode/session/status")
        return json({
          "sess-alpha": { isRunning: false },
          "sess-beta": { isRunning: false },
        })
      if (path === "/api/opencode/session" && request.method === "GET")
        // Slow history: a blank "Nouvelle conversation" must NOT be replaced
        // by an old thread after this resolves (R02).
        return slow(2500, () => json(sessions))
      if (
        path.startsWith("/api/opencode/session/") &&
        path.endsWith("/message")
      )
        return json([])
      if (path === "/api/keys") return json([])
      if (path === "/api/plugins/installed")
        return json({ plugins: installedPlugins })
      if (path === "/api/config") return json({})
      if (path.startsWith("/api/")) return json({})
    }
    // ---- static files ----------------------------------------------------
    const rel = path === "/" ? "/index.html" : path
    const file = Bun.file(join(dist, rel))
    if (await file.exists()) return new Response(file)
    return new Response(Bun.file(join(dist, "index.html")), {
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  },
  websocket: {
    open(ws) {
      ws.send(JSON.stringify({ type: "opencode.up" }))
      setInterval(() => ws.send(JSON.stringify({ type: "ping" })), 15000)
    },
    message() {},
  },
})

console.log(`mock web on http://127.0.0.1:${port} (dist: ${dist})`)
