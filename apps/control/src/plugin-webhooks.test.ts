import { describe, expect, test } from "bun:test"
import type { PluginManifest } from "@open-bot/plugin-kit"
import {
  clearWebhookState,
  parseWebhookPath,
  webhookManifestEnabled,
  webhookRetryAfter,
  webhookSecret,
} from "./plugin-webhooks"

const TOKEN = "a".repeat(64)

function request(url: string, headers: Record<string, string> = {}) {
  return new Request(`http://control.test${url}`, { headers })
}

describe("plugin webhooks", () => {
  test("parses hook paths with and without the token segment", () => {
    expect(parseWebhookPath("/hooks/stock-pro")).toEqual({
      pluginId: "stock-pro",
      token: null,
      rest: "/",
    })
    expect(parseWebhookPath(`/hooks/stock-pro/${TOKEN}`)).toEqual({
      pluginId: "stock-pro",
      token: TOKEN,
      rest: "/",
    })
    expect(parseWebhookPath(`/hooks/stock-pro/${TOKEN}/api/event?x=1`)).toEqual(
      {
        pluginId: "stock-pro",
        token: TOKEN,
        rest: "/api/event?x=1",
      },
    )
    expect(parseWebhookPath("/hooks/stock-pro/api/event")).toEqual({
      pluginId: "stock-pro",
      token: null,
      rest: "/api/event",
    })
    expect(parseWebhookPath("/hooks/stock-pro/")).toEqual({
      pluginId: "stock-pro",
      token: null,
      rest: "/",
    })
  })

  test("rejects bad plugin ids and traversal", () => {
    expect(parseWebhookPath("/hooks/")).toBeNull()
    expect(parseWebhookPath("/hooks/Stock-Pro/")).toBeNull()
    expect(parseWebhookPath("/hooks/a/../etc")).toBeNull()
    expect(parseWebhookPath(`/hooks/stock-pro/${TOKEN}/../..`)).toBeNull()
    expect(parseWebhookPath("/hooks/%2e%2e/x")).toBeNull()
    expect(parseWebhookPath(`/hooks/stock-pro/${"g".repeat(64)}`)?.token).toBe(
      null,
    )
  })

  test("secrets come from the path, header, or query", () => {
    const parsed = parseWebhookPath("/hooks/stock-pro/api/event")
    expect(parsed).not.toBeNull()
    const url = new URL("http://control.test/hooks/stock-pro/api/event")
    if (!parsed) return
    expect(
      webhookSecret(request("/hooks/stock-pro/api/event"), url, parsed),
    ).toBe(null)
    expect(
      webhookSecret(
        request("/hooks/stock-pro/api/event", {
          "x-open-bot-webhook-secret": TOKEN,
        }),
        url,
        parsed,
      ),
    ).toBe(TOKEN)
    expect(
      webhookSecret(
        request("/hooks/stock-pro/api/event?secret=abc"),
        new URL("http://control.test/hooks/stock-pro/api/event?secret=abc"),
        parsed,
      ),
    ).toBe("abc")
    const tokened = parseWebhookPath(`/hooks/stock-pro/${TOKEN}/api/event`)
    expect(tokened).not.toBeNull()
    if (tokened) {
      expect(webhookSecret(request("/x"), url, tokened)).toBe(TOKEN)
    }
  })

  test("webhook flag needs a page entry", () => {
    expect(
      webhookManifestEnabled({
        dashboard: { pages: { entry: "server.js", webhook: true } },
      } as PluginManifest),
    ).toBe(true)
    expect(
      webhookManifestEnabled({
        dashboard: { pages: { entry: "server.js" } },
      } as PluginManifest),
    ).toBe(false)
    expect(
      webhookManifestEnabled({
        dashboard: { pages: { entry: "server.js", webhook: false } },
      } as PluginManifest),
    ).toBe(false)
    expect(webhookManifestEnabled({} as PluginManifest)).toBe(false)
  })

  test("throttle allows a burst then asks to slow down", () => {
    clearWebhookState()
    for (let i = 0; i < 30; i++) {
      expect(webhookRetryAfter("u1", "stock-pro")).toBe(0)
    }
    expect(webhookRetryAfter("u1", "stock-pro")).toBeGreaterThan(0)
    expect(webhookRetryAfter("u2", "stock-pro")).toBe(0)
    expect(webhookRetryAfter("u1", "weather-pro")).toBe(0)
    clearWebhookState()
    expect(webhookRetryAfter("u1", "stock-pro")).toBe(0)
  })
})
