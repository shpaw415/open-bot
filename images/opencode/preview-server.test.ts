import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { injectReload, safePreviewPath, servePreview } from "./preview-server"

describe("preview path", () => {
  test("rejects traversal and maps the root to index.html", () => {
    expect(safePreviewPath("/")).toBe("index.html")
    expect(safePreviewPath("/about")).toBe("about")
    expect(safePreviewPath("/a/../b")).toBeNull()
    expect(safePreviewPath("/a\\b")).toBeNull()
  })
})

describe("reload script", () => {
  test("injects a protocol-aware websocket and does not double-inject", () => {
    const html = injectReload("<html><body><h1>Hi</h1></body></html>")
    expect(html).toContain('location.protocol === "https:" ? "wss:" : "ws:"')
    expect(html).toContain("__ob/reload")
    expect(injectReload(html)).toBe(html)
  })
})

describe("preview server", () => {
  test("serves html with the reload script and hides traversal", async () => {
    const root = mkdtempSync(join(tmpdir(), "ob-preview-"))
    mkdirSync(join(root, "nested"))
    writeFileSync(join(root, "index.html"), "<html><body>Home</body></html>")
    writeFileSync(
      join(root, "nested", "index.html"),
      "<html><body>Nested</body></html>",
    )
    try {
      const home = await servePreview(root, "/")
      expect(home.status).toBe(200)
      const body = await home.text()
      expect(body).toContain("Home")
      expect(body).toContain("__ob/reload")
      const nested = await servePreview(root, "/nested/")
      expect(await nested.text()).toContain("Nested")
      expect((await servePreview(root, "/missing")).status).toBe(404)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
