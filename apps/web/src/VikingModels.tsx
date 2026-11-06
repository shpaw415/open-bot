import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Select from "@shpaw415/mui-lite/Select"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useEffect, useState } from "react"
import { api } from "./api"
import { MemoryIcon } from "./icons"
import Stack from "./stack"
import {
  embedSupportsCustomVlm,
  VIKING_EMBED_SPECS,
  vikingEmbedSpec,
} from "./viking-embed-catalog"

type VikingForm = {
  baseURL?: string
  hasKey?: boolean
  embedProvider?: string
  embedAccountId?: string
  embedModel?: string
  embedDimension?: number
  vlmModel?: string
  vlmSource?: "custom" | "opencode"
  vlmProvider?: string
  supportedVlmProviders?: string[]
}

type OpencodeModel = {
  providerID: string
  modelID: string
  name?: string
}

type VlmSource = "custom" | "opencode"

// A saved-but-unknown provider id (older control plane) falls back to the
// custom OpenAI-compatible shape so the form still renders.
const FALLBACK_PROVIDER = "custom-openai-compatible"

export function VikingModels({ endpoint }: { endpoint: string }) {
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [supported, setSupported] = useState<string[]>([])
  const [embedProvider, setEmbedProvider] = useState(FALLBACK_PROVIDER)
  const [baseURL, setBaseURL] = useState("https://api.openai.com/v1")
  const [apiKey, setApiKey] = useState("")
  const [embedAccountId, setEmbedAccountId] = useState("")
  const [embedModel, setEmbedModel] = useState("")
  const [embedDimension, setEmbedDimension] = useState("1536")
  const [vlmSource, setVlmSource] = useState<VlmSource>("custom")
  const [vlmProvider, setVlmProvider] = useState("")
  const [vlmModel, setVlmModel] = useState("")
  const [models, setModels] = useState<OpencodeModel[] | null>(null)
  const [modelsError, setModelsError] = useState("")

  const spec = vikingEmbedSpec(embedProvider)
  const baseMode = spec?.baseMode ?? "required"
  const keyMode = spec?.keyMode ?? "optional"
  const accountMode = spec?.accountMode ?? "hidden"
  const vlmCustomOk = embedSupportsCustomVlm(embedProvider)

  useEffect(() => {
    void api<VikingForm>(endpoint)
      .then((body) => {
        setEmbedProvider(body.embedProvider || FALLBACK_PROVIDER)
        setBaseURL(body.baseURL ?? "")
        setHasKey(Boolean(body.hasKey))
        setEmbedAccountId(body.embedAccountId ?? "")
        setEmbedModel(body.embedModel ?? "")
        setEmbedDimension(String(body.embedDimension || 1536))
        setVlmModel(body.vlmModel ?? "")
        setVlmSource(body.vlmSource === "opencode" ? "opencode" : "custom")
        setVlmProvider(body.vlmProvider ?? "")
        setSupported(body.supportedVlmProviders ?? [])
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : "failed"),
      )
  }, [endpoint])

  // The model list comes from the desktop's live OpenCode setup — fetch it
  // only once the OpenCode source is in play (it starts a sleeping desktop,
  // exactly like the chat model picker).
  useEffect(() => {
    if (vlmSource !== "opencode" || models !== null) return
    let alive = true
    setModelsError("")
    void api<{ models?: OpencodeModel[] }>("/api/models")
      .then((body) => {
        if (alive) setModels(body.models ?? [])
      })
      .catch((caught: unknown) => {
        if (alive) {
          setModels([])
          setModelsError(
            caught instanceof Error ? caught.message : "model list failed",
          )
        }
      })
    return () => {
      alive = false
    }
  }, [vlmSource, models])

  const supportedModels = (models ?? []).filter((model) =>
    supported.includes(model.providerID),
  )
  const providerIds = [...new Set(supportedModels.map((m) => m.providerID))]
  const providerModels = supportedModels.filter(
    (model) => model.providerID === vlmProvider,
  )

  function pickEmbedProvider(id: string) {
    setEmbedProvider(id)
    const next = vikingEmbedSpec(id)
    if (next) {
      setEmbedDimension(String(next.defaultDimension))
      // Drop a model that belongs to the previous provider's examples;
      // custom model names are kept.
      const known = VIKING_EMBED_SPECS.some((entry) =>
        entry.exampleModels.includes(embedModel),
      )
      if (known && !next.exampleModels.includes(embedModel)) setEmbedModel("")
    }
    // A native embedder (Voyage, Cohere, …) cannot double as the VLM
    // endpoint, so the VLM has to come from OpenCode.
    if (!embedSupportsCustomVlm(id)) setVlmSource("opencode")
  }

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
          embedProvider,
          embedAccountId,
          embedModel,
          embedDimension: Number(embedDimension),
          vlmModel,
          vlmSource,
          vlmProvider: vlmSource === "opencode" ? vlmProvider : "",
        }),
      })
      if (apiKey) setHasKey(true)
      setApiKey("")
      setSaved("Saved. Restart a running desktop to apply.")
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy(false)
    }
  }

  const missingKey = keyMode === "required" && !hasKey && !apiKey.trim()
  const saveDisabled =
    busy ||
    missingKey ||
    (accountMode === "required" && !embedAccountId.trim()) ||
    (baseMode === "required" && !baseURL.trim()) ||
    !embedModel.trim() ||
    (vlmSource === "opencode" && (!vlmProvider || !vlmModel.trim())) ||
    // A native embedding provider has no VLM endpoint; the VLM must come
    // from OpenCode instead.
    (vlmSource === "custom" && !vlmCustomOk)

  return (
    <Stack spacing={1.5}>
      <Typography variant="h6">
        <MemoryIcon fontSize="small" style={{ verticalAlign: "middle" }} />{" "}
        OpenViking models
      </Typography>
      <Typography variant="body2" color="textSecondary">
        Embedding and VLM models used by this user's OpenViking instance.
        Restart a running desktop to apply. Pick an embedding provider — the
        form shows only the fields that provider needs — and either the same
        custom endpoint for the VLM or a model already connected in OpenCode
        (including a Codex subscription, xAI, or Z.AI) with its existing login.
      </Typography>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {saved ? <Alert severity="success">{saved}</Alert> : null}
      <Typography variant="subtitle2">Embedding</Typography>
      <Select
        name="viking-embed-provider"
        label="Embedding provider"
        value={embedProvider}
        onSelect={pickEmbedProvider}
      >
        {VIKING_EMBED_SPECS.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </Select>
      {spec?.note ? (
        <Typography variant="caption" color="textSecondary">
          {spec.note}
        </Typography>
      ) : null}
      {accountMode !== "hidden" ? (
        <TextField
          label="Cloudflare account id"
          value={embedAccountId}
          onChange={(event) => setEmbedAccountId(event.currentTarget.value)}
          placeholder="1234…abcdef"
        />
      ) : null}
      {baseMode !== "hidden" ? (
        <TextField
          label={
            baseMode === "required"
              ? "Base URL"
              : "Base URL (optional override)"
          }
          value={baseURL}
          onChange={(event) => setBaseURL(event.currentTarget.value)}
          placeholder={
            spec?.defaultBase || "http://host.docker.internal:11434/v1"
          }
        />
      ) : null}
      {keyMode !== "hidden" ? (
        <TextField
          label={
            keyMode === "required"
              ? hasKey
                ? "API key (blank keeps the saved key)"
                : "API key"
              : hasKey
                ? "API key — optional (blank keeps the saved key)"
                : "API key — optional"
          }
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.currentTarget.value)}
        />
      ) : null}
      <TextField
        label="Embed model"
        value={embedModel}
        onChange={(event) => setEmbedModel(event.currentTarget.value)}
        placeholder={spec?.exampleModels[0] ?? "text-embedding-3-small"}
      />
      <TextField
        label="Embed dimension"
        type="number"
        value={embedDimension}
        onChange={(event) => setEmbedDimension(event.currentTarget.value)}
      />
      <Typography variant="subtitle2">VLM</Typography>
      <Select
        name="viking-vlm-source"
        label="VLM source"
        value={vlmSource}
        onSelect={(value) =>
          setVlmSource(value === "opencode" ? "opencode" : "custom")
        }
      >
        {[
          <option key="custom" value="custom" disabled={!vlmCustomOk}>
            {vlmCustomOk
              ? "Embedding endpoint (above)"
              : "Embedding endpoint (not a VLM endpoint)"}
          </option>,
          <option key="opencode" value="opencode">
            OpenCode model (desktop setup)
          </option>,
        ]}
      </Select>
      {vlmSource === "custom" && !vlmCustomOk ? (
        <Alert severity="info">
          This embedding provider has no VLM endpoint — pick an OpenCode model
          for the VLM.
        </Alert>
      ) : null}
      {vlmSource === "custom" ? (
        <TextField
          label="VLM model"
          value={vlmModel}
          onChange={(event) => setVlmModel(event.currentTarget.value)}
        />
      ) : (
        <>
          {modelsError ? <Alert severity="error">{modelsError}</Alert> : null}
          <Select
            name="viking-vlm-provider"
            label="OpenCode provider"
            value={vlmProvider}
            disabled={models === null}
            onSelect={(value) => {
              setVlmProvider(value)
              const first = supportedModels.find(
                (model) => model.providerID === value,
              )
              setVlmModel(first?.modelID ?? "")
            }}
          >
            {[
              ...(vlmProvider && !providerIds.includes(vlmProvider)
                ? [
                    <option key={vlmProvider} value={vlmProvider}>
                      {`${vlmProvider} (not connected)`}
                    </option>,
                  ]
                : []),
              ...providerIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              )),
            ]}
          </Select>
          <Select
            name="viking-vlm-model"
            label="VLM model"
            value={vlmModel}
            disabled={models === null || !vlmProvider}
            onSelect={setVlmModel}
          >
            {[
              ...(vlmModel &&
              !providerModels.some((model) => model.modelID === vlmModel)
                ? [
                    <option key={vlmModel} value={vlmModel}>
                      {`${vlmModel} (not in OpenCode setup)`}
                    </option>,
                  ]
                : []),
              ...providerModels.map((model) => (
                <option key={model.modelID} value={model.modelID}>
                  {model.name
                    ? `${model.name} (${model.modelID})`
                    : model.modelID}
                </option>
              )),
            ]}
          </Select>
          <Typography variant="caption" color="textSecondary">
            {models === null
              ? "Loading the desktop's OpenCode models — this starts the desktop if it is asleep."
              : "Credentials come from the desktop's existing OpenCode login for that provider — nothing to paste. A Codex subscription keeps refreshing through OpenCode."}
          </Typography>
        </>
      )}
      <Button
        variant="contained"
        disabled={saveDisabled}
        onClick={() => void save()}
        sx={{ alignSelf: "flex-start" }}
      >
        Save OpenViking models
      </Button>
    </Stack>
  )
}
