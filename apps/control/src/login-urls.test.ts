import { describe, expect, test } from "bun:test"
import {
  createLoginUrlScanner,
  extractUrls,
  isLocalUrl,
  parseLocalCallbackUrl,
  stripAnsi,
} from "./login-urls"

describe("login urls", () => {
  test("strips ANSI control sequences but keeps newlines", () => {
    expect(stripAnsi("\x1b[1;32mhttps://a.dev\x1b[0m")).toBe("https://a.dev")
    expect(stripAnsi("\x1b]0;title\x07https://a.dev")).toBe("https://a.dev")
    expect(stripAnsi("\x1b(Bhttps://a.dev")).toBe("https://a.dev")
    expect(stripAnsi("a\r\nb")).toBe("a\nb")
  })

  test("extracts urls and trims trailing punctuation", () => {
    expect(
      extractUrls("open https://auth.openai.com/oauth/authorize?x=1 now"),
    ).toEqual(["https://auth.openai.com/oauth/authorize?x=1"])
    expect(extractUrls("see https://opencode.ai/docs.")).toEqual([
      "https://opencode.ai/docs",
    ])
    expect(extractUrls("wrapped (https://a.dev/x)")).toEqual([
      "https://a.dev/x",
    ])
    expect(extractUrls("balanced https://a.dev/x(y) stays")).toEqual([
      "https://a.dev/x(y)",
    ])
    expect(extractUrls("no url here")).toEqual([])
  })

  test("scanner reassembles urls split across chunks and dedupes", () => {
    const scanner = createLoginUrlScanner()
    expect(scanner.push("go to https://auth.exa")).toEqual([])
    expect(scanner.push("mple.com/oauth/authorize?x=1 ok")).toEqual([
      "https://auth.example.com/oauth/authorize?x=1",
    ])
    expect(
      scanner.push("repeat https://auth.example.com/oauth/authorize?x=1"),
    ).toEqual([])
    expect(scanner.urls()).toEqual([
      "https://auth.example.com/oauth/authorize?x=1",
    ])
  })

  test("scanner survives multi-byte chars split across chunks", () => {
    const scanner = createLoginUrlScanner()
    const text = "é https://a.dev/x é"
    const bytes = new TextEncoder().encode(text)
    scanner.push(bytes.slice(0, 2))
    expect(scanner.push(bytes.slice(2))).toContain("https://a.dev/x")
  })

  test("flush emits a url sitting at the buffer edge", () => {
    const scanner = createLoginUrlScanner()
    expect(
      scanner.push("open https://auth.openai.com/oauth/authorize?x=1"),
    ).toEqual([])
    expect(scanner.flush()).toEqual([
      "https://auth.openai.com/oauth/authorize?x=1",
    ])
    expect(scanner.flush()).toEqual([])
  })

  test("isLocalUrl flags the redirect targets we should not open", () => {
    expect(isLocalUrl("http://localhost:1455/auth/callback")).toBe(true)
    expect(isLocalUrl("http://127.0.0.1:19876/mcp/oauth/callback")).toBe(true)
    expect(isLocalUrl("https://auth.openai.com/oauth/authorize")).toBe(false)
    expect(isLocalUrl("not a url")).toBe(false)
  })

  test("parseLocalCallbackUrl accepts and normalizes loopback callbacks", () => {
    const ok = parseLocalCallbackUrl(
      "http://localhost:1455/auth/callback?code=abc&state=xyz#frag",
    )
    expect(ok).toEqual({
      ok: true,
      url: "http://127.0.0.1:1455/auth/callback?code=abc&state=xyz",
    })
    expect(
      parseLocalCallbackUrl("http://127.0.0.1:19876/mcp/oauth/callback?code=1"),
    ).toEqual({
      ok: true,
      url: "http://127.0.0.1:19876/mcp/oauth/callback?code=1",
    })
  })

  test("parseLocalCallbackUrl rejects everything else", () => {
    for (const bad of [
      undefined,
      "",
      "   ",
      "not a url",
      "https://auth.openai.com/cb?code=1",
      "http://localhost/auth/callback?code=1",
      "http://localhost:1455/auth/callback",
      "x".repeat(2100),
    ]) {
      expect(parseLocalCallbackUrl(bad).ok).toBe(false)
    }
    expect(
      parseLocalCallbackUrl("http://localhost:1455/cb?error=access_denied").ok,
    ).toBe(true)
  })
})
