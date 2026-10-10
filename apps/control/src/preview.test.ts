import { afterEach, describe, expect, test } from "bun:test"
import {
  clearPreviewTokens,
  mintPreviewToken,
  parsePreviewFramePath,
  parsePreviewRegistry,
  previewPortAllowed,
  rewritePreviewCss,
  rewritePreviewHtml,
  touchPreviewToken,
} from "./preview"

afterEach(() => {
  clearPreviewTokens()
})

describe("preview registry", () => {
  test("accepts an allowlisted port under the workspace", () => {
    expect(
      parsePreviewRegistry("4703\n/home/agent/workspace/site\n99\ndir\n"),
    ).toEqual({ port: 4703, root: "/home/agent/workspace/site" })
    expect(
      parsePreviewRegistry("4096\n/home/agent/workspace/site\n"),
    ).toBeNull()
    expect(parsePreviewRegistry("4700\n/etc\n")).toBeNull()
    expect(
      parsePreviewRegistry("4700\n/home/agent/workspace/../etc\n"),
    ).toBeNull()
    expect(previewPortAllowed(4719)).toBe(true)
    expect(previewPortAllowed(4720)).toBe(false)
  })
})

describe("preview frame path", () => {
  test("keeps the token and the rest of the path", () => {
    const token = "a".repeat(43)
    expect(parsePreviewFramePath(`/api/preview/frame/${token}/`)).toEqual({
      token,
      rest: "/",
    })
    expect(parsePreviewFramePath(`/api/preview/frame/${token}/about`)).toEqual({
      token,
      rest: "/about",
    })
    expect(
      parsePreviewFramePath(`/api/preview/frame/${token}/../etc`),
    ).toBeNull()
    expect(parsePreviewFramePath("/api/preview/frame/short/")).toBeNull()
  })
})

describe("preview rewrite", () => {
  test("adds a base tag and rewrites root-absolute urls", () => {
    const html = rewritePreviewHtml(
      '<head><link href="/app.css"></head><a href="style.css">x</a><img src="//cdn.example/a.png">',
      "/api/preview/frame/tok/",
    )
    expect(html).toContain('<base href="/api/preview/frame/tok/">')
    expect(html).toContain('href="/api/preview/frame/tok/app.css"')
    expect(html).toContain('href="style.css"')
    expect(html).toContain('src="//cdn.example/a.png"')
  })

  test("rewrites css urls but not protocol-relative ones", () => {
    expect(
      rewritePreviewCss(
        "a{background:url(/img.png)}b{background:url(//cdn/x.png)}",
        "/api/preview/frame/tok/",
      ),
    ).toBe(
      "a{background:url(/api/preview/frame/tok/img.png)}b{background:url(//cdn/x.png)}",
    )
  })
})

describe("preview tokens", () => {
  test("slides the expiry and rejects an expired token", () => {
    const minted = mintPreviewToken("user", "ses_1", 1_000)
    expect(minted.token.length).toBeGreaterThanOrEqual(43)
    expect(parsePreviewFramePath(minted.frameUrl)?.token).toBe(minted.token)
    expect(minted.frameUrl).toBe(`/api/preview/frame/${minted.token}/`)
    expect(touchPreviewToken(minted.token, 1_000)?.sessionId).toBe("ses_1")
    expect(touchPreviewToken(minted.token, minted.expiresAt + 1)).toBeNull()
  })
})
