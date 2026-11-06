import { describe, expect, test } from "bun:test"
import type { VikingProvider } from "@open-bot/db"
import { resolveVikingEmbedding } from "./viking-embedding-catalog"
import {
  codexBootstrapFromOpencodeAuth,
  resolveVikingVlm,
  supportedVlmProviderIds,
} from "./viking-models"

const base: VikingProvider = {
  baseURL: "https://example.test/v1",
  apiKey: "embed-key",
  embedProvider: "custom-openai-compatible",
  embedAccountId: "",
  embedModel: "embed",
  embedDimension: 1536,
  vlmModel: "custom-vlm",
  vlmSource: "custom",
  vlmProvider: "",
}

const noVault = () => ""
const vault = (slug: string) => (slug === "xai" ? "vault-xai-key" : "")

describe("resolveVikingVlm", () => {
  test("custom source passes the stored endpoint through", () => {
    expect(resolveVikingVlm(base, null, noVault)).toEqual({
      vlm: {
        backend: "openai",
        model: "custom-vlm",
        apiKey: "embed-key",
        apiBase: "https://example.test/v1",
      },
    })
  })

  test("custom OpenAI source with no override falls back to the public endpoint", () => {
    expect(
      resolveVikingVlm(
        {
          ...base,
          baseURL: "",
          embedProvider: "openai",
          vlmModel: "gpt-4o",
        },
        null,
        noVault,
      ),
    ).toEqual({
      vlm: {
        backend: "openai",
        model: "gpt-4o",
        apiKey: "embed-key",
        apiBase: "https://api.openai.com/v1",
      },
    })
  })

  test("openai OAuth resolves to the codex backend without a key", () => {
    const out = resolveVikingVlm(
      {
        ...base,
        vlmSource: "opencode",
        vlmProvider: "openai",
        vlmModel: "gpt-5-codex",
      },
      { openai: { type: "oauth", access: "a", refresh: "r" } },
      noVault,
    )
    expect(out).toEqual({
      vlm: { backend: "openai-codex", model: "gpt-5-codex" },
    })
  })

  test("openai API entry and vault fallback use the OpenAI API", () => {
    const picked = {
      ...base,
      vlmSource: "opencode" as const,
      vlmProvider: "openai",
      vlmModel: "gpt-4o",
    }
    expect(
      resolveVikingVlm(
        picked,
        { openai: { type: "api", key: "sk-live" } },
        noVault,
      ),
    ).toEqual({
      vlm: {
        backend: "openai",
        model: "gpt-4o",
        apiKey: "sk-live",
        apiBase: "https://api.openai.com/v1",
      },
    })
    const fromVault = resolveVikingVlm(picked, null, (slug) =>
      slug === "openai" ? "sk-vault" : "",
    )
    expect(fromVault).toEqual({
      vlm: {
        backend: "openai",
        model: "gpt-4o",
        apiKey: "sk-vault",
        apiBase: "https://api.openai.com/v1",
      },
    })
  })

  test("xai OAuth access token feeds litellm; vault key is the fallback", () => {
    const picked = {
      ...base,
      vlmSource: "opencode" as const,
      vlmProvider: "xai",
      vlmModel: "grok-4.5",
    }
    expect(
      resolveVikingVlm(
        picked,
        { xai: { type: "oauth", access: "oauth-access", refresh: "r" } },
        noVault,
      ),
    ).toEqual({
      vlm: {
        backend: "litellm",
        model: "xai/grok-4.5",
        apiKey: "oauth-access",
      },
    })
    expect(resolveVikingVlm(picked, null, vault)).toEqual({
      vlm: {
        backend: "litellm",
        model: "xai/grok-4.5",
        apiKey: "vault-xai-key",
      },
    })
  })

  test("zai coding plan uses the glm backend with its stored key", () => {
    expect(
      resolveVikingVlm(
        {
          ...base,
          vlmSource: "opencode",
          vlmProvider: "zai-coding-plan",
          vlmModel: "glm-4.6v",
        },
        { "zai-coding-plan": { type: "api", key: "zai-key" } },
        noVault,
      ),
    ).toEqual({
      vlm: { backend: "glm", model: "glm-4.6v", apiKey: "zai-key" },
    })
  })

  test("unsupported providers and subscription OAuth fail with named errors", () => {
    const cli = resolveVikingVlm(
      {
        ...base,
        vlmSource: "opencode",
        vlmProvider: "claude-code",
        vlmModel: "opus",
      },
      null,
      noVault,
    )
    expect(cli).toEqual({
      error: expect.stringContaining("cannot use the OpenCode provider"),
    })
    const anthropicOauth = resolveVikingVlm(
      {
        ...base,
        vlmSource: "opencode",
        vlmProvider: "anthropic",
        vlmModel: "claude-sonnet",
      },
      { anthropic: { type: "oauth", access: "a", refresh: "r" } },
      noVault,
    )
    expect(anthropicOauth).toEqual({
      error: expect.stringContaining("not an API credential"),
    })
    const missing = resolveVikingVlm(
      {
        ...base,
        vlmSource: "opencode",
        vlmProvider: "groq",
        vlmModel: "llama",
      },
      null,
      noVault,
    )
    expect(missing).toEqual({
      error: expect.stringContaining("no credential found"),
    })
    expect(supportedVlmProviderIds()).toContain("zai-coding-plan")
    expect(supportedVlmProviderIds()).not.toContain("claude-code")
  })
})

describe("codexBootstrapFromOpencodeAuth", () => {
  test("converts the openai OAuth entry into the Codex auth file shape", () => {
    const out = codexBootstrapFromOpencodeAuth({
      openai: {
        type: "oauth",
        access: "access-1",
        refresh: "refresh-1",
        accountId: "acct-1",
      },
    })
    expect(out && JSON.parse(out)).toEqual({
      auth_mode: "chatgpt",
      tokens: {
        access_token: "access-1",
        refresh_token: "refresh-1",
        account_id: "acct-1",
      },
    })
  })

  test("returns null without an OAuth entry", () => {
    expect(codexBootstrapFromOpencodeAuth(null)).toBeNull()
    expect(
      codexBootstrapFromOpencodeAuth({ openai: { type: "api", key: "sk" } }),
    ).toBeNull()
    expect(
      codexBootstrapFromOpencodeAuth({
        openai: { type: "oauth", access: "", refresh: "r" },
      }),
    ).toBeNull()
  })
})

describe("resolveVikingEmbedding", () => {
  test("Cloudflare derives the Workers AI endpoint from the account id", () => {
    expect(
      resolveVikingEmbedding({
        ...base,
        baseURL: "",
        apiKey: "cf-token",
        embedProvider: "cloudflare-workers-ai",
        embedAccountId: "acct-123",
        embedModel: "@cf/baai/bge-base-en-v1.5",
        embedDimension: 768,
      }),
    ).toEqual({
      provider: "openai",
      model: "@cf/baai/bge-base-en-v1.5",
      apiKey: "cf-token",
      apiBase: "https://api.cloudflare.com/client/v4/accounts/acct-123/ai/v1",
      dimension: 768,
    })
  })

  test("native providers map to their OpenViking runtime names", () => {
    expect(
      resolveVikingEmbedding({
        ...base,
        baseURL: "https://api.voyageai.com/v1",
        apiKey: "voyage-key",
        embedProvider: "voyage",
        embedModel: "voyage-4-lite",
        embedDimension: 1024,
      }),
    ).toEqual({
      provider: "voyage",
      model: "voyage-4-lite",
      apiKey: "voyage-key",
      apiBase: "https://api.voyageai.com/v1",
      dimension: 1024,
    })
  })

  test("an empty native base falls back to the provider's default endpoint", () => {
    const out = resolveVikingEmbedding({
      ...base,
      baseURL: "",
      apiKey: "cohere-key",
      embedProvider: "cohere",
      embedModel: "embed-english-v3.0",
      embedDimension: 1024,
    })
    expect(out).toEqual({
      provider: "cohere",
      model: "embed-english-v3.0",
      apiKey: "cohere-key",
      apiBase: "https://api.cohere.com",
      dimension: 1024,
    })
  })

  test("custom OpenAI-compatible and local pass through untouched", () => {
    expect(
      resolveVikingEmbedding({
        ...base,
        embedProvider: "custom-openai-compatible",
      }),
    ).toEqual({
      provider: "openai",
      model: "embed",
      apiKey: "embed-key",
      apiBase: "https://example.test/v1",
      dimension: 1536,
    })
    expect(
      resolveVikingEmbedding({
        ...base,
        embedProvider: "local",
        embedModel: "bge-small-zh-v1.5-f16",
        embedDimension: 512,
      }),
    ).toEqual({
      provider: "local",
      model: "bge-small-zh-v1.5-f16",
      apiKey: "",
      apiBase: "",
      dimension: 512,
    })
  })

  test("a native embedding provider cannot double as the custom VLM endpoint", () => {
    expect(
      resolveVikingVlm(
        {
          ...base,
          embedProvider: "voyage",
          vlmSource: "custom",
          vlmModel: "some-vlm",
        },
        null,
        noVault,
      ),
    ).toEqual({
      error: expect.stringContaining(
        "cannot use the Voyage AI embedding endpoint",
      ),
    })
  })
})
