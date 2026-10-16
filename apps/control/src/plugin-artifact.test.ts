import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HttpError } from "./http-error"
import { extractPluginFiles, PLUGIN_UI_FILE_NAME } from "./plugin-artifact"

// Packs a synthetic plugin tree into a tarball with the same layout the
// marketplace serves: one GitHub root directory, repo-relative sources.
function packTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ob-ui-test-"))
  const root = join(dir, "plugin-main")
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name)
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, content)
  }
  const tarball = join(dir, "artifact.tgz")
  const tar = Bun.spawnSync(["tar", "-czf", tarball, "-C", dir, "plugin-main"])
  if (tar.exitCode !== 0) throw new Error("test tar failed")
  return tarball
}

const FRONTEND = {
  "server/server.ts": "console.log('server')\n",
  "server/index.html":
    `<!doctype html><html><head>` +
    `<link rel="stylesheet" href="./styles.css">` +
    `</head><body><div id="app"></div>` +
    `<script type="module" src="./app.ts"></script></body></html>\n`,
  "server/app.ts":
    `const el = document.getElementById("app") as HTMLElement | null\n` +
    `if (el) el.textContent = "hi"\n`,
  "server/styles.css": "body { color: #eee; }\n",
}

describe("plugin artifact ui build", () => {
  test("builds one self-contained html from the declared frontend", () => {
    const tarball = packTree(FRONTEND)
    try {
      const files = extractPluginFiles(
        tarball,
        [
          { name: "server.ts", source: "server/server.ts", exec: true },
          { name: "index.html", source: "server/index.html" },
          { name: "app.ts", source: "server/app.ts" },
          { name: "styles.css", source: "server/styles.css" },
        ],
        "server/index.html",
      )
      expect(files.map((file) => file.name)).toEqual([
        "server.ts",
        "index.html",
        "app.ts",
        "styles.css",
        PLUGIN_UI_FILE_NAME,
      ])
      const ui = files.at(-1)
      expect(ui?.exec).toBe(false)
      // TypeScript transpiled, CSS inlined, no external references left.
      expect(ui?.content).toContain('<script type="module">')
      expect(ui?.content).toContain("<style>")
      expect(ui?.content).toContain("textContent")
      // No unresolved external references: everything rides inline tags
      // (bundler path comments may still mention the source file names).
      expect(ui?.content).not.toMatch(/(src|href)=["']\.\.??\//)
    } finally {
      rmSync(join(tarball, ".."), { recursive: true, force: true })
    }
  })

  test("no ui source keeps the plain extraction", () => {
    const tarball = packTree(FRONTEND)
    try {
      const files = extractPluginFiles(tarball, [
        { name: "server.ts", source: "server/server.ts", exec: true },
      ])
      expect(files.map((file) => file.name)).toEqual(["server.ts"])
    } finally {
      rmSync(join(tarball, ".."), { recursive: true, force: true })
    }
  })

  test("a missing ui entry is a 404 like any other artifact file", () => {
    const tarball = packTree(FRONTEND)
    try {
      let code = ""
      try {
        extractPluginFiles(tarball, [], "server/missing.html")
      } catch (error) {
        code = error instanceof HttpError ? error.code : ""
      }
      expect(code).toBe("artifact_file")
    } finally {
      rmSync(join(tarball, ".."), { recursive: true, force: true })
    }
  })

  test("a broken frontend fails the install with the build error", () => {
    const tarball = packTree({
      "server/index.html":
        `<html><head><script type="module" src="./app.ts"></script>` +
        `</head><body></body></html>`,
      "server/app.ts": "const x: = not typescript(((\n",
    })
    try {
      let code = ""
      let message = ""
      try {
        extractPluginFiles(tarball, [], "server/index.html")
      } catch (error) {
        if (error instanceof HttpError) {
          code = error.code
          message = error.message
        }
      }
      expect(code).toBe("ui_build_failed")
      expect(message).toContain("server/index.html")
    } finally {
      rmSync(join(tarball, ".."), { recursive: true, force: true })
    }
  })
})
