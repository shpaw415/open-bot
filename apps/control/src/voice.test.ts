import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "@open-bot/db"
import {
  applyVoicePatch,
  canonicalVoiceProviderId,
  languageCode,
  parseSttConfig,
  parseTtsConfig,
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

const EMPTY_VOICE = {
  sttProvider: "",
  sttAccountId: "",
  sttApiKey: "",
  sttModel: "",
  ttsProvider: "",
  ttsAccountId: "",
  ttsApiKey: "",
  ttsModel: "",
  ttsVoice: "",
  language: "",
}

describe("voice providers", () => {
  test("catalog is provider-aware: ids, fields, models and voices per provider", () => {
    expect(
      voiceProviders.filter((item) => item.kind === "stt").map((i) => i.id),
    ).toEqual(["openai-stt", "groq-stt", "xai-stt", "cloudflare-stt"])
    expect(
      voiceProviders.filter((item) => item.kind === "tts").map((i) => i.id),
    ).toEqual(["openai-tts", "xai-tts", "cloudflare-tts"])

    const fieldKeys = (id: string) =>
      voiceProviderById(id)?.fields.map((field) => field.key)
    // Only Cloudflare needs an account id; everyone needs just a key.
    expect(fieldKeys("cloudflare-stt")).toEqual(["accountId", "apiKey"])
    expect(fieldKeys("cloudflare-tts")).toEqual(["accountId", "apiKey"])
    expect(fieldKeys("xai-stt")).toEqual(["apiKey"])
    expect(fieldKeys("openai-stt")).toEqual(["apiKey"])
    expect(
      voiceProviderById("cloudflare-stt")?.fields.find(
        (f) => f.key === "accountId",
      )?.required,
    ).toBe(true)

    const modelIds = (id: string) =>
      voiceProviderById(id)?.models.map((model) => model.id)
    expect(modelIds("xai-stt")).toEqual(["grok-voice-transcribe-2.0"])
    expect(modelIds("cloudflare-stt")).toEqual([
      "@cf/openai/whisper-large-v3-turbo",
      "@cf/deepgram/nova-3",
    ])
    expect(modelIds("cloudflare-tts")).toEqual([
      "@cf/myshell-ai/melotts",
      "@cf/deepgram/aura-1",
    ])
    // xAI TTS takes no model at all.
    expect(modelIds("xai-tts")).toEqual([])
    expect(voiceProviderById("xai-tts")?.defaultModel).toBe("")

    // Voices hang off the model: melotts has none, aura-1 has speakers.
    const cfTts = voiceProviderById("cloudflare-tts")
    const melotts = cfTts?.models.find(
      (model) => model.id === "@cf/myshell-ai/melotts",
    )
    const aura = cfTts?.models.find(
      (model) => model.id === "@cf/deepgram/aura-1",
    )
    expect(melotts?.voices).toBeUndefined()
    expect(aura?.voices?.options.map((voice) => voice.id)).toContain("angus")
    expect(aura?.defaultVoice).toBe("angus")
    // xAI voices are presets plus custom cloned voice ids.
    const xaiVoices = voiceProviderById("xai-tts")?.voices
    expect(xaiVoices?.options.map((voice) => voice.id)).toContain("eve")
    expect(xaiVoices?.allowCustom).toBe(true)
    expect(voiceProviderById("openai-stt")?.defaultModel).toBe("whisper-1")

    const pub = voiceProvidersPublic()
    const pubCf = pub.find((item) => item.id === "cloudflare-stt")
    expect(pubCf?.fields.map((field) => field.key)).toEqual([
      "accountId",
      "apiKey",
    ])
    expect(pubCf?.models.map((model) => model.id)).toContain(
      "@cf/deepgram/nova-3",
    )
    expect(pub.find((item) => item.id === "xai-tts")?.models).toEqual([])
    // The public shape carries no server-side handler details.
    expect(pub[0]).not.toHaveProperty("secret")
  })

  test("legacy provider ids canonicalize to the cloudflare providers", () => {
    expect(canonicalVoiceProviderId("workers-ai-stt")).toBe("cloudflare-stt")
    expect(canonicalVoiceProviderId("deepgram-stt")).toBe("cloudflare-stt")
    expect(canonicalVoiceProviderId("workers-ai-tts")).toBe("cloudflare-tts")
    expect(canonicalVoiceProviderId("xai-tts")).toBe("xai-tts")
    expect(canonicalVoiceProviderId("")).toBe("")
    expect(voiceProviderById("workers-ai-stt")?.id).toBe("cloudflare-stt")
    expect(voiceProviderById("nope")).toBeUndefined()
  })

  test("vault slugs reuse existing keys", () => {
    expect(voiceVaultSlug("cloudflare-stt")).toBe("cloudflare")
    expect(voiceVaultSlug("cloudflare-tts")).toBe("cloudflare")
    expect(voiceVaultSlug("workers-ai-stt")).toBe("cloudflare")
    expect(voiceVaultSlug("xai-stt")).toBe("xai")
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

  test("parseSttConfig/parseTtsConfig build discriminated configs or null", () => {
    expect(
      parseSttConfig({
        ...EMPTY_VOICE,
        sttProvider: "cloudflare-stt",
        sttApiKey: "k",
        sttModel: "@cf/deepgram/nova-3",
      }),
    ).toBeNull() // account id required
    expect(
      parseSttConfig({
        ...EMPTY_VOICE,
        sttProvider: "cloudflare-stt",
        sttAccountId: "acc",
        sttApiKey: "k",
        sttModel: "@cf/deepgram/nova-3",
      }),
    ).toEqual({
      provider: "cloudflare-stt",
      apiKey: "k",
      accountId: "acc",
      model: "@cf/deepgram/nova-3",
    })
    // Legacy saved rows: provider alias + the old whisper model remap.
    expect(
      parseSttConfig({
        ...EMPTY_VOICE,
        sttProvider: "workers-ai-stt",
        sttAccountId: "acc",
        sttApiKey: "k",
        sttModel: "@cf/openai/whisper",
      }),
    ).toEqual({
      provider: "cloudflare-stt",
      apiKey: "k",
      accountId: "acc",
      model: "@cf/openai/whisper-large-v3-turbo",
    })
    // A model the provider does not offer never parses.
    expect(
      parseSttConfig({
        ...EMPTY_VOICE,
        sttProvider: "openai-stt",
        sttApiKey: "k",
        sttModel: "@cf/deepgram/nova-3",
      }),
    ).toBeNull()
    // Blank model falls back to the provider default; a TTS id never parses as STT.
    expect(
      parseSttConfig({
        ...EMPTY_VOICE,
        sttProvider: "xai-stt",
        sttApiKey: "k",
      }),
    ).toEqual({
      provider: "xai-stt",
      apiKey: "k",
      model: "grok-voice-transcribe-2.0",
    })
    expect(
      parseSttConfig({
        ...EMPTY_VOICE,
        sttProvider: "xai-tts",
        sttApiKey: "k",
      }),
    ).toBeNull()
    // xAI TTS needs no model; an unset voice takes the model default.
    expect(
      parseTtsConfig({
        ...EMPTY_VOICE,
        ttsProvider: "xai-tts",
        ttsApiKey: "k",
      }),
    ).toEqual({ provider: "xai-tts", apiKey: "k", voice: "eve" })
    expect(
      parseTtsConfig({
        ...EMPTY_VOICE,
        ttsProvider: "cloudflare-tts",
        ttsAccountId: "acc",
        ttsApiKey: "k",
        ttsModel: "@cf/deepgram/aura-1",
        ttsVoice: "luna",
      }),
    ).toEqual({
      provider: "cloudflare-tts",
      apiKey: "k",
      accountId: "acc",
      model: "@cf/deepgram/aura-1",
      voice: "luna",
    })
    // A voice the model does not offer falls back to its default speaker.
    expect(
      parseTtsConfig({
        ...EMPTY_VOICE,
        ttsProvider: "cloudflare-tts",
        ttsAccountId: "acc",
        ttsApiKey: "k",
        ttsModel: "@cf/deepgram/aura-1",
        ttsVoice: "alloy",
      })?.voice,
    ).toBe("angus")
    expect(parseTtsConfig(EMPTY_VOICE)).toBeNull()
  })

  test("applyVoicePatch rejects kind mismatches and unknown models", () => {
    expect(
      applyVoicePatch(EMPTY_VOICE, { stt: { provider: "xai-tts" } }).error,
    ).toMatch(/unsupported/)
    expect(
      applyVoicePatch(EMPTY_VOICE, {
        stt: { provider: "openai-stt", model: "nova-3" },
      }).error,
    ).toMatch(/model/)
    expect(
      applyVoicePatch(EMPTY_VOICE, {
        tts: { provider: "xai-tts", model: "gpt-4o-mini-tts" },
      }).error,
    ).toMatch(/model/)
    // Legacy ids are accepted and stored canonical.
    const legacy = applyVoicePatch(EMPTY_VOICE, {
      stt: { provider: "deepgram-stt", model: "@cf/deepgram/nova-3" },
    })
    expect(legacy.error).toBeNull()
    expect(legacy.next.sttProvider).toBe("cloudflare-stt")
    expect(legacy.next.sttModel).toBe("@cf/deepgram/nova-3")
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
    expect(voiceReady({ ...base, sttModel: "bogus" }, "stt")).toBe(false)
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
    expect(resolved.value.sttProvider).toBe("cloudflare-stt")
    expect(resolved.value.sttApiKey).toBe("cf-token")
    expect(resolved.value.sttAccountId).toBe("cf-account")
    expect(resolved.sttSource).toBe("vault")
    expect(resolved.value.ttsApiKey).toBe("typed-xai")
    expect(resolved.ttsSource).toBe("setup")
  })

  test("runStt posts a byte array plus language and vad to workers ai", async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const text = await runStt({
      config: {
        provider: "cloudflare-stt",
        apiKey: "tok",
        accountId: "acc",
        model: "@cf/openai/whisper-large-v3-turbo",
      },
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

  test("runStt omits the language hint on auto but keeps vad", async () => {
    let seen: { url: string; init: RequestInit } | null = null
    await runStt({
      config: {
        provider: "cloudflare-stt",
        apiKey: "tok",
        accountId: "acc",
        model: "@cf/openai/whisper-large-v3-turbo",
      },
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
      config: {
        provider: "cloudflare-stt",
        apiKey: "tok",
        accountId: "acc",
        model: "@cf/deepgram/nova-3",
      },
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
      config: {
        provider: "groq-stt",
        apiKey: "tok",
        model: "whisper-large-v3",
      },
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

  test("runStt posts multipart to xai with the file last", async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const text = await runStt({
      config: {
        provider: "xai-stt",
        apiKey: "tok",
        model: "grok-voice-transcribe-2.0",
      },
      language: "fr-CA",
      audio: new Uint8Array([7]),
      mime: "audio/webm",
      fetchImpl: async (url, init) => {
        seen = { url: String(url), init: init ?? {} }
        return new Response(JSON.stringify({ text: " salut " }), {
          status: 200,
        })
      },
    })
    expect(text).toBe("salut")
    const call = seen as unknown as { url: string; init: RequestInit } | null
    expect(call?.url).toBe("https://api.x.ai/v1/stt")
    const form = call?.init.body as FormData
    expect(form.get("model")).toBe("grok-voice-transcribe-2.0")
    expect(form.get("language")).toBe("fr")
    // The xAI API requires `file` after every other form parameter.
    expect([...form.keys()]).toEqual(["model", "language", "file"])
  })

  test("runTts sends the xai shape and returns raw audio", async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const audio = await runTts({
      config: { provider: "xai-tts", apiKey: "tok", voice: "eve" },
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

  test("runTts decodes workers ai melotts base64 audio", async () => {
    const audio = await runTts({
      config: {
        provider: "cloudflare-tts",
        apiKey: "tok",
        accountId: "acc",
        model: "@cf/myshell-ai/melotts",
        voice: "",
      },
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

  test("runTts sends the aura-1 speaker shape and returns raw audio", async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const audio = await runTts({
      config: {
        provider: "cloudflare-tts",
        apiKey: "tok",
        accountId: "acc",
        model: "@cf/deepgram/aura-1",
        voice: "luna",
      },
      language: "en",
      text: "hello aura",
      fetchImpl: async (url, init) => {
        seen = { url: String(url), init: init ?? {} }
        return new Response(new Uint8Array([1, 2]).buffer as ArrayBuffer, {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        })
      },
    })
    expect(Array.from(audio.bytes)).toEqual([1, 2])
    expect(audio.mime).toBe("audio/mpeg")
    const call = seen as unknown as { url: string; init: RequestInit } | null
    expect(decodeURIComponent(call?.url ?? "")).toContain(
      "api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/deepgram/aura-1",
    )
    expect(JSON.parse(String(call?.init.body))).toEqual({
      text: "hello aura",
      speaker: "luna",
      encoding: "mp3",
    })
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
      config: {
        provider: "cloudflare-stt",
        apiKey: "k".repeat(40),
        accountId: "b".repeat(32),
        model: "@cf/openai/whisper-large-v3-turbo",
      },
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
      config: {
        provider: "openai-stt",
        apiKey: "k".repeat(40),
        model: "whisper-1",
      },
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
      config: {
        provider: "cloudflare-stt",
        apiKey: "k".repeat(40),
        accountId: "b".repeat(32),
        model: "@cf/openai/whisper-large-v3-turbo",
      },
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
      config: {
        provider: "cloudflare-stt",
        apiKey: "k".repeat(40),
        accountId: "b".repeat(32),
        model: "@cf/openai/whisper-large-v3-turbo",
      },
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
      config: {
        provider: "openai-stt",
        apiKey: "k".repeat(40),
        model: "whisper-1",
      },
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
      config: {
        provider: "openai-stt",
        apiKey: "k".repeat(40),
        model: "whisper-1",
      },
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
      config: {
        provider: "groq-stt",
        apiKey: "k".repeat(40),
        model: "whisper-large-v3",
      },
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
      config: {
        provider: "cloudflare-tts",
        apiKey: "k".repeat(40),
        accountId: "b".repeat(32),
        model: "@cf/myshell-ai/melotts",
        voice: "",
      },
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
        config: {
          provider: "openai-tts",
          apiKey: "tok",
          model: "gpt-4o-mini-tts",
          voice: "alloy",
        },
        language: "",
        text: "   ",
        fetchImpl: async () => new Response("", { status: 200 }),
      }),
    ).rejects.toThrow("text is required")
  })
})
