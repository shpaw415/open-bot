import { afterEach, describe, expect, test } from "bun:test"
import {
  clearPreviewTokens,
  mintPreviewToken,
  parsePreviewFramePath,
  parsePreviewRegistry,
  previewFrameCors,
  previewPortAllowed,
  previewRootAllowed,
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

  test("accepts plugin dev checkouts as roots", () => {
    expect(
      parsePreviewRegistry(
        "4705\n/home/agent/plugins-create/stock-pro/server\n",
      ),
    ).toEqual({
      port: 4705,
      root: "/home/agent/plugins-create/stock-pro/server",
    })
    expect(previewRootAllowed("/home/agent/plugins-create")).toBe(true)
    expect(previewRootAllowed("/home/agent/plugins-create/a/b")).toBe(true)
    expect(previewRootAllowed("/home/agent/plugins-create/../etc")).toBe(false)
    expect(previewRootAllowed("/home/agent/plugins")).toBe(false)
    expect(previewRootAllowed("/etc")).toBe(false)
    expect(
      parsePreviewRegistry("4700\n/home/agent/plugins-create/../secrets\n"),
    ).toBeNull()
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

  test("opts every script out of Rocket Loader", () => {
    const html = rewritePreviewHtml(
      '<head></head><script type="module" src="/app.js"></script>' +
        "<script>inline()</script>" +
        '<script data-cfasync="false">already()</script>',
      "/api/preview/frame/tok/",
    )
    expect(html).toContain('<script data-cfasync="false" type="module"')
    expect(html).toContain('<script data-cfasync="false">inline()</script>')
    // Existing opt-outs are left untouched (no double attribute).
    expect(html.match(/data-cfasync/g)?.length).toBe(3)
  })
})

describe("preview frame cors", () => {
  test("echoes the opaque origin with allow-credentials", () => {
    const req = new Request("https://open-bot.test/api/preview/frame/tok/", {
      headers: { origin: "null" },
    })
    const res = previewFrameCors(
      req,
      new Response("ok", { status: 200, headers: { "x-keep": "1" } }),
    )
    expect(res.headers.get("access-control-allow-origin")).toBe("null")
    expect(res.headers.get("access-control-allow-credentials")).toBe("true")
    expect(res.headers.get("access-control-allow-methods")).toContain("GET")
    expect(res.headers.get("vary")).toContain("Origin")
    expect(res.headers.get("x-keep")).toBe("1")
  })

  test("falls back to the literal null origin without an Origin header", () => {
    const res = previewFrameCors(
      new Request("https://open-bot.test/api/preview/frame/tok/"),
      new Response("expired", { status: 401 }),
    )
    expect(res.status).toBe(401)
    expect(res.headers.get("access-control-allow-origin")).toBe("null")
    expect(res.headers.get("access-control-allow-credentials")).toBe("true")
  })

  test("echoes requested preflight headers", () => {
    const req = new Request("https://open-bot.test/api/preview/frame/tok/", {
      headers: {
        origin: "null",
        "access-control-request-headers": "content-type",
      },
    })
    const res = previewFrameCors(req, new Response(null, { status: 204 }))
    expect(res.headers.get("access-control-allow-headers")).toBe("content-type")
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
