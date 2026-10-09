import { describe, expect, test } from "bun:test"
import {
  PROJECTS_ROOT,
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
