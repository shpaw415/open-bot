import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { TeamVoiceFields } from "./admin/TeamVoiceFields"
import type { VoiceSpec } from "./voice-catalog"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms = 20) {
  await act(async () => {
    await sleep(ms)
  })
}

const PROVIDERS: VoiceSpec[] = [
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
    id: "xai-stt",
    label: "xAI (Grok Voice Transcribe)",
    kind: "stt",
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
    models: [
      { id: "grok-voice-transcribe-2.0", label: "Grok Voice Transcribe 2.0" },
    ],
    defaultModel: "grok-voice-transcribe-2.0",
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
    voices: { options: [{ id: "eve", label: "Eve" }], allowCustom: true },
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
      { id: "@cf/deepgram/aura-1", label: "Deepgram Aura 1" },
    ],
    defaultModel: "@cf/myshell-ai/melotts",
    voices: null,
    defaultVoice: "",
  },
]

async function renderFields(
  values: Record<string, string>,
  secrets?: Record<string, boolean>,
) {
  const changes: [string, string][] = []
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <StrictMode>
        <TeamVoiceFields
          providers={PROVIDERS}
          values={values}
          secrets={secrets}
          onChange={(field, value) => changes.push([field, value])}
        />
      </StrictMode>,
    )
  })
  await flush()
  return {
    container,
    changes,
    cleanup: async () => {
      act(() => root.unmount())
      container.remove()
      await flush(5)
    },
  }
}

const count = (text: string, needle: string) => text.split(needle).length - 1

describe("TeamVoiceFields — admin team voice is provider-aware", () => {
  test("cloudflare STT shows account + token + model; xai TTS shows key only", async () => {
    const { container, cleanup } = await renderFields(
      {
        sttProvider: "cloudflare-stt",
        sttAccountId: "a".repeat(32),
        sttApiKey: "",
        sttModel: "@cf/deepgram/nova-3",
        ttsProvider: "xai-tts",
        ttsAccountId: "",
        ttsApiKey: "",
        ttsModel: "",
      },
      { sttApiKey: true, ttsApiKey: false },
    )
    try {
      const text = container.textContent ?? ""
      expect(count(text, "Account ID")).toBe(1)
      expect(text).toContain("STT model")
      // xAI TTS takes no model and no account id; voice stays per-user, so
      // no voice select exists in the shared overlay either.
      expect(text).not.toContain("TTS model")
      const byName = (name: string) =>
        container.querySelector<HTMLInputElement>(`input[name="${name}"]`)
      expect(byName("team-voice-stt-provider")?.value).toBe("cloudflare-stt")
      expect(byName("team-voice-stt-model")?.value).toBe("@cf/deepgram/nova-3")
      expect(byName("team-voice-tts-provider")?.value).toBe("xai-tts")
      expect(byName("team-voice-tts-model")).toBeNull()
      // Per-side secret markers: STT key stored, TTS key not.
      const passwordInputs = [
        ...container.querySelectorAll<HTMLInputElement>(
          'input[type="password"]',
        ),
      ]
      expect(passwordInputs.map((input) => input.placeholder)).toEqual([
        "(stored — leave blank to keep)",
        "(not set)",
      ])
    } finally {
      await cleanup()
    }
  })

  test("legacy overlay ids and the retired whisper model display canonical", async () => {
    const { container, cleanup } = await renderFields({
      sttProvider: "workers-ai-stt",
      sttAccountId: "",
      sttApiKey: "",
      sttModel: "@cf/openai/whisper",
      ttsProvider: "",
      ttsAccountId: "",
      ttsApiKey: "",
      ttsModel: "",
    })
    try {
      const byName = (name: string) =>
        container.querySelector<HTMLInputElement>(`input[name="${name}"]`)
      expect(byName("team-voice-stt-provider")?.value).toBe("cloudflare-stt")
      expect(byName("team-voice-stt-model")?.value).toBe(
        "@cf/openai/whisper-large-v3-turbo",
      )
      // Unset TTS side renders only its provider select.
      expect(byName("team-voice-tts-model")).toBeNull()
      expect(container.querySelectorAll('input[type="password"]').length).toBe(
        1,
      )
    } finally {
      await cleanup()
    }
  })
})
