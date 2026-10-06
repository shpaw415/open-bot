import { defineAi } from "../packages/ai/src/index.ts"

export default defineAi({
  models: {
    chat: {
      id: process.env.AI_CHAT_MODEL ?? "",
      name: "Chat",
      context: Number(process.env.AI_CHAT_CONTEXT ?? 128000),
      output: Number(process.env.AI_CHAT_OUTPUT ?? 32768),
    },
    small: {
      id: process.env.AI_SMALL_MODEL ?? process.env.AI_CHAT_MODEL ?? "",
      name: "Small",
      context: Number(process.env.AI_CHAT_CONTEXT ?? 128000),
      output: Number(process.env.AI_SMALL_OUTPUT ?? 8192),
    },
    embed: {
      id: process.env.AI_EMBED_MODEL ?? "",
      name: "Embed",
      dimension: Number(process.env.AI_EMBED_DIMENSION ?? 1536),
    },
    vlm: {
      id: process.env.AI_VLM_MODEL ?? process.env.AI_CHAT_MODEL ?? "",
      name: "VLM",
      context: Number(process.env.AI_CHAT_CONTEXT ?? 128000),
      output: Number(process.env.AI_CHAT_OUTPUT ?? 32768),
    },
  },
  api: {
    type: "openai-compatible",
    baseURL: process.env.AI_BASE_URL ?? "",
    apiKey: process.env.AI_API_KEY ?? "",
    headers: {},
  },
})
