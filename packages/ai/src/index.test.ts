import { describe, expect, test } from "bun:test"
import { AiError, defineAi, resolvePublicModel } from "./index"

const models = {
  chat: { id: "chat-up", name: "Chat", context: 1000, output: 100 },
  small: { id: "small-up", name: "Small", context: 1000, output: 50 },
  embed: { id: "embed-up", name: "Embed", dimension: 8 },
  vlm: { id: "vlm-up", name: "VLM", context: 1000, output: 100 },
}

describe("defineAi", () => {
  test("rejects a missing file shape", () => {
    expect(() => defineAi({} as never)).toThrow(AiError)
  })

  test("builds an openai-compatible api and keeps custom functions", async () => {
    const compatible = defineAi({
      models,
      api: {
        type: "openai-compatible",
        baseURL: "http://example.test/v1",
        apiKey: "secret",
      },
    })
    expect(compatible.models.embed.dimension).toBe(8)
    expect(typeof compatible.api.chat).toBe("function")

    const custom = defineAi({
      models,
      api: {
        async chat() {
          return { json: { ok: true } }
        },
        async embed() {
          return { vectors: [[1]] }
        },
      },
    })
    expect(
      await custom.api.embed({ model: models.embed, input: "hi" }),
    ).toEqual({ vectors: [[1]] })
  })

  test("asks streams for usage and retries without stream_options on 400", async () => {
    const bodies: Record<string, unknown>[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as Record<string, unknown>
        bodies.push(body)
        if (bodies.length === 1)
          return new Response("rejected", { status: 400 })
        return Response.json({ id: "ok" })
      },
    })
    try {
      const ai = defineAi({
        models,
        api: {
          type: "openai-compatible",
          baseURL: `http://127.0.0.1:${server.port}/v1`,
          apiKey: "secret",
        },
      })
      const result = await ai.api.chat({
        model: models.chat,
        messages: [],
        stream: true,
      })
      if ("stream" in result) await result.stream.cancel()
      expect(bodies[0]?.stream_options).toEqual({ include_usage: true })
      expect(bodies[1]?.stream).toBe(true)
      expect(bodies[1]?.stream_options).toBeUndefined()
    } finally {
      server.stop(true)
    }
  })

  test("maps desktop model aliases", () => {
    const ai = defineAi({
      models,
      api: {
        async chat() {
          return { json: {} }
        },
        async embed() {
          return { vectors: [] }
        },
      },
    })
    expect(resolvePublicModel("default", ai)).toBe("chat")
    expect(resolvePublicModel("embed-up", ai)).toBe("embed")
    expect(resolvePublicModel("small", ai)).toBe("small")
  })
})
