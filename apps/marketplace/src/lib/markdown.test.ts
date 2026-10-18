import { describe, expect, test } from "bun:test"
import { parseBlocks, safeUrl, tokenizeInline } from "./markdown"

describe("safeUrl", () => {
  test("allows https, relative, anchor, and root-relative urls", () => {
    expect(safeUrl("https://example.com/a")).toBe("https://example.com/a")
    expect(safeUrl("http://example.com")).toBe("http://example.com")
    expect(safeUrl("/plugins/foo")).toBe("/plugins/foo")
    expect(safeUrl("#section")).toBe("#section")
    expect(safeUrl("./docs")).toBe("./docs")
    expect(safeUrl("../up")).toBe("../up")
  })

  test("rejects javascript:, data:, vbscript:, and unknown schemes", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull()
    expect(safeUrl("JAVASCRIPT:x")).toBeNull()
    expect(safeUrl("data:text/html;base64,AAAA")).toBeNull()
    expect(safeUrl("vbscript:msgbox")).toBeNull()
    expect(safeUrl("file:///etc/passwd")).toBeNull()
    expect(safeUrl("ftp://host/x")).toBeNull()
    expect(safeUrl("")).toBeNull()
  })
})

describe("tokenizeInline", () => {
  test("parses code, bold, italic, and links", () => {
    const tokens = tokenizeInline("a `x` **b** *c* [t](https://e.com) end")
    expect(tokens.map((token) => token.kind)).toEqual([
      "text",
      "code",
      "text",
      "strong",
      "text",
      "em",
      "text",
      "link",
      "text",
    ])
  })

  test("renders unsafe link targets as plain label text", () => {
    const tokens = tokenizeInline("[click](javascript:alert(1))")
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.kind).toBe("text")
    expect((tokens[0] as { text: string }).text).toBe("click")
  })

  test("autolinks bare https urls only", () => {
    const tokens = tokenizeInline("see https://example.com/x now")
    const link = tokens.find((token) => token.kind === "link")
    expect(link).toEqual({
      kind: "link",
      text: "https://example.com/x",
      url: "https://example.com/x",
    })
  })

  test("keeps formatting inside code spans literal", () => {
    const tokens = tokenizeInline("`**not bold**`")
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.kind).toBe("code")
  })
})

describe("parseBlocks", () => {
  test("parses headings, paragraphs, lists, quote, code, and hr", () => {
    const blocks = parseBlocks(
      [
        "# Title",
        "",
        "Para one",
        "wrapped line",
        "",
        "- a",
        "- b",
        "",
        "1. one",
        "2. two",
        "",
        "> quoted",
        "",
        "```sh",
        "ob-plugin install x",
        "```",
        "",
        "---",
      ].join("\n"),
    )
    expect(blocks).toEqual([
      { kind: "h", level: 1, text: "Title" },
      { kind: "p", lines: ["Para one", "wrapped line"] },
      { kind: "ul", items: ["a", "b"] },
      { kind: "ol", items: ["one", "two"] },
      { kind: "quote", lines: ["quoted"] },
      { kind: "code", text: "ob-plugin install x", lang: "sh" },
      { kind: "hr" },
    ])
  })

  test("image syntax degrades to a plain paragraph (no remote loads)", () => {
    const blocks = parseBlocks("![logo](https://example.com/logo.png)")
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.kind).toBe("p")
  })

  test("raw HTML lines stay inert text inside paragraphs", () => {
    const blocks = parseBlocks("<script>alert(1)</script> plain")
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.kind).toBe("p")
  })

  test("handles CRLF and empty input", () => {
    expect(parseBlocks("a\r\nb")).toEqual([{ kind: "p", lines: ["a", "b"] }])
    expect(parseBlocks("")).toEqual([])
  })
})
