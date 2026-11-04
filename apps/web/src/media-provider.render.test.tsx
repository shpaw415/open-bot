import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ImageProvider } from "./ImageProvider"
import type { PublicCatalogSpec } from "./provider-catalog"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms = 30) {
  await act(async () => {
    await sleep(ms)
  })
}

const PROVIDERS: PublicCatalogSpec[] = [
  {
    id: "cloudflare-workers-ai",
    label: "Cloudflare Workers AI",
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
        placeholder: "Workers AI token",
        required: true,
        secret: true,
      },
    ],
    models: [
      {
        id: "@cf/black-forest-labs/flux-2-klein-9b",
        label: "@cf/black-forest-labs/flux-2-klein-9b",
      },
    ],
    defaultModel: "@cf/black-forest-labs/flux-2-klein-9b",
    allowCustomModel: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    vaultSlug: "openai",
    fields: [
      {
        key: "apiKey",
        label: "API key",
        placeholder: "OpenAI API key",
        required: true,
        secret: true,
      },
    ],
    models: [{ id: "gpt-image-1", label: "gpt-image-1" }],
    defaultModel: "gpt-image-1",
    allowCustomModel: true,
  },
]

function installFetch(image: unknown) {
  const realFetch = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "")
    const body = path === "/api/image" ? image : {}
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  }) as typeof fetch
  return () => {
    globalThis.fetch = realFetch
  }
}

async function renderImage(image: unknown) {
  const restore = installFetch(image)
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <StrictMode>
        <ImageProvider />
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

describe("MediaProviderForm — only the selected provider's fields render", () => {
  test("cloudflare image shows account + token + model select", async () => {
    const { container, cleanup } = await renderImage({
      providers: PROVIDERS,
      provider: "cloudflare-workers-ai",
      accountId: "a".repeat(32),
      model: "@cf/black-forest-labs/flux-2-klein-9b",
      hasKey: true,
      keySource: "setup",
    })
    try {
      const text = container.textContent ?? ""
      expect(count(text, "Account ID")).toBe(1)
      expect(text).toContain("API token")
      const byName = (name: string) =>
        container.querySelector<HTMLInputElement>(`input[name="${name}"]`)
      expect(byName("image-provider")?.value).toBe("cloudflare-workers-ai")
      expect(byName("image-model")?.value).toBe(
        "@cf/black-forest-labs/flux-2-klein-9b",
      )
    } finally {
      await cleanup()
    }
  })

  test("openai image shows key + model only; a custom model opens the text field", async () => {
    const { container, cleanup } = await renderImage({
      providers: PROVIDERS,
      provider: "openai",
      accountId: "",
      model: "gpt-image-2-unreleased",
      hasKey: true,
      keySource: "setup",
    })
    try {
      const text = container.textContent ?? ""
      expect(text).not.toContain("Account ID")
      expect(text).toContain("Custom model")
      const byName = (name: string) =>
        container.querySelector<HTMLInputElement>(`input[name="${name}"]`)
      expect(byName("image-provider")?.value).toBe("openai")
      // The select sits on the Custom entry and the saved model is editable.
      expect(byName("image-model")?.value).toBe("__custom__")
      const inputs = [...container.querySelectorAll<HTMLInputElement>("input")]
      expect(inputs.map((input) => input.value)).toContain(
        "gpt-image-2-unreleased",
      )
    } finally {
      await cleanup()
    }
  })
})
