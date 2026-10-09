import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Select from "@shpaw415/mui-lite/Select"
import Stack from "@shpaw415/mui-lite/Stack"
import TextField from "@shpaw415/mui-lite/TextField"
import { useEffect, useState } from "react"
import { api } from "./api"
import { ConfigSection } from "./ConfigSection"
import { VideoIcon } from "./icons"
import { useVaultOverride, VaultOverrideButton } from "./vault-lock"

type VideoField = {
  label: string
  placeholder: string
  required?: boolean
}

type VideoSpec = {
  id: string
  label: string
  defaultModel: string
  account: VideoField | null
  secret: VideoField
}

type VideoForm = {
  providers: VideoSpec[]
  provider: string
  accountId: string
  model: string
  hasKey: boolean
  keySource?: "setup" | "vault" | null
}

export function VideoProvider() {
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [keySource, setKeySource] = useState<"setup" | "vault" | null>(null)
  const [providers, setProviders] = useState<VideoSpec[]>([])
  const [provider, setProvider] = useState("")
  const [accountId, setAccountId] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState("")

  const spec = providers.find((item) => item.id === provider) ?? providers[0]
  const vault = useVaultOverride(keySource)
  useEffect(() => {
    void api<VideoForm>("/api/video")
      .then((body) => {
        setProviders(body.providers ?? [])
        setProvider(body.provider || body.providers?.[0]?.id || "")
        setAccountId(body.accountId)
        setHasKey(body.hasKey)
        setKeySource(body.keySource ?? null)
        setModel(body.model || body.providers?.[0]?.defaultModel || "")
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "failed")
      })
  }, [])

  function pickProvider(id: string) {
    const next = providers.find((item) => item.id === id)
    const prev = providers.find((item) => item.id === provider)
    setProvider(id)
    setSaved("")
    if (next && (!model || model === prev?.defaultModel)) {
      setModel(next.defaultModel)
    }
    if (next && !next.account) setAccountId("")
  }

  async function save() {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      const body = await api<{
        applied?: boolean
        keySource?: "setup" | "vault" | null
      }>("/api/video", {
        method: "PUT",
        body: JSON.stringify({
          provider: spec?.id ?? provider,
          accountId,
          apiKey,
          model,
        }),
      })
      setHasKey(true)
      setKeySource(body.keySource ?? "setup")
      setApiKey("")
      setSaved(
        body.applied
          ? "Saved. The desktop agent can generate videos now."
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
      await api("/api/video", { method: "DELETE" })
      const first = providers[0]
      setHasKey(false)
      setKeySource(null)
      setAccountId("")
      setApiKey("")
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
      icon={<VideoIcon />}
      title="Video generation"
      description="Provider used by the desktop agent when it generates videos. Switching providers keeps the saved key only while the provider stays the same."
      status={
        hasKey
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
          name="video-provider"
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
        {spec?.account ? (
          <TextField
            label={
              vault.locked
                ? `${spec.account.label} (from vault)`
                : spec.account.label
            }
            value={accountId}
            placeholder={spec.account.placeholder}
            disabled={vault.locked}
            onChange={(event) => setAccountId(event.currentTarget.value)}
          />
        ) : null}
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            label={
              vault.locked
                ? "Using the vault key"
                : hasKey
                  ? `${spec?.secret.label ?? "API key"} (blank keeps the saved key)`
                  : (spec?.secret.label ?? "API key")
            }
            type={vault.locked ? undefined : "password"}
            value={vault.locked ? "" : apiKey}
            placeholder={vault.locked ? "••••••••" : spec?.secret.placeholder}
            disabled={vault.locked}
            sx={{ flex: 1 }}
            onChange={(event) => setApiKey(event.currentTarget.value)}
          />
          {vault.locked ? (
            <VaultOverrideButton onClick={vault.override} />
          ) : null}
        </Stack>
        <TextField
          label="Model"
          value={model}
          placeholder={spec?.defaultModel}
          onChange={(event) => setModel(event.currentTarget.value)}
        />
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={busy || !spec}
            onClick={() => void save()}
          >
            Save video provider
          </Button>
          {hasKey ? (
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
