import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Paper from "@shpaw415/mui-lite/Paper"
import Stack from "@shpaw415/mui-lite/Stack"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useEffect, useState } from "react"
import { api } from "./api"

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
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle1">OpenViking models</Typography>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
        Embedding and VLM used by your desktop's OpenViking. Chat models are
        connected on the Providers page.
      </Typography>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {saved ? <Alert severity="success">{saved}</Alert> : null}
      <Stack spacing={1.5} sx={{ mt: 1 }}>
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
        <TextField
          label="Embed model"
          value={embedModel}
          onChange={(event) => setEmbedModel(event.currentTarget.value)}
        />
        <TextField
          label="Embed dimension"
          value={embedDimension}
          onChange={(event) => setEmbedDimension(event.currentTarget.value)}
        />
        <TextField
          label="VLM model"
          value={vlmModel}
          onChange={(event) => setVlmModel(event.currentTarget.value)}
        />
        <Button
          variant="contained"
          disabled={busy}
          onClick={() => void save()}
          sx={{ alignSelf: "flex-start" }}
        >
          Save OpenViking models
        </Button>
      </Stack>
    </Paper>
  )
}
