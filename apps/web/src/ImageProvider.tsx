import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Paper from "@shpaw415/mui-lite/Paper"
import Select from "@shpaw415/mui-lite/Select"
import Stack from "@shpaw415/mui-lite/Stack"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useEffect, useState } from "react"
import { api } from "./api"

type ImageField = {
  label: string
  placeholder: string
  required?: boolean
}

type ImageSpec = {
  id: string
  label: string
  defaultModel: string
  account: ImageField | null
  secret: ImageField
}

type ImageForm = {
  providers: ImageSpec[]
  provider: string
  accountId: string
  model: string
  hasKey: boolean
}

export function ImageProvider() {
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [providers, setProviders] = useState<ImageSpec[]>([])
  const [provider, setProvider] = useState("")
  const [accountId, setAccountId] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState("")

  const spec = providers.find((item) => item.id === provider) ?? providers[0]

  useEffect(() => {
    void api<ImageForm>("/api/image")
      .then((body) => {
        setProviders(body.providers ?? [])
        setProvider(body.provider || body.providers?.[0]?.id || "")
        setAccountId(body.accountId)
        setHasKey(body.hasKey)
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
      const body = await api<{ applied?: boolean }>("/api/image", {
        method: "PUT",
        body: JSON.stringify({
          provider: spec?.id ?? provider,
          accountId,
          apiKey,
          model,
        }),
      })
      setHasKey(true)
      setApiKey("")
      setSaved(
        body.applied
          ? "Saved. The desktop agent can generate images now."
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
      await api("/api/image", { method: "DELETE" })
      const first = providers[0]
      setHasKey(false)
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
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle1">Image generation</Typography>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
        Provider used by the desktop agent. Only Cloudflare Workers AI is
        available now. More providers can be added later.
      </Typography>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {saved ? <Alert severity="success">{saved}</Alert> : null}
      <Stack spacing={1.5} sx={{ mt: 1 }}>
        <Select
          name="image-provider"
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
            label={spec.account.label}
            value={accountId}
            placeholder={spec.account.placeholder}
            onChange={(event) => setAccountId(event.currentTarget.value)}
          />
        ) : null}
        <TextField
          label={
            hasKey
              ? `${spec?.secret.label ?? "API token"} (blank keeps the saved token)`
              : (spec?.secret.label ?? "API token")
          }
          type="password"
          value={apiKey}
          placeholder={spec?.secret.placeholder}
          onChange={(event) => setApiKey(event.currentTarget.value)}
        />
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
            Save image provider
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
    </Paper>
  )
}
