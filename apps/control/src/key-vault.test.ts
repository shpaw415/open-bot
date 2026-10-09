import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "@open-bot/db"
import {
  chatVaultSlugs,
  fillImageFromVault,
  fillSystem1FromVault,
  imageVaultSlug,
  keyVault,
  keyVaultSpecById,
  resolveChatKeys,
  resolveDesktopProviders,
  resolveImageProvider,
  resolveSystem1,
  system1VaultSlug,
  videoVaultSlug,
} from "./key-vault"

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
    lastActiveAt: 1,
  })
  return db
}

test("vault catalog covers the provider catalogs", () => {
  expect(keyVault.map((item) => item.id)).toContain("cloudflare")
  expect(keyVaultSpecById("cloudflare")?.fields.map((f) => f.id)).toContain(
    "accountId",
  )
  expect(chatVaultSlugs()).toEqual([
    "openai",
    "google",
    "xai",
    "anthropic",
    "openrouter",
  ])
  expect(imageVaultSlug("cloudflare-workers-ai")).toBe("cloudflare")
  expect(imageVaultSlug("xai-gateway")).toBe("cloudflare")
  expect(imageVaultSlug("xai")).toBe("xai")
  expect(videoVaultSlug("fal")).toBe("fal")
  expect(system1VaultSlug("cloudflare-jev")).toBe("cloudflare")
  expect(system1VaultSlug("cloudflare-clef")).toBe("cloudflare")
  expect(system1VaultSlug("laya")).toBe("laya")
  expect(system1VaultSlug("selfhosted-clef")).toBe("")
  expect(system1VaultSlug("unknown")).toBe("")
})

test("fill helpers prefer the setup values over the vault", () => {
  const vault = {
    userId: "a",
    slug: "cloudflare",
    apiKey: "vault-key",
    accountId: "vault-acct",
    gatewayId: "vault-gw",
    gatewayToken: "vault-aig",
    gatewaySlug: "vault-slug",
    baseUrl: "",
    updatedAt: 1,
  }
  expect(
    fillImageFromVault(
      {
        provider: "cloudflare-workers-ai",
        accountId: "setup-acct",
        apiKey: "setup-key",
        model: "m",
      },
      vault,
    ),
  ).toEqual({
    provider: "cloudflare-workers-ai",
    accountId: "setup-acct",
    apiKey: "setup-key",
    model: "m",
  })
  expect(
    fillImageFromVault(
      { provider: "xai-gateway", accountId: "", apiKey: "", model: "m" },
      vault,
    ),
  ).toEqual({
    provider: "xai-gateway",
    accountId: "vault-acct",
    apiKey: "vault-key",
    model: "m",
  })
  expect(
    fillSystem1FromVault(
      {
        provider: "cloudflare-jev",
        endpoint: "https://gateway.example/v1/systemone",
        apiKey: "",
        gatewayToken: "",
        model: "jev-latest",
        accountId: "",
        gatewayId: "",
        slug: "",
      },
      vault,
    ),
  ).toEqual({
    provider: "cloudflare-jev",
    endpoint: "https://gateway.example/v1/systemone",
    apiKey: "vault-key",
    gatewayToken: "vault-aig",
    model: "jev-latest",
    accountId: "vault-acct",
    gatewayId: "vault-gw",
    slug: "vault-slug",
  })
  expect(
    fillSystem1FromVault(
      {
        provider: "cloudflare-clef",
        endpoint: "https://api.example/ai/run/x",
        apiKey: "",
        gatewayToken: "",
        model: "clef",
        accountId: "",
        gatewayId: "",
        slug: "",
      },
      null,
    ).apiKey,
  ).toBe("")
})

test("resolvers report setup and vault key sources", () => {
  const db = freshDb()
  db.setImageProvider("a", {
    provider: "cloudflare-workers-ai",
    accountId: "",
    apiKey: "",
    model: "@cf/black-forest-labs/flux-2-klein-9b",
  })
  expect(db.getRawImageProvider("a")?.apiKey).toBe("")
  expect(db.getImageProvider("a")).toBeNull()
  expect(resolveImageProvider(db, "a")).toEqual({
    value: {
      provider: "cloudflare-workers-ai",
      accountId: "",
      apiKey: "",
      model: "@cf/black-forest-labs/flux-2-klein-9b",
    },
    keySource: null,
  })
  db.setUserKey("a", "cloudflare", {
    apiKey: "cf-token",
    accountId: "cf-acct",
    gatewayId: "",
    gatewayToken: "",
    gatewaySlug: "",
    baseUrl: "",
  })
  const resolved = resolveImageProvider(db, "a")
  expect(resolved?.keySource).toBe("vault")
  expect(resolved?.value.apiKey).toBe("cf-token")
  expect(resolved?.value.accountId).toBe("cf-acct")
  db.setImageProvider("a", {
    provider: "cloudflare-workers-ai",
    accountId: "own-acct",
    apiKey: "own-token",
    model: "@cf/black-forest-labs/flux-2-klein-9b",
  })
  const own = resolveImageProvider(db, "a")
  expect(own?.keySource).toBe("setup")
  expect(own?.value.apiKey).toBe("own-token")
  db.clearUserKey("a", "cloudflare")
  expect(db.getUserKey("a", "cloudflare")).toBeNull()
  expect(resolveImageProvider(db, "a")?.keySource).toBe("setup")
})

test("system1 resolution falls back to the cloudflare vault entry", () => {
  const db = freshDb()
  db.setUserKey("a", "cloudflare", {
    apiKey: "cf-token",
    accountId: "cf-acct",
    gatewayId: "home-ai",
    gatewayToken: "aig-token",
    gatewaySlug: "jev",
    baseUrl: "",
  })
  db.setSystem1("a", {
    provider: "cloudflare-jev",
    endpoint:
      "https://gateway.ai.cloudflare.com/v1/cf-acct/home-ai/custom-jev/v1/systemone",
    apiKey: "",
    gatewayToken: "",
    model: "jev-latest",
    accountId: "cf-acct",
    gatewayId: "home-ai",
    slug: "jev",
  })
  const resolved = resolveSystem1(db, "a")
  expect(resolved?.keySource).toBe("vault")
  expect(resolved?.value.apiKey).toBe("cf-token")
  expect(resolved?.value.gatewayToken).toBe("aig-token")
  expect(resolved?.value.endpoint).toContain("/v1/systemone")
})

test("desktop providers resolve with chat keys for the vault", () => {
  const db = freshDb()
  db.setUserKey("a", "openai", {
    apiKey: "sk-openai",
    accountId: "",
    gatewayId: "",
    gatewayToken: "",
    gatewaySlug: "",
    baseUrl: "",
  })
  db.setUserKey("a", "openrouter", {
    apiKey: "",
    accountId: "",
    gatewayId: "",
    gatewayToken: "",
    gatewaySlug: "",
    baseUrl: "https://openrouter.example/v1",
  })
  expect(resolveChatKeys(db, "a")).toEqual([
    { slug: "openai", key: "sk-openai" },
  ])
  const auth = resolveDesktopProviders(db, "a")
  expect(auth.chatKeys).toEqual([{ slug: "openai", key: "sk-openai" }])
  expect(auth.image).toBeNull()
  db.deleteUser("a")
  expect(db.getUserKeys("a")).toEqual([])
})
