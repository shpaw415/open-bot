import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Paper from "@shpaw415/mui-lite/Paper"
import Select from "@shpaw415/mui-lite/Select"
import Stack from "@shpaw415/mui-lite/Stack"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useEffect, useState } from "react"
import { api } from "./api"

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

export function System1() {
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [hasGatewayToken, setHasGatewayToken] = useState(false)
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

  async function save() {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      const body = await api<{ applied?: boolean }>("/api/system1", {
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
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle1">Desktop navigation</Typography>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
        System 1 endpoint for page navigation. Cloudflare Jev is an AI Gateway
        custom provider. Self-hosted Laya uses the same POST path. Page text is
        sent to this endpoint.
      </Typography>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {saved ? <Alert severity="success">{saved}</Alert> : null}
      <Stack spacing={1.5} sx={{ mt: 1 }}>
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
              label="Account ID"
              value={accountId}
              placeholder="Cloudflare account ID"
              onChange={(event) =>
                setComposed(event.currentTarget.value, gatewayId, slug)
              }
            />
            <TextField
              label="Gateway ID"
              value={gatewayId}
              placeholder="home-ai"
              onChange={(event) =>
                setComposed(accountId, event.currentTarget.value, slug)
              }
            />
            <TextField
              label="Provider slug"
              value={slug}
              placeholder="jev"
              onChange={(event) =>
                setComposed(accountId, gatewayId, event.currentTarget.value)
              }
            />
          </Stack>
        ) : null}
        <TextField
          label="Endpoint"
          value={endpoint}
          placeholder={spec?.endpointPlaceholder}
          onChange={(event) => setEndpoint(event.currentTarget.value)}
        />
        <TextField
          label={
            hasKey
              ? spec?.keyRequired
                ? "API key (blank keeps the saved key)"
                : "API key (optional, blank keeps the saved key)"
              : spec?.keyRequired
                ? "API key"
                : "API key (optional)"
          }
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.currentTarget.value)}
        />
        {spec?.gatewayToken ? (
          <TextField
            label={
              hasGatewayToken
                ? "Gateway token (blank keeps the saved token)"
                : "Gateway token (optional)"
            }
            type="password"
            value={gatewayToken}
            placeholder="cf-aig-authorization"
            onChange={(event) => setGatewayToken(event.currentTarget.value)}
          />
        ) : null}
        <TextField
          label="Model"
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
    </Paper>
  )
}
