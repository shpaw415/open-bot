import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Select from "@shpaw415/mui-lite/Select"
import Stack from "@shpaw415/mui-lite/Stack"
import TextField from "@shpaw415/mui-lite/TextField"
import { useEffect, useState } from "react"
import { api } from "./api"
import { ConfigSection } from "./ConfigSection"
import { NavigationIcon } from "./icons"
import { useVaultOverride, VaultOverrideButton } from "./vault-lock"

type System1Spec = {
  id: string
  label: string
  defaultModel: string
  endpointPlaceholder: string
  keyRequired: boolean
  gatewayToken: boolean
}

type System1Form = {
  providers: System1Spec[]
  provider: string
  endpoint: string
  model: string
  accountId: string
  gatewayId: string
  slug: string
  hasKey: boolean
  hasGatewayToken: boolean
  keySource?: "setup" | "vault" | null
}

function composeEndpoint(accountId: string, gatewayId: string, slug: string) {
  const account = accountId.trim()
  const gateway = gatewayId.trim()
  const name = (slug.trim() || "jev").replace(/^custom-/, "")
  if (!/^[A-Za-z0-9_-]+$/.test(account)) return ""
  if (!/^[A-Za-z0-9_-]+$/.test(gateway)) return ""
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return ""
  return `https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/custom-${name}/v1/systemone`
}

function composeClefEndpoint(accountId: string) {
  const account = accountId.trim()
  if (!/^[A-Za-z0-9_-]+$/.test(account)) return ""
  return `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/clef`
}

export function System1() {
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [hasGatewayToken, setHasGatewayToken] = useState(false)
  const [keySource, setKeySource] = useState<"setup" | "vault" | null>(null)
  const [providers, setProviders] = useState<System1Spec[]>([])
  const [provider, setProvider] = useState("")
  const [endpoint, setEndpoint] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [gatewayToken, setGatewayToken] = useState("")
  const [model, setModel] = useState("")
  const [accountId, setAccountId] = useState("")
  const [gatewayId, setGatewayId] = useState("")
  const [slug, setSlug] = useState("jev")

  const spec = providers.find((item) => item.id === provider) ?? providers[0]
  const vault = useVaultOverride(keySource)

  useEffect(() => {
    void api<System1Form>("/api/system1")
      .then((body) => {
        setProviders(body.providers ?? [])
        setProvider(body.provider || body.providers?.[0]?.id || "")
        setEndpoint(body.endpoint)
        setModel(body.model)
        setAccountId(body.accountId)
        setGatewayId(body.gatewayId)
        setSlug(body.slug || "jev")
        setHasKey(body.hasKey)
        setHasGatewayToken(body.hasGatewayToken)
        setKeySource(body.keySource ?? null)
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "failed")
      })
  }, [])

  function fillEndpoint(nextProvider: string, nextEndpoint: string) {
    const next = providers.find((item) => item.id === nextProvider)
    if (!next) return nextEndpoint
    if (nextEndpoint.trim()) return nextEndpoint
    if (next.id === "cloudflare-jev") {
      return (
        composeEndpoint(accountId, gatewayId, slug) || next.endpointPlaceholder
      )
    }
    if (next.id === "cloudflare-clef") {
      return composeClefEndpoint(accountId) || next.endpointPlaceholder
    }
    return next.endpointPlaceholder
  }

  function pickProvider(id: string) {
    const next = providers.find((item) => item.id === id)
    const prev = providers.find((item) => item.id === provider)
    setProvider(id)
    setSaved("")
    setEndpoint((current) => {
      if (current.trim() && current !== prev?.endpointPlaceholder)
        return current
      return fillEndpoint(id, "")
    })
    if (next && (!model || model === prev?.defaultModel)) {
      setModel(next.defaultModel)
    }
  }

  function setComposed(
    nextAccount: string,
    nextGateway: string,
    nextSlug: string,
  ) {
    setAccountId(nextAccount)
    setGatewayId(nextGateway)
    setSlug(nextSlug)
    if (spec?.id !== "cloudflare-jev") return
    const previous = composeEndpoint(accountId, gatewayId, slug)
    const placeholder = spec.endpointPlaceholder
    setEndpoint((current) => {
      if (current && current !== previous && current !== placeholder) {
        return current
      }
      return composeEndpoint(nextAccount, nextGateway, nextSlug) || placeholder
    })
  }

  function setClefAccount(nextAccount: string) {
    setAccountId(nextAccount)
    if (spec?.id !== "cloudflare-clef") return
    const previous = composeClefEndpoint(accountId)
    const placeholder = spec.endpointPlaceholder
    setEndpoint((current) => {
      if (current && current !== previous && current !== placeholder) {
        return current
      }
      return composeClefEndpoint(nextAccount) || placeholder
    })
  }

  async function save() {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      const body = await api<{
        applied?: boolean
        keySource?: "setup" | "vault" | null
      }>("/api/system1", {
        method: "PUT",
        body: JSON.stringify({
          provider: spec?.id ?? provider,
          endpoint,
          apiKey,
          gatewayToken,
          model,
          accountId,
          gatewayId,
          slug,
        }),
      })
      setHasKey(Boolean(apiKey) || hasKey)
      setKeySource(body.keySource ?? "setup")
      setApiKey("")
      setHasGatewayToken(Boolean(gatewayToken) || hasGatewayToken)
      setGatewayToken("")
      setSaved(
        body.applied
          ? "Saved. The desktop agent can use this endpoint now."
          : "Saved. Applies when the desktop starts.",
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      await api("/api/system1", { method: "DELETE" })
      const first = providers[0]
      setHasKey(false)
      setHasGatewayToken(false)
      setKeySource(null)
      setEndpoint("")
      setApiKey("")
      setGatewayToken("")
      setAccountId("")
      setGatewayId("")
      setSlug("jev")
      setProvider(first?.id ?? "")
      setModel(first?.defaultModel ?? "")
      setSaved("Removed.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "remove failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfigSection
      icon={<NavigationIcon />}
      title="Desktop navigation"
      description="System 1 endpoint for page navigation. Cloudflare Jev is an AI Gateway custom provider. Cloudflare Clef runs on Workers AI and answers the same typed questions. Self-hosted Laya uses the same POST path. Page text is sent to this endpoint."
      status={
        hasKey || hasGatewayToken || endpoint.trim()
          ? { label: spec?.label ?? "Configured", color: "success" }
          : keySource === "vault"
            ? { label: "Vault key", color: "primary" }
            : { label: "Not set" }
      }
    >
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {saved ? <Alert severity="success">{saved}</Alert> : null}
        <Select
          name="system1-provider"
          label="Provider"
          value={spec?.id ?? ""}
          disabled={providers.length === 0}
          onSelect={pickProvider}
        >
          {providers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
        {spec?.id === "cloudflare-jev" ? (
          <Stack spacing={1.5}>
            <TextField
              label={vault.locked ? "Account ID (from vault)" : "Account ID"}
              value={accountId}
              placeholder="Cloudflare account ID"
              disabled={vault.locked}
              onChange={(event) =>
                setComposed(event.currentTarget.value, gatewayId, slug)
              }
            />
            <TextField
              label={vault.locked ? "Gateway ID (from vault)" : "Gateway ID"}
              value={gatewayId}
              placeholder="home-ai"
              disabled={vault.locked}
              onChange={(event) =>
                setComposed(accountId, event.currentTarget.value, slug)
              }
            />
            <TextField
              label={
                vault.locked ? "Provider slug (from vault)" : "Provider slug"
              }
              value={slug}
              placeholder="jev"
              disabled={vault.locked}
              onChange={(event) =>
                setComposed(accountId, gatewayId, event.currentTarget.value)
              }
            />
          </Stack>
        ) : null}
        {spec?.id === "cloudflare-clef" ? (
          <TextField
            label={vault.locked ? "Account ID (from vault)" : "Account ID"}
            value={accountId}
            placeholder="Cloudflare account ID"
            disabled={vault.locked}
            onChange={(event) => setClefAccount(event.currentTarget.value)}
          />
        ) : null}
        <TextField
          label="Endpoint"
          value={endpoint}
          placeholder={spec?.endpointPlaceholder}
          onChange={(event) => setEndpoint(event.currentTarget.value)}
        />
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            label={
              vault.locked
                ? "Using the vault key"
                : hasKey
                  ? spec?.keyRequired
                    ? "API key (blank keeps the saved key)"
                    : "API key (optional, blank keeps the saved key)"
                  : spec?.keyRequired
                    ? "API key"
                    : "API key (optional)"
            }
            type={vault.locked ? undefined : "password"}
            value={vault.locked ? "" : apiKey}
            placeholder={vault.locked ? "••••••••" : undefined}
            disabled={vault.locked}
            sx={{ flex: 1 }}
            onChange={(event) => setApiKey(event.currentTarget.value)}
          />
          {vault.locked ? (
            <VaultOverrideButton onClick={vault.override} />
          ) : null}
        </Stack>
        {spec?.gatewayToken ? (
          <TextField
            label={
              vault.locked
                ? "Gateway token (from vault)"
                : hasGatewayToken
                  ? "Gateway token (blank keeps the saved token)"
                  : "Gateway token (optional)"
            }
            type={vault.locked ? undefined : "password"}
            value={vault.locked ? "" : gatewayToken}
            placeholder={vault.locked ? "••••••••" : "cf-aig-authorization"}
            disabled={vault.locked}
            onChange={(event) => setGatewayToken(event.currentTarget.value)}
          />
        ) : null}
        <TextField
          label={
            spec?.id === "cloudflare-clef"
              ? "Model (clef or clef-flash)"
              : "Model"
          }
          value={model}
          placeholder={spec?.defaultModel || "omit to let the server choose"}
          onChange={(event) => setModel(event.currentTarget.value)}
        />
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={busy || !spec}
            onClick={() => void save()}
          >
            Save navigation provider
          </Button>
          {hasKey || endpoint ? (
            <Button
              variant="text"
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove
            </Button>
          ) : null}
        </Stack>
      </Stack>
    </ConfigSection>
  )
}
