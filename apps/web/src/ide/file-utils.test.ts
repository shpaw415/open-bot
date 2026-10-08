import { describe, expect, test } from "bun:test"
import {
  baseName,
  decodeContent,
  dirName,
  fuzzyFilterFiles,
  iconForFile,
  isImageFile,
  joinName,
  languageFor,
  parseEntries,
  pathSegments,
  relPath,
} from "./file-utils"

const ROOT = "/home/agent/workspace/my-app"

describe("path helpers", () => {
  test("base, dir, join, rel, segments", () => {
    expect(baseName(`${ROOT}/src/app.ts`)).toBe("app.ts")
    expect(dirName(`${ROOT}/src/app.ts`)).toBe(`${ROOT}/src`)
    expect(joinName(ROOT, "src")).toBe(`${ROOT}/src`)
    expect(relPath(ROOT, `${ROOT}/src/app.ts`)).toBe("src/app.ts")
    expect(relPath(ROOT, `${ROOT}`)).toBe("")
    expect(pathSegments(`${ROOT}/src/app.ts`)).toEqual([
      "home",
      "agent",
      "workspace",
      "my-app",
      "src",
      "app.ts",
    ])
  })
})

describe("parse entries", () => {
  test("folders first, case-insensitive names", () => {
    const entries = parseEntries(
      [
        { name: "zeta.txt", path: `${ROOT}/zeta.txt`, type: "file" },
        { name: "Beta", path: `${ROOT}/Beta`, type: "directory" },
        { name: "alpha.ts", path: `${ROOT}/alpha.ts`, type: "file" },
        { name: "apple", path: `${ROOT}/apple`, type: "directory" },
        null,
        "junk",
        { name: ".", path: `${ROOT}/.`, type: "directory" },
      ],
      ROOT,
    )
    expect(entries.map((entry) => entry.name)).toEqual([
      "apple",
      "Beta",
      "alpha.ts",
      "zeta.txt",
    ])
    expect(entries[0]?.isDir).toBe(true)
    expect(entries[2]?.isDir).toBe(false)
  })

  test("fills name from path and rejects junk shapes", () => {
    const entries = parseEntries(
      [{ path: `${ROOT}/only-path.md` }, {}, { type: "directory" }],
      ROOT,
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({
      name: "only-path.md",
      path: `${ROOT}/only-path.md`,
      isDir: false,
    })
    expect(parseEntries("nope", ROOT)).toEqual([])
  })
})

describe("language and icons", () => {
  test("maps extensions to monaco languages", () => {
    expect(languageFor("a/b.ts")).toBe("typescript")
    expect(languageFor("c.tsx")).toBe("typescript")
    expect(languageFor("d.jsx")).toBe("javascript")
    expect(languageFor("e.md")).toBe("markdown")
    expect(languageFor("f.yaml")).toBe("yaml")
    expect(languageFor("Dockerfile")).toBe("dockerfile")
    expect(languageFor(".gitignore")).toBe("ini")
    expect(languageFor("unknown.weird")).toBe("plaintext")
    expect(languageFor("noext")).toBe("plaintext")
  })

  test("picks colored icon tokens", () => {
    expect(iconForFile("App.tsx")).toBe("react")
    expect(iconForFile("server.py")).toBe("python")
    expect(iconForFile("package.json")).toBe("json")
    expect(iconForFile("logo.png")).toBe("image")
    expect(iconForFile(".gitignore")).toBe("git")
    expect(iconForFile("bun.lockb")).toBe("lock")
    expect(iconForFile("Dockerfile")).toBe("config")
    expect(iconForFile("mystery.xyz")).toBe("file")
  })

  test("detects images", () => {
    expect(isImageFile("x.PNG")).toBe(true)
    expect(isImageFile("x.svg")).toBe(true)
    expect(isImageFile("x.txt")).toBe(false)
  })
})

describe("decode content", () => {
  test("text payload", () => {
    expect(decodeContent("a.ts", { type: "text", content: "hi" })).toEqual({
      kind: "text",
      text: "hi",
    })
    expect(decodeContent("a.ts", { content: "hi" })).toEqual({
      kind: "text",
      text: "hi",
    })
  })

  test("png binary payload becomes a data url", () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const body = {
      type: "binary",
      encoding: "base64",
      content: btoa(binary),
    }
    const decoded = decodeContent("x.png", body)
    expect(decoded?.kind).toBe("image")
    if (decoded?.kind === "image") {
      expect(decoded.mime).toBe("image/png")
      expect(decoded.src.startsWith("data:image/png;base64,")).toBe(true)
    }
  })

  test("unknown binary and junk shapes", () => {
    expect(decodeContent("x.zip", { type: "binary", encoding: "base64", content: "aGVsbG8=" })).toEqual(
      { kind: "binary" },
    )
    expect(decodeContent("x", null)).toBeNull()
    expect(decodeContent("x", {})).toBeNull()
  })

  test("svg text renders as image", () => {
    const decoded = decodeContent("x.svg", { content: "<svg/>" })
    expect(decoded?.kind).toBe("image")
  })
})

describe("fuzzy filter files", () => {
  const files = [
    `${ROOT}/src/app.ts`,
    `${ROOT}/src/components/Chat.tsx`,
    `${ROOT}/README.md`,
    `${ROOT}/package.json`,
  ]

  test("empty query takes the first files", () => {
    expect(fuzzyFilterFiles(files, ROOT, "")).toHaveLength(4)
    expect(fuzzyFilterFiles(files, ROOT, "", 2)).toHaveLength(2)
  })

  test("basename matches rank above path matches", () => {
    const [first] = fuzzyFilterFiles(files, ROOT, "app")
    expect(first).toBe(`${ROOT}/src/app.ts`)
  })

  test("subsequence matches still surface", () => {
    const results = fuzzyFilterFiles(files, ROOT, "rdme")
    expect(results).toContain(`${ROOT}/README.md`)
  })

  test("no match gives nothing", () => {
    expect(fuzzyFilterFiles(files, ROOT, "zzzz")).toEqual([])
  })
})
