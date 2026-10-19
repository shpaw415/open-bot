import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "@open-bot/db"
import {
  languageCode,
  resolveVoiceConfig,
  runStt,
  runTts,
  ttsMaxChars,
  voiceConfigError,
  voiceProviderById,
  voiceProviders,
  voiceProvidersPublic,
  voiceReady,
  voiceVaultSlug,
} from "./voice-providers"

function freshDb() {
  const db = openDatabase(
    join(mkdtempSync(join(tmpdir(), "ob-")), "bot.sqlite"),
  )
  db.createUser({
    id: "a",
    email: "a@localhost",
    passwordHash: "hash",
    role: "user",
    createdAt: 1,
    mustChangePassword: false,
    disabled: false,
  })
  db.ensureDesktop({
    userId: "a",
    llmToken: "t",
    opencodePassword: "p",
    vikingKey: "v",
    selectedProvider: null,
    selectedModel: null,
    thinkingEffort: null,
    lastActiveAt: 1,
  })
  return db
}

describe("voice providers", () => {
  test("catalog has stt and tts entries with public shapes", () => {
    expect(voiceProviders.filter((item) => item.kind === "stt").length).toBe(4)
    expect(voiceProviders.filter((item) => item.kind === "tts").length).toBe(3)
    const pub = voiceProvidersPublic()
    expect(pub[0]).not.toHaveProperty("secret.required")
    expect(pub.find((item) => item.id === "xai-tts")?.modelOptional).toBe(true)
    expect(voiceProviderById("openai-stt")?.defaultModel).toBe("whisper-1")
    expect(voiceProviderById("workers-ai-stt")?.defaultModel).toBe(
      "@cf/openai/whisper-large-v3-turbo",
    )
    expect(voiceProviderById("deepgram-stt")?.defaultModel).toBe(
      "@cf/deepgram/nova-3",
    )
  })

  test("vault slugs reuse existing keys", () => {
    expect(voiceVaultSlug("workers-ai-stt")).toBe("cloudflare")
    expect(voiceVaultSlug("deepgram-stt")).toBe("cloudflare")
    expect(voiceVaultSlug("workers-ai-tts")).toBe("cloudflare")
    expect(voiceVaultSlug("xai-tts")).toBe("xai")
    expect(voiceVaultSlug("openai-stt")).toBe("openai")
    expect(voiceVaultSlug("groq-stt")).toBe("")
  })

  test("languageCode normalizes locales and auto", () => {
    expect(languageCode("fr-CA")).toBe("fr")
    expect(languageCode("en")).toBe("en")
    expect(languageCode("auto")).toBe("")
    expect(languageCode("")).toBe("")
    expect(languageCode("zap")).toBe("")
  })

  test("voiceReady requires key, model, and account per spec", () => {
    const base = {
      sttProvider: "openai-stt",
      sttAccountId: "",
      sttApiKey: "k",
      sttModel: "whisper-1",
      ttsProvider: "xai-tts",
      ttsAccountId: "",
      ttsApiKey: "k",
      ttsModel: "",
      ttsVoice: "eve",
      language: "fr-CA",
    }
    expect(voiceReady(base, "stt")).toBe(true)
    expect(voiceReady(base, "tts")).toBe(true)
    expect(voiceReady({ ...base, sttModel: "" }, "stt")).toBe(false)
    expect(voiceReady({ ...base, ttsApiKey: "" }, "tts")).toBe(false)
    const workers = {
      ...base,
      sttProvider: "workers-ai-stt",
      sttModel: "@cf/openai/whisper",
    }
    expect(voiceReady(workers, "stt")).toBe(false)
    expect(voiceReady({ ...workers, sttAccountId: "acc" }, "stt")).toBe(true)
  })

  test("resolveVoiceConfig falls back to the vault and reports sources", () => {
    const db = freshDb()
    db.setUserKey("a", "cloudflare", {
      apiKey: "cf-token",
      accountId: "cf-account",
      gatewayId: "",
      gatewayToken: "",
      gatewaySlug: "",
      baseUrl: "",
    })
    db.setVoiceConfig("a", {
      sttProvider: "workers-ai-stt",
      sttAccountId: "",
      sttApiKey: "",
      sttModel: "@cf/openai/whisper",
      ttsProvider: "xai-tts",
      ttsAccountId: "",
      ttsApiKey: "typed-xai",
      ttsModel: "",
      ttsVoice: "",
      language: "fr-CA",
    })
    const resolved = resolveVoiceConfig(db, "a")
    expect(resolved.value.sttApiKey).toBe("cf-token")
    expect(resolved.value.sttAccountId).toBe("cf-account")
    expect(resolved.sttSource).toBe("vault")
    expect(resolved.value.ttsApiKey).toBe("typed-xai")
    expect(resolved.ttsSource).toBe("setup")
  })

  test("runStt posts a byte array plus language and vad to workers ai", async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const text = await runStt({
      providerId: "workers-ai-stt",
      apiKey: "tok",
      accountId: "acc",
      model: "@cf/openai/whisper-large-v3-turbo",
      language: "fr-CA",
      audio: new Uint8Array([1, 2, 3]),
      mime: "audio/webm",
      fetchImpl: async (url, init) => {
        seen = { url: String(url), init: init ?? {} }
        return new Response(JSON.stringify({ result: { text: "bonjour" } }), {
          status: 200,
        })
      },
    })
    expect(text).toBe("bonjour")
    const call = seen as unknown as { url: string; init: RequestInit } | null
    expect(decodeURIComponent(call?.url ?? "")).toContain(
      "api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/openai/whisper-large-v3-turbo",
    )
    const body = JSON.parse(String(call?.init.body)) as {
      audio: number[]
      language?: string
      vad_filter?: boolean
    }
    expect(body.audio).toEqual([1, 2, 3])
    expect(body.language).toBe("fr")
    expect(body.vad_filter).toBe(true)
  })

  test("runStt remaps the legacy whisper model to turbo", async () => {
    let seen: { url: string; init: RequestInit } | null = null
    await runStt({
      providerId: "workers-ai-stt",
      apiKey: "tok",
      accountId: "acc",
      model: "@cf/openai/whisper",
      language: "fr",
      audio: new Uint8Array([1]),
      mime: "audio/webm",
      fetchImpl: async (url, init) => {
        seen = { url: String(url), init: init ?? {} }
        return new Response(JSON.stringify({ result: { text: "salut" } }), {
          status: 200,
        })
      },
    })
    const call = seen as unknown as { url: string; init: RequestInit } | null
    const url = decodeURIComponent(call?.url ?? "")
    expect(url).toContain("/ai/run/@cf/openai/whisper-large-v3-turbo")
    expect(url).not.toMatch(/\/ai\/run\/@cf\/openai\/whisper$/)
    const body = JSON.parse(String(call?.init.body)) as {
      language?: string
      vad_filter?: boolean
    }
    expect(body.language).toBe("fr")
    expect(body.vad_filter).toBe(true)
  })

  test("runStt omits the language hint on auto but keeps vad", async () => {
    let seen: { url: string; init: RequestInit } | null = null
    await runStt({
      providerId: "workers-ai-stt",
      apiKey: "tok",
      accountId: "acc",
      model: "@cf/openai/whisper-large-v3-turbo",
      language: "auto",
      audio: new Uint8Array([1]),
      mime: "audio/webm",
      fetchImpl: async (url, init) => {
        seen = { url: String(url), init: init ?? {} }
        return new Response(JSON.stringify({ result: { text: "hi" } }), {
          status: 200,
        })
      },
    })
    const call = seen as unknown as { url: string; init: RequestInit } | null
    const body = JSON.parse(String(call?.init.body)) as {
      language?: string
      vad_filter?: boolean
    }
    expect(body.language).toBeUndefined()
    expect(body.vad_filter).toBe(true)
  })

  test("runStt parses the deepgram nova-3 transcript shape", async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const text = await runStt({
      providerId: "deepgram-stt",
      apiKey: "tok",
      accountId: "acc",
      model: "@cf/deepgram/nova-3",
      language: "fr-CA",
      audio: new Uint8Array([4, 5]),
      mime: "audio/webm",
      fetchImpl: async (url, init) => {
        seen = { url: String(url), init: init ?? {} }
        return new Response(
          JSON.stringify({
            result: {
              results: {
                channels: [
                  { alternatives: [{ transcript: "  Bonjour le monde  " }] },
                ],
              },
            },
          }),
          { status: 200 },
        )
      },
    })
    expect(text).toBe("Bonjour le monde")
    const call = seen as unknown as { url: string; init: RequestInit } | null
    expect(decodeURIComponent(call?.url ?? "")).toContain(
      "api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/deepgram/nova-3",
    )
    const body = JSON.parse(String(call?.init.body)) as {
      audio: number[]
      language?: string
      smart_format?: boolean
      punctuate?: boolean
    }
    expect(body.audio).toEqual([4, 5])
    expect(body.language).toBe("fr")
    expect(body.smart_format).toBe(true)
    expect(body.punctuate).toBe(true)
  })

  test("runStt posts multipart to groq with a normalized language", async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const text = await runStt({
      providerId: "groq-stt",
      apiKey: "tok",
      accountId: "",
      model: "whisper-large-v3",
      language: "auto",
      audio: new Uint8Array([1]),
      mime: "audio/webm",
      fetchImpl: async (url, init) => {
        seen = { url: String(url), init: init ?? {} }
        return new Response(JSON.stringify({ text: " hello " }), {
          status: 200,
        })
      },
    })
    expect(text).toBe("hello")
    const call = seen as unknown as { url: string; init: RequestInit } | null
    expect(call?.url).toBe(
      "https://api.groq.com/openai/v1/audio/transcriptions",
    )
    const form = call?.init.body as FormData
    expect(form.get("model")).toBe("whisper-large-v3")
    expect(form.get("language")).toBeNull()
  })

  test("runTts sends the xai shape and returns raw audio", async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const audio = await runTts({
      providerId: "xai-tts",
      apiKey: "tok",
      accountId: "",
      model: "",
      voice: "",
      language: "fr-CA",
      text: "salut",
      fetchImpl: async (url, init) => {
        seen = { url: String(url), init: init ?? {} }
        return new Response(new Uint8Array([9, 9]).buffer as ArrayBuffer, {
          status: 200,
          headers: { "content-type": "audio/wav" },
        })
      },
    })
    expect(audio.mime).toBe("audio/wav")
    expect(Array.from(audio.bytes)).toEqual([9, 9])
    const call = seen as unknown as { url: string; init: RequestInit } | null
    expect(call?.url).toBe("https://api.x.ai/v1/tts")
    expect(JSON.parse(String(call?.init.body))).toEqual({
      text: "salut",
      voice_id: "eve",
      language: "fr",
    })
  })

  test("runTts decodes workers ai base64 audio", async () => {
    const audio = await runTts({
      providerId: "workers-ai-tts",
      apiKey: "tok",
      accountId: "acc",
      model: "@cf/myshell-ai/melotts",
      voice: "",
      language: "en",
      text: "hi",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            result: { audio: Buffer.from("mp3bytes").toString("base64") },
          }),
          { status: 200 },
        ),
    })
    expect(Buffer.from(audio.bytes).toString()).toBe("mp3bytes")
    expect(audio.mime).toBe("audio/mp3")
  })

  test("voiceConfigError catches emails-as-account-ids and short keys", () => {
    const base = {
      sttProvider: "workers-ai-stt",
      sttAccountId: "a".repeat(32),
      sttApiKey: "k".repeat(40),
      sttModel: "@cf/openai/whisper",
      ttsProvider: "",
      ttsAccountId: "",
      ttsApiKey: "",
      ttsModel: "",
      ttsVoice: "",
      language: "",
    }
    expect(voiceConfigError(base)).toBeNull()
    expect(voiceConfigError({ ...base, sttAccountId: "me@example.com" })) //
      .toMatch(/32-character/)
    expect(voiceConfigError({ ...base, sttApiKey: "x" })) //
      .toMatch(/too short/)
    expect(
      voiceConfigError({
        ...base,
        sttAccountId: "",
        sttApiKey: "",
        ttsProvider: "openai-tts",
        ttsApiKey: "k".repeat(40),
      }),
    ).toBeNull()
  })

  test("runStt surfaces the provider error body", async () => {
    const err = await runStt({
      providerId: "workers-ai-stt",
      apiKey: "k".repeat(40),
      accountId: "b".repeat(32),
      model: "@cf/openai/whisper",
      language: "",
      audio: new Uint8Array([1]),
      mime: "audio/webm",
      fetchImpl: async () =>
        new Response(JSON.stringify({ errors: ["bad account"] }), {
          status: 400,
        }),
    }).then(
      () => null,
      (caught: Error) => caught,
    )
    expect(err?.message).toContain("Cloudflare Workers AI failed (400)")
    expect(err?.message).toContain("bad account")

    const rejected = await runStt({
      providerId: "openai-stt",
      apiKey: "k".repeat(40),
      accountId: "",
      model: "whisper-1",
      language: "",
      audio: new Uint8Array([1]),
      mime: "audio/webm",
      fetchImpl: async () => new Response("nope", { status: 401 }),
    }).then(
      () => null,
      (caught: Error) => caught,
    )
    expect(rejected?.message).toContain("rejected the speech-to-text API key")
  })

  test("runStt reports a 200 rejected-request envelope from workers ai", async () => {
    const err = await runStt({
      providerId: "workers-ai-stt",
      apiKey: "k".repeat(40),
      accountId: "b".repeat(32),
      model: "",
      language: "",
      audio: new Uint8Array([1]),
      mime: "audio/webm",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ message: "bad account" }],
          }),
          { status: 200 },
        ),
    }).then(
      () => null,
      (caught: Error) => caught,
    )
    expect(err?.message).toContain("Cloudflare Workers AI failed")
    expect(err?.message).toContain("bad account")
  })

  test("runStt labels network failures and timeouts with the provider", async () => {
    const network = new TypeError("fetch failed", {
      cause: new Error("getaddrinfo ENOTFOUND api.cloudflare.com"),
    })
    const unreachable = await runStt({
      providerId: "workers-ai-stt",
      apiKey: "k".repeat(40),
      accountId: "b".repeat(32),
      model: "",
      language: "",
      audio: new Uint8Array([1]),
      mime: "audio/webm",
      fetchImpl: async () => {
        throw network
      },
    }).then(
      () => null,
      (caught: Error) => caught,
    )
    expect(unreachable?.message).toBe(
      "could not reach Cloudflare Workers AI: getaddrinfo ENOTFOUND api.cloudflare.com",
    )

    const timeout = new Error("The operation timed out.")
    timeout.name = "TimeoutError"
    const timedOut = await runStt({
      providerId: "openai-stt",
      apiKey: "k".repeat(40),
      accountId: "",
      model: "whisper-1",
      language: "",
      audio: new Uint8Array([1]),
      mime: "audio/webm",
      fetchImpl: async () => {
        throw timeout
      },
    }).then(
      () => null,
      (caught: Error) => caught,
    )
    expect(timedOut?.message).toBe("OpenAI (Whisper) did not answer within 60s")
  })

  test("runStt names the provider on a malformed or empty 200 body", async () => {
    const malformed = await runStt({
      providerId: "openai-stt",
      apiKey: "k".repeat(40),
      accountId: "",
      model: "whisper-1",
      language: "",
      audio: new Uint8Array([1]),
      mime: "audio/webm",
      fetchImpl: async () =>
        new Response("<html>gateway</html>", { status: 200 }),
    }).then(
      () => null,
      (caught: Error) => caught,
    )
    expect(malformed?.message).toBe(
      "OpenAI (Whisper) returned a malformed response",
    )

    const empty = await runStt({
      providerId: "groq-stt",
      apiKey: "k".repeat(40),
      accountId: "",
      model: "whisper-large-v3",
      language: "",
      audio: new Uint8Array([1]),
      mime: "audio/webm",
      fetchImpl: async () => new Response("{}", { status: 200 }),
    }).then(
      () => null,
      (caught: Error) => caught,
    )
    expect(empty?.message).toBe("Groq (Whisper) returned no transcription")
  })

  test("runTts reports a 200 rejected-request envelope from workers ai", async () => {
    const err = await runTts({
      providerId: "workers-ai-tts",
      apiKey: "k".repeat(40),
      accountId: "b".repeat(32),
      model: "@cf/myshell-ai/melotts",
      voice: "",
      language: "",
      text: "hello",
      fetchImpl: async () =>
        new Response(JSON.stringify({ success: false, errors: ["no quota"] }), {
          status: 200,
        }),
    }).then(
      () => null,
      (caught: Error) => caught,
    )
    expect(err?.message).toContain("Cloudflare Workers AI failed")
    expect(err?.message).toContain("no quota")
  })

  test("runTts truncates to the character cap", async () => {
    expect(ttsMaxChars("abcdef")).toBe("abcdef")
    expect(ttsMaxChars("x".repeat(5000)).length).toBe(4000)
    await expect(
      runTts({
        providerId: "openai-tts",
        apiKey: "tok",
        accountId: "",
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        language: "",
        text: "   ",
        fetchImpl: async () => new Response("", { status: 200 }),
      }),
    ).rejects.toThrow("text is required")
  })
})
