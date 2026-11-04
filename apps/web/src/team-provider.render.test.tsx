import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { TeamProviderFields } from "./admin/TeamProviderFields"
import type { PublicCatalogSpec } from "./provider-catalog"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms = 20) {
  await act(async () => {
    await sleep(ms)
  })
}

const IMAGE_PROVIDERS: PublicCatalogSpec[] = [
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

const WATCHDOG_PROVIDERS: PublicCatalogSpec[] = [
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    vaultSlug: null,
    fields: [
      {
        key: "apiKey",
        label: "API key",
        placeholder: "API key",
        required: false,
        secret: true,
      },
      {
        key: "baseUrl",
        label: "Base URL",
        placeholder: "https://gateway.example/v1",
        required: true,
      },
    ],
    models: [],
    defaultModel: "",
    allowCustomModel: true,
  },
]

async function renderFields(
  section: string,
  providers: PublicCatalogSpec[],
  values: Record<string, string>,
  secrets?: Record<string, boolean>,
) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <StrictMode>
        <TeamProviderFields
          section={section}
          providers={providers}
          values={values}
          secrets={secrets}
          onChange={() => {}}
        />
      </StrictMode>,
    )
  })
  await flush()
  return {
    container,
    cleanup: async () => {
      act(() => root.unmount())
      container.remove()
      await flush(5)
    },
  }
}

describe("TeamProviderFields — admin overlay sections are provider-aware", () => {
  test("cloudflare image shows account + token + model; secret marker is per-field", async () => {
    const { container, cleanup } = await renderFields(
      "image",
      IMAGE_PROVIDERS,
      {
        provider: "cloudflare-workers-ai",
        accountId: "a".repeat(32),
        apiKey: "",
        model: "@cf/black-forest-labs/flux-2-klein-9b",
      },
      { apiKey: true },
    )
    try {
      const text = container.textContent ?? ""
      expect(text).toContain("Account ID")
      const byName = (name: string) =>
        container.querySelector<HTMLInputElement>(`input[name="${name}"]`)
      expect(byName("team-image-provider")?.value).toBe("cloudflare-workers-ai")
      expect(byName("team-image-model")?.value).toBe(
        "@cf/black-forest-labs/flux-2-klein-9b",
      )
      const passwords = [
        ...container.querySelectorAll<HTMLInputElement>(
          'input[type="password"]',
        ),
      ]
      expect(passwords.map((input) => input.placeholder)).toEqual([
        "(stored — leave blank to keep)",
      ])
    } finally {
      await cleanup()
    }
  })

  test("openai image has no account field; custom watchdog takes base URL + free model", async () => {
    const image = await renderFields("image", IMAGE_PROVIDERS, {
      provider: "openai",
      accountId: "",
      apiKey: "",
      model: "gpt-image-1",
    })
    try {
      expect(image.container.textContent ?? "").not.toContain("Account ID")
    } finally {
      await image.cleanup()
    }

    const watchdog = await renderFields("watchdog", WATCHDOG_PROVIDERS, {
      provider: "custom",
      apiKey: "",
      baseUrl: "https://gw.example/v1",
      model: "my-model",
    })
    try {
      const text = watchdog.container.textContent ?? ""
      expect(text).toContain("Base URL")
      expect(text).not.toContain("Account ID")
      const inputs = [
        ...watchdog.container.querySelectorAll<HTMLInputElement>("input"),
      ]
      expect(inputs.map((input) => input.value)).toContain("my-model")
      expect(inputs.map((input) => input.value)).toContain(
        "https://gw.example/v1",
      )
    } finally {
      await watchdog.cleanup()
    }
  })
})
