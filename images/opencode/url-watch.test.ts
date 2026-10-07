import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { normalizePageUrl, saveUrl } from "./url-watch"

describe("page url restore", () => {
  test("keeps the first real page", () => {
    expect(
      normalizePageUrl([
        { type: "iframe", url: "https://evil.example" },
        { type: "page", url: "about:blank" },
        { type: "page", url: "https://facebook.com/" },
      ]),
    ).toBe("https://facebook.com/")
  })

  test("skips junk targets", () => {
    expect(normalizePageUrl(null)).toBeNull()
    expect(normalizePageUrl([])).toBeNull()
    expect(
      normalizePageUrl([
        { type: "page" },
        { type: "page", url: "chrome://newtab" },
      ]),
    ).toBeNull()
    expect(normalizePageUrl([{ type: "page", url: "https://x.invalid" }])).toBe(
      "https://x.invalid",
    )
  })

  test("caps a monstrous url", () => {
    const huge = `https://x.invalid/${"a".repeat(3000)}`
    expect(normalizePageUrl([{ type: "page", url: huge }])).toBeNull()
  })

  test("save is atomic and leaves no tmp behind", () => {
    const dir = mkdtempSync(join(tmpdir(), "ob-url-"))
    const file = join(dir, "ses_a.url")
    saveUrl(file, "https://facebook.com/")
    expect(readFileSync(file, "utf8")).toBe("https://facebook.com/")
    saveUrl(file, "https://example.com/")
    expect(readFileSync(file, "utf8")).toBe("https://example.com/")
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })
})
