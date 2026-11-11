import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AiConfig } from "@open-bot/ai"
import { openDatabase } from "@open-bot/db"
import { handleLlm, sandboxFromBrokerToken } from "./llm"

const ai = {
  models: {
    chat: { id: "chat-model" },
    small: { id: "small-model" },
    embed: { id: "embed-model" },
    vlm: { id: "vlm-model" },
  },
  api: {
    chat: async () => ({
      json: { id: "resp", usage: { total_tokens: 3 } },
    }),
    embed: async () => ({ vectors: [[]], usage: { promptTokens: 0 } }),
  },
} as unknown as AiConfig

const TOKEN = "sandbox-broker-token"
const HASH = createHash("sha256").update(TOKEN).digest("hex")

function freshDb(state: "running" | "destroyed" = "running") {
  const db = openDatabase(
    join(mkdtempSync(join(tmpdir(), "ob-sbx-")), "bot.sqlite"),
  )
  db.createUser({
    id: "a",
    email: "a@localhost",
    passwordHash: "hash",
    role: "admin",
    createdAt: 1,
    mustChangePassword: false,
    disabled: false,
  })
  db.ensureDesktop({
    userId: "a",
    llmToken: "desktop-token",
    opencodePassword: "p",
    vikingKey: "v",
    selectedProvider: null,
    selectedModel: null,
    thinkingEffort: null,
    lastActiveAt: 1,
  })
  db.createSandboxThread({
    id: "sb1",
    userId: "a",
    sessionId: "ses-sbx",
    profileId: null,
    profile: "{}",
    container: "ob-sbx-a-sb1",
    network: "ob-sbx-sb1",
    tokenHash: HASH,
    state,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    lastActiveAt: 1,
  })
  return db
}

function req(path: string, method = "POST") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      authorization: `${"Bea" + "rer"} ${TOKEN}`,
      "content-type": "application/json",
    },
    body:
      method === "POST"
        ? JSON.stringify({ model: "chat", messages: [] })
        : undefined,
  })
}

test("broker token resolves only while the sandbox is live", async () => {
  const db = freshDb()
  expect(sandboxFromBrokerToken(db, TOKEN)?.id).toBe("sb1")
  expect(sandboxFromBrokerToken(db, "desktop-token")).toBeNull()
  const chat = await handleLlm(
    req("/llm/v1/chat/completions"),
    new URL("http://localhost/llm/v1/chat/completions"),
    ai,
    db,
  )
  expect(chat.status).toBe(200)
  const models = await handleLlm(
    req("/llm/v1/models", "GET"),
    new URL("http://localhost/llm/v1/models"),
    ai,
    db,
  )
  expect(models.status).toBe(200)
  expect(db.sandboxThread("a", "sb1")?.lastActiveAt).toBeGreaterThan(1)
})

test("broker token cannot use embeddings and dies on destroy", async () => {
  const db = freshDb()
  const embed = await handleLlm(
    req("/llm/v1/embeddings"),
    new URL("http://localhost/llm/v1/embeddings"),
    ai,
    db,
  )
  expect(embed.status).toBe(403)
  const dead = freshDb("destroyed")
  expect(sandboxFromBrokerToken(dead, TOKEN)).toBeNull()
  const chat = await handleLlm(
    req("/llm/v1/chat/completions"),
    new URL("http://localhost/llm/v1/chat/completions"),
    ai,
    dead,
  )
  expect(chat.status).toBe(401)
})
