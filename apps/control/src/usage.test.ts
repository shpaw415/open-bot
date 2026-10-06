import { describe, expect, test } from "bun:test"
import { accountActionError } from "./admin"
import { parseSseUsage, readUsage, teeUsage } from "./usage"

describe("usage parser", () => {
  test("reads the last SSE usage chunk", () => {
    const text = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      "",
      'data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}',
      "data: [DONE]",
    ].join("\n")
    expect(parseSseUsage(text)).toEqual({
      promptTokens: 8,
      completionTokens: 2,
      totalTokens: 10,
    })
    expect(readUsage({ usage: { prompt_tokens: 4 } })).toEqual({
      promptTokens: 4,
      completionTokens: 0,
      totalTokens: 4,
    })
    expect(readUsage({ id: "x" })).toBeNull()
  })

  test("tees a stream and still resolves usage if cancelled", async () => {
    const encoded = new TextEncoder().encode(
      'data: {"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
    )
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded)
        controller.close()
      },
    })
    const teed = teeUsage(source)
    const text = await new Response(teed.stream).text()
    expect(text).toContain("prompt_tokens")
    expect(await teed.usage).toEqual({
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    })
  })
})

describe("account actions", () => {
  test("protects the last admin and self-delete", () => {
    const admin = { id: "a", role: "admin" as const, disabled: false }
    expect(accountActionError("a", admin, "delete", 1)).toBe(
      "cannot delete yourself",
    )
    expect(accountActionError("a", admin, "disable", 2)).toBe(
      "cannot disable yourself",
    )
    expect(accountActionError("a", admin, "demote", 1)).toBe(
      "cannot remove the last admin",
    )
    expect(
      accountActionError(
        "a",
        { id: "b", role: "user", disabled: false },
        "delete",
        1,
      ),
    ).toBeNull()
  })
})
