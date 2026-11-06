import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { VikingModels } from "./VikingModels"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms = 40) {
  await act(async () => {
    await sleep(ms)
  })
}

function installFetch(viking: unknown) {
  const realFetch = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "")
    const body =
      path === "/api/viking"
        ? viking
        : path === "/api/models"
          ? {
              models: [
                {
                  providerID: "openai",
                  modelID: "gpt-5-codex",
                  name: "GPT-5 Codex",
                },
                { providerID: "xai", modelID: "grok-4.5", name: "Grok 4.5" },
                {
                  providerID: "zai-coding-plan",
                  modelID: "glm-4.6v",
                  name: "GLM 4.6V",
                },
                {
                  providerID: "claude-code",
                  modelID: "opus",
                  name: "CLI Opus",
                },
              ],
              connected: ["openai", "xai", "zai-coding-plan", "claude-code"],
            }
          : {}
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  }) as typeof fetch
  return () => {
    globalThis.fetch = realFetch
  }
}

async function renderViking(viking: unknown) {
  const restore = installFetch(viking)
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <StrictMode>
        <VikingModels endpoint="/api/viking" />
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

const SAVED = {
  baseURL: "https://api.openai.com/v1",
  hasKey: true,
  embedProvider: "custom-openai-compatible",
  embedAccountId: "",
  embedModel: "text-embedding-3-small",
  embedDimension: 1536,
  supportedVlmProviders: ["openai", "xai", "zai-coding-plan"],
}

describe("VikingModels — VLM source select", () => {
  test("opencode source picks provider and model from the desktop setup", async () => {
    const { container, cleanup } = await renderViking({
      ...SAVED,
      vlmModel: "gpt-5-codex",
      vlmSource: "opencode",
      vlmProvider: "openai",
    })
    try {
      const byName = (name: string) =>
        container.querySelector<HTMLInputElement>(`input[name="${name}"]`)
      expect(byName("viking-vlm-source")?.value).toBe("opencode")
      expect(byName("viking-vlm-provider")?.value).toBe("openai")
      expect(byName("viking-vlm-model")?.value).toBe("gpt-5-codex")
      expect(container.textContent ?? "").toContain("OpenCode login")
    } finally {
      await cleanup()
    }
  })

  test("custom source keeps the free VLM model field and no picker", async () => {
    const { container, cleanup } = await renderViking({
      ...SAVED,
      vlmModel: "qwen-vl",
      vlmSource: "custom",
      vlmProvider: "",
    })
    try {
      const byName = (name: string) =>
        container.querySelector<HTMLInputElement>(`input[name="${name}"]`)
      expect(byName("viking-vlm-source")?.value).toBe("custom")
      expect(byName("viking-vlm-provider")).toBeNull()
      const inputs = [...container.querySelectorAll<HTMLInputElement>("input")]
      expect(inputs.map((input) => input.value)).toContain("qwen-vl")
    } finally {
      await cleanup()
    }
  })
})

describe("VikingModels — embedding provider select", () => {
  test("cloudflare shows the account id and hides the base URL", async () => {
    const { container, cleanup } = await renderViking({
      ...SAVED,
      embedProvider: "cloudflare-workers-ai",
      embedAccountId: "acct-9",
      embedModel: "@cf/baai/bge-m3",
      embedDimension: 1024,
    })
    try {
      const byName = (name: string) =>
        container.querySelector<HTMLInputElement>(`input[name="${name}"]`)
      expect(byName("viking-embed-provider")?.value).toBe(
        "cloudflare-workers-ai",
      )
      const labels = [...container.querySelectorAll("label")].map(
        (label) => label.textContent ?? "",
      )
      expect(labels.some((text) => text.includes("account id"))).toBe(true)
      // Base URL hidden: derived from the account id at resolve time.
      expect(labels.some((text) => text.startsWith("Base URL"))).toBe(false)
    } finally {
      await cleanup()
    }
  })

  test("switching providers updates dimension and the visible fields", async () => {
    const { container, cleanup } = await renderViking(SAVED)
    try {
      const hidden = (name: string) =>
        container.querySelector<HTMLInputElement>(`input[name="${name}"]`)
      expect(hidden("viking-embed-provider")?.value).toBe(
        "custom-openai-compatible",
      )
      // Open the select — its trigger is the first popup field in the
      // form (the embed provider renders first) — and pick "local" in the
      // portaled listbox.
      const trigger = [
        ...container.querySelectorAll<HTMLInputElement>(
          'input[aria-haspopup="listbox"]',
        ),
      ][0]
      expect(trigger).toBeTruthy()
      await act(async () => {
        trigger?.click()
      })
      await flush()
      const option = [
        ...document.body.querySelectorAll<HTMLElement>('[role="option"]'),
      ].find((node) => node.getAttribute("e-value") === "local")
      expect(option).toBeTruthy()
      await act(async () => {
        option?.click()
      })
      await flush()
      const labels = [...container.querySelectorAll("label")].map(
        (label) => label.textContent ?? "",
      )
      // Local embedder: no key, no base URL, no account id.
      expect(labels.some((text) => text.includes("API key"))).toBe(false)
      expect(labels.some((text) => text.startsWith("Base URL"))).toBe(false)
      // Local cannot host the custom VLM — source switches to OpenCode.
      expect(hidden("viking-vlm-source")?.value).toBe("opencode")
      const dimension = [
        ...container.querySelectorAll<HTMLInputElement>("input"),
      ].find((input) => input.type === "number")
      expect(dimension?.value).toBe("512")
    } finally {
      await cleanup()
    }
  })

  test("save carries the embed provider and account id", async () => {
    // Rendered first with the stub fetch, then the PUT interceptor is
    // layered on top (renderViking installs its own stub).
    const { container, cleanup } = await renderViking({
      ...SAVED,
      embedProvider: "cloudflare-workers-ai",
      embedAccountId: "acct-7",
      embedModel: "@cf/qwen/qwen3-embedding-0.6b",
      embedDimension: 1024,
      vlmModel: "@cf/mistralai/mistral-small-3.1-24b-instruct",
      vlmSource: "custom",
    })
    const bodies: string[] = []
    const putFetch = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/viking") && init?.method === "PUT") {
        bodies.push(String(init.body))
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        )
      }
      return putFetch(input, init)
    }) as typeof fetch
    try {
      const button = [...container.querySelectorAll("button")].find((btn) =>
        (btn.textContent ?? "").includes("Save"),
      )
      expect(button).toBeTruthy()
      expect(button?.disabled).toBe(false)
      await act(async () => {
        button?.click()
      })
      await flush()
      expect(bodies).toHaveLength(1)
      const body = JSON.parse(bodies[0] ?? "{}")
      expect(body.embedProvider).toBe("cloudflare-workers-ai")
      expect(body.embedAccountId).toBe("acct-7")
      expect(body.embedModel).toBe("@cf/qwen/qwen3-embedding-0.6b")
    } finally {
      globalThis.fetch = putFetch
      await cleanup()
    }
  })
})
