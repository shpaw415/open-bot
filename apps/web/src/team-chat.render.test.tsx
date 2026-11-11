import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { TeamChatFields } from "./admin/TeamChatFields"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function flush(ms = 40) {
  await act(async () => {
    await sleep(ms)
  })
}

// The OpenCode setup on the admin desktop. `zai-coding-plan` and
// `github-copilot` are not key-vault slugs at all — they only exist as
// OpenCode logins, so their presence in the picker proves the list comes
// from the desktop's live OpenCode providers (/api/models), not the vault
// catalog the old free-text form used.
const MODELS_BODY = {
  models: [
    { providerID: "openai", modelID: "gpt-5", name: "GPT-5" },
    { providerID: "openai", modelID: "gpt-5-mini", name: "GPT-5 Mini" },
    { providerID: "zai-coding-plan", modelID: "glm-4.7", name: "GLM 4.7" },
    { providerID: "zai-coding-plan", modelID: "glm-4.6v", name: "GLM 4.6V" },
    { providerID: "github-copilot", modelID: "claude-sonnet-4.5" },
  ],
  connected: ["openai", "zai-coding-plan", "github-copilot"],
}

function installFetch(fail = false) {
  const realFetch = globalThis.fetch
  const seen: string[] = []
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "")
    seen.push(path)
    if (fail) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "provider list failed (502)" }), {
          status: 502,
        }),
      )
    }
    const body = path === "/api/models" ? MODELS_BODY : {}
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  }) as typeof fetch
  return {
    seen,
    restore: () => {
      globalThis.fetch = realFetch
    },
  }
}

function Harness({
  initial,
  onValues,
}: {
  initial: Record<string, string>
  onValues: (values: Record<string, string>) => void
}) {
  const [values, setValues] = useState(initial)
  return (
    <TeamChatFields
      values={values}
      onChange={(field, value) =>
        setValues((prev) => {
          const next = { ...prev, [field]: value }
          onValues(next)
          return next
        })
      }
    />
  )
}

async function renderChat(
  initial: Record<string, string>,
  options: { fail?: boolean } = {},
) {
  const { seen, restore } = installFetch(options.fail)
  let latest: Record<string, string> = { ...initial }
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <StrictMode>
        <Harness
          initial={initial}
          onValues={(values) => {
            latest = values
          }}
        />
      </StrictMode>,
    )
  })
  await flush()
  return {
    container,
    seen,
    values: () => latest,
    cleanup: async () => {
      act(() => root.unmount())
      container.remove()
      restore()
      await flush(5)
    },
  }
}

function byName(container: HTMLElement, name: string) {
  return container.querySelector<HTMLInputElement>(`input[name="${name}"]`)
}

// Opens the select at `index` (0 = provider, 1 = model), returns the
// offered options, then closes the listbox again so the next interaction
// starts closed.
async function readOptions(container: HTMLElement, index: number) {
  const trigger = [
    ...container.querySelectorAll<HTMLInputElement>(
      'input[aria-haspopup="listbox"]',
    ),
  ][index]
  expect(trigger).toBeTruthy()
  await act(async () => {
    trigger?.click()
  })
  await flush()
  const options = [
    ...document.body.querySelectorAll<HTMLElement>('[role="option"]'),
  ].map((node) => ({
    value: node.getAttribute("e-value") ?? "",
    text: node.textContent ?? "",
  }))
  await act(async () => {
    trigger?.click()
  })
  await flush()
  return options
}

async function openOptions(container: HTMLElement, index: number) {
  return (await readOptions(container, index)).map((option) => option.value)
}

async function pickOption(
  container: HTMLElement,
  index: number,
  value: string,
) {
  const trigger = [
    ...container.querySelectorAll<HTMLInputElement>(
      'input[aria-haspopup="listbox"]',
    ),
  ][index]
  expect(trigger).toBeTruthy()
  await act(async () => {
    trigger?.click()
  })
  await flush()
  const option = [
    ...document.body.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((node) => node.getAttribute("e-value") === value)
  expect(option).toBeTruthy()
  await act(async () => {
    option?.click()
  })
  await flush()
}

describe("TeamChatFields — chat provider/model come from the OpenCode setup", () => {
  test("saved pick renders; providers are the connected OpenCode ones", async () => {
    const { container, seen, cleanup } = await renderChat({
      provider: "openai",
      model: "gpt-5-mini",
    })
    try {
      expect(seen).toContain("/api/models")
      expect(byName(container, "team-chat-provider")?.value).toBe("openai")
      expect(byName(container, "team-chat-model")?.value).toBe("gpt-5-mini")
      // The model is a select of the provider's models, never a free
      // text field the admin could typo against another provider.
      expect(byName(container, "team-chat-model")?.type).not.toBe("text")
      const providers = await openOptions(container, 0)
      expect(providers).toEqual([
        "",
        "openai",
        "zai-coding-plan",
        "github-copilot",
      ])
    } finally {
      await cleanup()
    }
  })

  test("model list shows only the selected provider's models; switching provider follows", async () => {
    const { container, values, cleanup } = await renderChat({
      provider: "openai",
      model: "gpt-5",
    })
    try {
      expect(await openOptions(container, 1)).toEqual([
        "",
        "gpt-5",
        "gpt-5-mini",
      ])

      await pickOption(container, 0, "zai-coding-plan")
      // The stale OpenAI model is dropped for the new provider's first one.
      expect(values()).toEqual({
        provider: "zai-coding-plan",
        model: "glm-4.7",
      })
      expect(byName(container, "team-chat-model")?.value).toBe("glm-4.7")
      expect(await openOptions(container, 1)).toEqual([
        "",
        "glm-4.7",
        "glm-4.6v",
      ])

      await pickOption(container, 1, "glm-4.6v")
      expect(values()).toEqual({
        provider: "zai-coding-plan",
        model: "glm-4.6v",
      })

      // Clearing the provider clears the model with it.
      await pickOption(container, 0, "")
      expect(values()).toEqual({ provider: "", model: "" })
    } finally {
      await cleanup()
    }
  })

  test("a saved provider/model missing from OpenCode stays visible, flagged", async () => {
    const { container, values, cleanup } = await renderChat({
      provider: "anthropic",
      model: "claude-old",
    })
    try {
      expect(byName(container, "team-chat-provider")?.value).toBe("anthropic")
      expect(byName(container, "team-chat-model")?.value).toBe("claude-old")
      // Nothing was rewritten just by rendering the form.
      expect(values()).toEqual({ provider: "anthropic", model: "claude-old" })
      const providers = await readOptions(container, 0)
      expect(providers[1]).toEqual({
        value: "anthropic",
        text: expect.stringContaining("not connected"),
      })
      const models = await readOptions(container, 1)
      expect(models[1]).toEqual({
        value: "claude-old",
        text: expect.stringContaining("not in OpenCode setup"),
      })
    } finally {
      await cleanup()
    }
  })

  test("model list failure keeps the saved pick and says why", async () => {
    const { container, values, cleanup } = await renderChat(
      { provider: "openai", model: "gpt-5" },
      { fail: true },
    )
    try {
      expect(byName(container, "team-chat-provider")?.value).toBe("openai")
      expect(byName(container, "team-chat-model")?.value).toBe("gpt-5")
      expect(values()).toEqual({ provider: "openai", model: "gpt-5" })
      expect(container.textContent ?? "").toContain("provider list failed")
    } finally {
      await cleanup()
    }
  })
})
