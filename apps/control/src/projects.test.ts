import { describe, expect, test } from "bun:test"
import {
  isProjectManageRequest,
  opencodeFileUrl,
  PLUGINS_ROOT,
  PROJECTS_ROOT,
  projectCategory,
  projectDir,
  projectName,
  projectSubpath,
  resolveCustomProjectPath,
  slugifyName,
} from "./projects"

describe("slugify name", () => {
  test("lowercases and dashes", () => {
    expect(slugifyName("My App")).toBe("my-app")
    expect(slugifyName("  Web_Scraper 2 ")).toBe("web-scraper-2")
  })

  test("rejects names without usable characters", () => {
    expect(slugifyName("///")).toBeNull()
    expect(slugifyName("")).toBeNull()
  })

  test("caps length", () => {
    expect(slugifyName("a".repeat(100))).toHaveLength(64)
  })
})

describe("project dir", () => {
  test("lives under the workspace root", () => {
    expect(projectDir("my-app")).toBe("/home/agent/workspace/my-app")
    expect(PROJECTS_ROOT).toBe("/home/agent/workspace")
  })
})

describe("project subpath", () => {
  const root = "/home/agent/workspace/my-app"

  test("accepts the root itself and inner paths", () => {
    expect(projectSubpath(root, root)).toBe(root)
    expect(projectSubpath(root, `${root}/src/index.ts`)).toBe(
      `${root}/src/index.ts`,
    )
    expect(projectSubpath(root, `${root}/`)).toBe(root)
  })

  test("rejects escapes and junk", () => {
    expect(projectSubpath(root, `${root}/../other/secrets`)).toBeNull()
    expect(projectSubpath(root, "/etc/passwd")).toBeNull()
    expect(projectSubpath(root, `${root}/a//b`)).toBeNull()
    expect(projectSubpath(root, `${root}/a/./b`)).toBeNull()
    expect(projectSubpath(root, `${root}\0/x`)).toBeNull()
    expect(projectSubpath(root, `${root}\\windows`)).toBeNull()
    expect(projectSubpath(root, "")).toBeNull()
    expect(projectSubpath(root, undefined)).toBeNull()
    expect(projectSubpath(root, 42)).toBeNull()
  })

  test("keeps odd but safe file names", () => {
    expect(projectSubpath(root, `${root}/50% off.txt`)).toBe(
      `${root}/50% off.txt`,
    )
    expect(projectSubpath(root, `${root}/README.md`)).toBe(`${root}/README.md`)
  })
})

describe("project name", () => {
  test("trims and collapses whitespace", () => {
    expect(projectName("  My   App ")).toBe("My App")
  })

  test("rejects unusable names", () => {
    expect(projectName("///")).toBeNull()
    expect(projectName("")).toBeNull()
    expect(projectName(7)).toBeNull()
  })
})

describe("project manage requests", () => {
  test("allows list, add, and remove only", () => {
    expect(isProjectManageRequest("/api/projects", "GET")).toBe(true)
    expect(isProjectManageRequest("/api/projects", "POST")).toBe(true)
    expect(isProjectManageRequest("/api/projects/abc", "DELETE")).toBe(true)
    expect(isProjectManageRequest("/api/projects/abc/file", "GET")).toBe(false)
    expect(isProjectManageRequest("/api/projects/abc/files", "GET")).toBe(false)
    expect(isProjectManageRequest("/api/projects/abc/search", "POST")).toBe(
      false,
    )
    expect(isProjectManageRequest("/api/projects/abc/terminal", "GET")).toBe(
      false,
    )
    expect(isProjectManageRequest("/api/projects", "DELETE")).toBe(false)
  })
})

describe("project category", () => {
  test("plugin projects point into plugins-create", () => {
    expect(projectCategory("/home/agent/plugins-create/price-scout")).toBe(
      "plugins",
    )
    expect(projectCategory(`${PLUGINS_ROOT}/a/b`)).toBe("plugins")
    expect(projectCategory(PLUGINS_ROOT)).toBe("plugins")
  })

  test("everything else is general", () => {
    expect(projectCategory("/home/agent/workspace/my-app")).toBe("general")
    expect(projectCategory("/home/agent/plugins-create-other/x")).toBe(
      "general",
    )
    expect(projectCategory("/home/agent/x")).toBe("general")
    expect(projectCategory("/etc")).toBe("general")
  })
})

describe("resolve custom project path", () => {
  test("accepts absolute folders under /home/agent", () => {
    expect(resolveCustomProjectPath("/home/agent/plugins-create/blender")).toBe(
      "/home/agent/plugins-create/blender",
    )
    expect(resolveCustomProjectPath("/home/agent/workspace/my-app")).toBe(
      "/home/agent/workspace/my-app",
    )
    expect(resolveCustomProjectPath("/home/agent/x/")).toBe("/home/agent/x")
  })

  test("rejects everything outside /home/agent or unsafe", () => {
    expect(resolveCustomProjectPath("/etc/passwd")).toBeNull()
    expect(resolveCustomProjectPath("/home/agent/../etc")).toBeNull()
    expect(resolveCustomProjectPath("/home/agent/a//b")).toBeNull()
    expect(resolveCustomProjectPath("/home/agent/")).toBeNull()
    expect(resolveCustomProjectPath("relative/path")).toBeNull()
    expect(resolveCustomProjectPath("/home/agent/a\\b")).toBeNull()
    expect(resolveCustomProjectPath(null)).toBeNull()
    expect(resolveCustomProjectPath(42)).toBeNull()
    expect(resolveCustomProjectPath(undefined)).toBeNull()
  })
})

describe("opencode file url", () => {
  const base = "http://ob-oc-x:4096"

  test("re-roots the listing at the project folder", () => {
    expect(
      opencodeFileUrl(
        base,
        "list",
        "/home/agent/plugins-create/x",
        "/home/agent/plugins-create/x",
      ),
    ).toBe(
      `${base}/file?path=%2Fhome%2Fagent%2Fplugins-create%2Fx&directory=%2Fhome%2Fagent%2Fplugins-create%2Fx`,
    )
  })

  test("content route keeps subpaths inside the project", () => {
    expect(
      opencodeFileUrl(
        base,
        "content",
        "/home/agent/workspace/app",
        "/home/agent/workspace/app/src/a.ts",
      ),
    ).toBe(
      `${base}/file/content?path=%2Fhome%2Fagent%2Fworkspace%2Fapp%2Fsrc%2Fa.ts&directory=%2Fhome%2Fagent%2Fworkspace%2Fapp`,
    )
  })

  test("encodes spaces and odd names", () => {
    expect(
      opencodeFileUrl(
        base,
        "content",
        "/home/agent/workspace/app",
        "/home/agent/workspace/app/50% off.txt",
      ),
    ).toBe(
      `${base}/file/content?path=%2Fhome%2Fagent%2Fworkspace%2Fapp%2F50%25%20off.txt&directory=%2Fhome%2Fagent%2Fworkspace%2Fapp`,
    )
  })
})
