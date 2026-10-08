import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Stack from "@shpaw415/mui-lite/Stack"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useEffect, useState } from "react"
import { api } from "./api"
import { ConfigSection } from "./ConfigSection"
import { MemoryIcon } from "./icons"

type VikingForm = {
  baseURL: string
  hasKey: boolean
  embedModel: string
  embedDimension: number
  vlmModel: string
}

export function VikingModels({ endpoint }: { endpoint: string }) {
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [baseURL, setBaseURL] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [embedModel, setEmbedModel] = useState("")
  const [embedDimension, setEmbedDimension] = useState("1536")
  const [vlmModel, setVlmModel] = useState("")

  useEffect(() => {
    void api<VikingForm>(endpoint)
      .then((body) => {
        setBaseURL(body.baseURL)
        setHasKey(body.hasKey)
        setEmbedModel(body.embedModel)
        setEmbedDimension(String(body.embedDimension || 1536))
        setVlmModel(body.vlmModel)
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "failed")
      })
  }, [endpoint])

  async function save() {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      await api(endpoint, {
        method: "PUT",
        body: JSON.stringify({
          baseURL,
          apiKey,
          embedModel,
          embedDimension: Number(embedDimension),
          vlmModel,
        }),
      })
      setHasKey(true)
      setApiKey("")
      setSaved("Saved. Restart a running desktop to apply.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfigSection
      icon={<MemoryIcon />}
      title="OpenViking models"
      description="Embedding and VLM used by your desktop's OpenViking. Chat models are connected on the Providers page."
      status={
        hasKey || baseURL || embedModel || vlmModel
          ? hasKey
            ? { label: "Configured", color: "success" }
            : { label: "Partial" }
          : { label: "Not set" }
      }
    >
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {saved ? <Alert severity="success">{saved}</Alert> : null}
        <Stack spacing={1.5}>
          <Typography variant="caption" color="textSecondary">
            Connection
          </Typography>
          <TextField
            label="Base URL"
            value={baseURL}
            placeholder="https://example.test/v1"
            onChange={(event) => setBaseURL(event.currentTarget.value)}
          />
          <TextField
            label={hasKey ? "API key (blank keeps the saved key)" : "API key"}
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.currentTarget.value)}
          />
        </Stack>
        <Stack spacing={1.5}>
          <Typography variant="caption" color="textSecondary">
            Models
          </Typography>
          <TextField
            label="Embed model"
            value={embedModel}
            onChange={(event) => setEmbedModel(event.currentTarget.value)}
          />
          <TextField
            label="Embed dimension"
            value={embedDimension}
            inputMode="numeric"
            onChange={(event) => setEmbedDimension(event.currentTarget.value)}
          />
          <TextField
            label="VLM model"
            value={vlmModel}
            onChange={(event) => setVlmModel(event.currentTarget.value)}
          />
        </Stack>
        <Button
          variant="contained"
          disabled={busy}
          onClick={() => void save()}
          sx={{ alignSelf: "flex-start" }}
        >
          Save OpenViking models
        </Button>
      </Stack>
    </ConfigSection>
  )
}
