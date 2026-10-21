import { afterAll, describe, expect, test } from "bun:test"
import type { Db } from "@open-bot/db"
import { sha256 } from "./passwords"
import { createServer } from "./server"

const user = { id: "user-1", disabled: false, mustChangePassword: false }
const session = { userId: "user-1", expiresAt: Date.now() + 60_000 }
const plugin = {
  pluginId: "stock-pro",
  enabled: true,
  manifest: { dashboard: { pages: {} } },
}

const db = {
  sessionByHash: (hash: string) => (hash === sha256("tok") ? session : null),
  userById: (id: string) => (id === "user-1" ? user : null),
  installedPlugin: (userId: string, pluginId: string) =>
    userId === "user-1" && pluginId === "stock-pro" ? plugin : null,
  getSetting: () => null,
} as unknown as Db

process.env.PORT = "0"
const server = createServer(db, {} as never, "127.0.0.1", {
  emit() {},
} as never)

afterAll(() => server.stop(true))

describe("POST /api/pages/frame dispatch", () => {
  test("mints an app-tab frame token instead of falling into the page proxy", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/pages/frame`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "ob_session=tok",
      },
      body: JSON.stringify({ pluginId: "stock-pro" }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { frameUrl: string }
    expect(body.frameUrl).toMatch(/^\/api\/pages\/_frame\/[A-Za-z0-9_-]{43,}\//)
  })
})
