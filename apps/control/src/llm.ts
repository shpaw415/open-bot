import { type AiConfig, AiError, resolvePublicModel } from "@open-bot/ai"
import type { Db, UsageKind } from "@open-bot/db"
import { readUsage, type TokenUsage, teeUsage } from "./usage"

export async function handleLlm(req: Request, url: URL, ai: AiConfig, db: Db) {
  const token = (req.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  )
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 })
  const userId = db.userIdByLlmToken(token)
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 })
  const account = db.userById(userId)
  if (!account || account.disabled) {
    return Response.json({ error: "account disabled" }, { status: 403 })
  }
  db.touchDesktop(userId)
  const record = (kind: UsageKind, usage: TokenUsage | null) => {
    try {
      db.recordUsage({
        userId,
        createdAt: Date.now(),
        kind,
        promptTokens: usage?.promptTokens ?? 0,
        completionTokens: usage?.completionTokens ?? 0,
        totalTokens:
          usage?.totalTokens ??
          (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0),
      })
    } catch {
      // the ledger must not fail the proxy
    }
  }

  if (req.method === "GET" && url.pathname === "/llm/v1/models") {
    return Response.json({
      object: "list",
      data: (["chat", "small", "embed", "vlm"] as const).map((id) => ({
        id,
        object: "model",
        owned_by: "open-bot",
      })),
    })
  }

  if (req.method !== "POST")
    return Response.json({ error: "not found" }, { status: 404 })
  const body = (await req.json()) as Record<string, unknown>
  const which = resolvePublicModel(
    typeof body.model === "string" ? body.model : undefined,
    ai,
  )

  try {
    if (url.pathname === "/llm/v1/embeddings") {
      const embed = await ai.api.embed({
        model: ai.models.embed,
        input: body.input as string | string[],
      })
      record("embed", {
        promptTokens: embed.usage?.promptTokens ?? 0,
        completionTokens: 0,
        totalTokens: embed.usage?.promptTokens ?? 0,
      })
      return Response.json({
        object: "list",
        model: "embed",
        data: embed.vectors.map((embedding, index) => ({
          object: "embedding",
          index,
          embedding,
        })),
        usage: {
          prompt_tokens: embed.usage?.promptTokens ?? 0,
          total_tokens: embed.usage?.promptTokens ?? 0,
        },
      })
    }
    if (url.pathname !== "/llm/v1/chat/completions") {
      return Response.json({ error: "not found" }, { status: 404 })
    }
    const selected =
      which === "vlm"
        ? ai.models.vlm
        : which === "small"
          ? ai.models.small
          : ai.models.chat
    const call =
      which === "vlm" && ai.api.vlm
        ? ai.api.vlm.bind(ai.api)
        : ai.api.chat.bind(ai.api)
    const result = await call({
      model: selected,
      messages: (body.messages as []) ?? [],
      stream: Boolean(body.stream),
      tools: body.tools,
      toolChoice: body.tool_choice,
      reasoningEffort:
        typeof body.reasoning_effort === "string"
          ? body.reasoning_effort
          : undefined,
    })
    if ("stream" in result) {
      const teed = teeUsage(result.stream)
      void teed.usage.then((usage) => record(which, usage))
      return new Response(teed.stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        },
      })
    }
    record(which, readUsage(result.json))
    return Response.json(result.json)
  } catch (error) {
    const status = error instanceof AiError ? error.status : 502
    const message = error instanceof Error ? error.message : "upstream failed"
    return Response.json({ error: message }, { status })
  }
}
