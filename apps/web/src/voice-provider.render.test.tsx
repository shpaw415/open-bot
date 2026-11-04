import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { VoiceProvider } from "./VoiceProvider"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms = 30) {
  await act(async () => {
    await sleep(ms)
  })
}

// The public catalog shape served by GET /api/voice (voiceProvidersPublic).
const PROVIDERS = [
  {
    id: "cloudflare-stt",
    label: "Cloudflare Workers AI",
    kind: "stt",
    vaultSlug: "cloudflare",
    fields: [
      {
        key: "accountId",
        label: "Account ID",
        placeholder: "Cloudflare account ID",
        required: true,
        hint: "The 32-character ID from the Cloudflare dashboard.",
      },
      {
        key: "apiKey",
        label: "API token",
        placeholder: "Cloudflare API token",
        required: true,
        secret: true,
      },
    ],
    models: [
      {
        id: "@cf/openai/whisper-large-v3-turbo",
        label: "Whisper Large v3 Turbo",
      },
      { id: "@cf/deepgram/nova-3", label: "Deepgram Nova-3" },
    ],
    defaultModel: "@cf/openai/whisper-large-v3-turbo",
    voices: null,
    defaultVoice: "",
  },
  {
    id: "xai-tts",
    label: "xAI (Grok Voice)",
    kind: "tts",
    vaultSlug: "xai",
    fields: [
      {
        key: "apiKey",
        label: "API key",
        placeholder: "xAI API key",
        required: true,
        secret: true,
      },
    ],
    models: [],
    defaultModel: "",
    voices: {
      options: [
        { id: "ara", label: "Ara" },
        { id: "eve", label: "Eve" },
      ],
      allowCustom: true,
    },
    defaultVoice: "eve",
  },
  {
    id: "cloudflare-tts",
    label: "Cloudflare Workers AI",
    kind: "tts",
    vaultSlug: "cloudflare",
    fields: [
      {
        key: "accountId",
        label: "Account ID",
        placeholder: "Cloudflare account ID",
        required: true,
      },
      {
        key: "apiKey",
        label: "API token",
        placeholder: "Cloudflare API token",
        required: true,
        secret: true,
      },
    ],
    models: [
      { id: "@cf/myshell-ai/melotts", label: "MeloTTS" },
      {
        id: "@cf/deepgram/aura-1",
        label: "Deepgram Aura 1",
        voices: { options: [{ id: "angus", label: "Angus" }] },
        defaultVoice: "angus",
      },
    ],
    defaultModel: "@cf/myshell-ai/melotts",
    voices: null,
    defaultVoice: "",
  },
]

function installFetch(voice: unknown) {
  const realFetch = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "")
    const body = path === "/api/voice" ? voice : {}
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  }) as typeof fetch
  return () => {
    globalThis.fetch = realFetch
  }
}

async function renderVoice(voice: unknown) {
  const restore = installFetch(voice)
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <StrictMode>
        <VoiceProvider />
      </StrictMode>,
    )
  })
  await flush()
  return {
    container,
    cleanup: async () => {
      act(() => root.unmount())
      container.remove()
      restore()
      await flush(5)
    },
  }
}

const count = (text: string, needle: string) => text.split(needle).length - 1

describe("VoiceProvider — only the selected provider's fields render", () => {
  test("cloudflare STT shows account + token + model; xai TTS shows key + voice only", async () => {
    const { container, cleanup } = await renderVoice({
      providers: PROVIDERS,
      stt: {
        provider: "cloudflare-stt",
        accountId: "a".repeat(32),
        model: "@cf/deepgram/nova-3",
        hasKey: true,
        keySource: "setup",
      },
      tts: {
        provider: "xai-tts",
        accountId: "",
        model: "",
        voice: "eve",
        hasKey: true,
        keySource: "setup",
      },
      language: "en",
    })
    try {
      const text = container.textContent ?? ""
      // Exactly one Account ID field (the Cloudflare STT side).
      expect(count(text, "Account ID")).toBe(1)
      expect(text).toContain("API token")
      expect(text).toContain("STT model")
      // xAI TTS takes no model and no account id.
      expect(text).not.toContain("TTS model")
      // The selects carry the picked provider/model ids as their values.
      const byName = (name: string) =>
        container.querySelector<HTMLInputElement>(`input[name="${name}"]`)
      expect(byName("stt-provider")?.value).toBe("cloudflare-stt")
      expect(byName("stt-model")?.value).toBe("@cf/deepgram/nova-3")
      expect(byName("tts-provider")?.value).toBe("xai-tts")
      expect(byName("tts-model")).toBeNull()
      expect(byName("tts-voice")?.value).toBe("eve")
    } finally {
      await cleanup()
    }
  })

  test("melotts has no voice select; aura-1 speakers appear with its model", async () => {
    const melotts = await renderVoice({
      providers: PROVIDERS,
      stt: { provider: "", accountId: "", model: "", hasKey: false },
      tts: {
        provider: "cloudflare-tts",
        accountId: "a".repeat(32),
        model: "@cf/myshell-ai/melotts",
        voice: "",
        hasKey: true,
        keySource: "setup",
      },
      language: "en",
    })
    try {
      const inputs = [...melotts.container.querySelectorAll("input")]
      const names = inputs.map((input) => input.getAttribute("name"))
      expect(names).toContain("tts-model")
      expect(names).not.toContain("tts-voice")
    } finally {
      await melotts.cleanup()
    }

    const aura = await renderVoice({
      providers: PROVIDERS,
      stt: { provider: "", accountId: "", model: "", hasKey: false },
      tts: {
        provider: "cloudflare-tts",
        accountId: "a".repeat(32),
        model: "@cf/deepgram/aura-1",
        voice: "angus",
        hasKey: true,
        keySource: "setup",
      },
      language: "en",
    })
    try {
      const inputs = [...aura.container.querySelectorAll("input")]
      const names = inputs.map((input) => input.getAttribute("name"))
      expect(names).toContain("tts-voice")
      // Nothing selected on the STT side renders no credential fields there.
      expect(names).not.toContain("stt-model")
    } finally {
      await aura.cleanup()
    }
  })
})
