import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HttpError } from "./http-error"
import {
  extractPluginFiles,
  fixUiScriptOrder,
  PLUGIN_UI_FILE_NAME,
} from "./plugin-artifact"

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

  test("bundled src vendors execute before inline classic page code", () => {
    // Regression for the frozen-install report: Bun turns <script src> code
    // into a deferred module after the inline classic, so page code referencing
    // vendor globals died with a ReferenceError on the frozen install.
    const tarball = packTree({
      "server/index.html":
        `<!doctype html><html><head>` +
        `<script src="./static/vendor.js"></script>` +
        `</head><body><div id="app"></div>` +
        `<script>document.getElementById("app").textContent = window.vendor()</script>` +
        `</body></html>\n`,
      "server/static/vendor.js": "window.vendor = function () { return 'v' }\n",
    })
    try {
      const files = extractPluginFiles(tarball, [], "server/index.html")
      const ui = files.at(-1)
      expect(ui?.name).toBe(PLUGIN_UI_FILE_NAME)
      const vendorAt = ui?.content.indexOf("window.vendor") ?? -1
      const pageAt = ui?.content.indexOf("textContent = window.vendor()") ?? -1
      expect(pageAt).toBeGreaterThan(vendorAt)
      const pageTag = ui?.content.lastIndexOf("<script", pageAt) ?? 0
      expect(ui?.content.slice(pageTag, pageAt)).toContain('type="module"')
    } finally {
      rmSync(join(tarball, ".."), { recursive: true, force: true })
    }
  })
})

describe("fixUiScriptOrder", () => {
  // Bun's rewrite shape: src-derived code becomes a trailing module script,
  // the page's inline classic stays where it was — before it.
  const BUILT =
    `<!doctype html><html><head></head><body>` +
    `<script>alert(window.vendor())</script>` +
    `<script type="module">// static/vendor.js\n` +
    `window.vendor = function () { return 1 };\n` +
    `</script></body></html>`

  test("moves inline classic page code into a module after the vendor module", () => {
    const fixed = fixUiScriptOrder(BUILT)
    const vendorAt = fixed.indexOf("window.vendor")
    const pageAt = fixed.indexOf("alert(window.vendor())")
    expect(pageAt).toBeGreaterThan(vendorAt)
    // The page code now rides a module script, not the original classic tag.
    const pageTag = fixed.lastIndexOf("<script", pageAt)
    expect(fixed.slice(pageTag, pageAt)).toContain('type="module"')
    // The classic tag is gone from its original position.
    expect(fixed.indexOf("alert(window.vendor())")).toBe(pageAt)
    expect(fixed).not.toContain("<script>alert(")
  })

  test("keeps non-executable and external scripts untouched", () => {
    const html =
      `<body>` +
      `<script type="application/json">{"a":1}</script>` +
      `<script type="importmap">{"imports":{}}</script>` +
      `<script src="https://cdn.example/x.js"></script>` +
      `<script>alert(1)</script>` +
      `<script type="module">window.m = 1</script>` +
      `</body>`
    const fixed = fixUiScriptOrder(html)
    expect(fixed).toContain(`<script type="application/json">{"a":1}</script>`)
    expect(fixed).toContain(`<script type="importmap">{"imports":{}}</script>`)
    expect(fixed).toContain(`<script src="https://cdn.example/x.js"></script>`)
    const jsonAt = fixed.indexOf("application/json")
    const pageAt = fixed.indexOf("alert(1)")
    // Page code rides a module placed after the real module script; data
    // blocks stay in their original positions.
    expect(fixed.slice(fixed.lastIndexOf("<script", pageAt), pageAt)).toContain(
      'type="module"',
    )
    expect(fixed.indexOf("window.m = 1")).toBeLessThan(pageAt)
    expect(jsonAt).toBeLessThan(fixed.indexOf("importmap"))
  })

  test("no rewrite needed when only one script kind exists", () => {
    expect(fixUiScriptOrder("<body><script>a()</script></body>")).toBe(
      "<body><script>a()</script></body>",
    )
    const onlyModules =
      `<body><script type="module">a()</script>` +
      `<script type="module">b()</script></body>`
    expect(fixUiScriptOrder(onlyModules)).toBe(onlyModules)
  })

  test("joins multiple inline classics in document order with scope shared", () => {
    const html =
      `<body>` +
      `<script type="module">window.m = 1</script>` +
      `<script>var shared = 1</script>` +
      `<script>shared += 1</script>` +
      `</body>`
    const fixed = fixUiScriptOrder(html)
    const firstClassic = fixed.indexOf("var shared = 1")
    const secondClassic = fixed.indexOf("shared += 1")
    expect(firstClassic).toBeGreaterThan(0)
    expect(secondClassic).toBeGreaterThan(firstClassic)
    // Both bodies ride the same merged module script.
    const moduleOpen = fixed.indexOf(
      '<script type="module">',
      firstClassic - 30,
    )
    expect(moduleOpen).toBeGreaterThan(0)
    expect(fixed.indexOf("</script>", secondClassic)).toBeGreaterThan(
      secondClassic,
    )
  })
})
