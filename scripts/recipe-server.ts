// Throwaway visual-recipe server: serves the freshly built web dist plus
// just enough canned API for the authenticated shell to render. No real
// data, no desktop, no writes. Run: bun scripts/recipe-server.ts
import { join } from "node:path"

const root = new URL("..", import.meta.url).pathname
const dist = process.env.RECIPE_DIST ?? join(root, "apps/web/dist")
const port = Number(process.env.RECIPE_PORT ?? 4789)

const me = {
  id: "recipe-user",
  email: "recipe@open-bot.test",
  role: "admin",
  mustChangePassword: false,
  desktop: "running",
  model: {
    providerID: "zai-coding-plan",
    modelID: "glm-5.3-flash",
    thinkingEffort: "high",
  },
}

const sessions = [
  { id: "s1", title: "Plan the week", updatedAt: Date.now() - 3600_000 },
  {
    id: "s2",
    title: "Marketplace review notes",
    updatedAt: Date.now() - 7200_000,
  },
  { id: "s3", title: "GPIO firmware pass", updatedAt: Date.now() - 86_400_000 },
]

const projects = [
  { id: "proj-1", name: "alpha-site", path: "/home/agent/alpha-site" },
  { id: "proj-2", name: "beta-tools", path: "/home/agent/beta-tools" },
]

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    if (path === "/api/me") return json(me)
    if (path === "/api/models")
      return json({
        models: [
          {
            providerID: "zai-coding-plan",
            modelID: "glm-5.3-flash",
            name: "GLM 5.3 Flash",
            variants: ["high", "medium", "low"],
          },
          { providerID: "xai", modelID: "grok-4", name: "Grok 4" },
          { providerID: "openai", modelID: "gpt-5", name: "GPT-5" },
        ],
      })
    if (path === "/api/opencode/session") return json(sessions)
    if (path.startsWith("/api/opencode/session/")) return json({ messages: [] })
    if (path === "/api/projects") return json({ projects })
    if (path === "/api/plugins/installed") return json({ plugins: [] })
    if (path === "/api/thread-dirs") return json({ dirs: [] })
    if (path === "/api/personas") return json({ personas: [] })
    if (path === "/api/personas/threads") return json({})
    if (path === "/api/cron") return json({ jobs: [] })
    if (path === "/api/reports") return json({ reports: [] })
    if (path === "/api/desktop") return json({ phase: "running" })
    if (path === "/api/skills") return json({ skills: [] })
    if (request.headers.get("upgrade") === "websocket")
      return new Response(null, { status: 426 })
    const file = Bun.file(join(dist, path))
    if (path !== "/" && (await file.exists())) {
      const types: Record<string, string> = {
        ".png": "image/png",
        ".ico": "image/x-icon",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
      }
      const ext = path.slice(path.lastIndexOf("."))
      return new Response(file, {
        headers: { "content-type": types[ext] ?? file.type },
      })
    }
    return new Response(Bun.file(join(dist, "index.html")), {
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  },
})

console.log(`recipe server on http://127.0.0.1:${server.port}`)
